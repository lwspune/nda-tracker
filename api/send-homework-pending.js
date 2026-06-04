import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'

function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf-8')
        .split('\n')
        .map(l => l.match(/^([A-Z_]+)=(.*)/))
        .filter(Boolean)
        .map(m => [m[1], m[2].trim()])
    )
  } catch { return {} }
}

function normMobile(m) {
  if (!m) return null
  let s = String(m).replace(/\D/g, '')
  if (s.startsWith('0') && s.length === 11) s = '91' + s.slice(1)
  if (s.length === 10) s = '91' + s
  if (s.startsWith('91') && s.length === 12) return s
  return null
}

// Wabridge/Meta drop messages whose template variables contain unicode dashes,
// newlines, tabs, or runs of 5+ spaces. Subject + chapter (free text) are
// sanitised to plain ASCII before they go on the wire.
function asciiClean(s) {
  return String(s ?? '')
    .replace(/[‐-―−]/g, '-') // unicode dashes → hyphen
    .replace(/[^\x20-\x7E]/g, ' ')          // any other non-ASCII → space
    .replace(/\s+/g, ' ')                   // collapse whitespace (incl. newlines/tabs)
    .trim()
}

// Title-case label for the approved template's "Type:" field.
function typeLabel(type) {
  if (type === 'both')  return 'Homework and Notes'
  if (type === 'notes') return 'Notes'
  return 'Homework'
}

async function sendWabridge(appKey, authKey, deviceId, templateId, destination, variables) {
  const payload = {
    'app-key':            appKey,
    'auth-key':           authKey,
    'destination_number': destination,
    'device_id':          deviceId,
    'template_id':        templateId,
    variables,
  }
  try {
    const r = await fetch(WABRIDGE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await r.json()
    if (data.status) return { ok: true,  detail: String(data.data?.messageid || 'ok') }
    return { ok: false, detail: data.message || 'Unknown error' }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const env = readEnvLocal()
  const supabaseUrl  = env.VITE_SUPABASE_URL      || process.env.VITE_SUPABASE_URL      || ''
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  const appKey     = env.WABRIDGE_APP_KEY    || process.env.WABRIDGE_APP_KEY    || ''
  const authKey    = env.WABRIDGE_AUTH_KEY   || process.env.WABRIDGE_AUTH_KEY   || ''
  const deviceId   = env.WABRIDGE_DEVICE_ID  || process.env.WABRIDGE_DEVICE_ID  || ''
  const templateId = env.WABRIDGE_HOMEWORK_TEMPLATE_ID || process.env.WABRIDGE_HOMEWORK_TEMPLATE_ID || ''

  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge homework template not configured. Set WABRIDGE_HOMEWORK_TEMPLATE_ID (plus app/auth/device) in Vercel env.' })
    return
  }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const { data: { user } } = await anonClient.auth.getUser(jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }

  // `date` is still required (used by the client for send-history keying) but the
  // approved template carries no date field — it isn't a message variable.
  const { date, redirectTo, students } = req.body || {}
  if (!date || !Array.isArray(students)) {
    res.status(400).json({ ok: false, error: 'date and students[] are required' })
    return
  }

  const redirectNorm = redirectTo ? normMobile(redirectTo) : null

  const lines = []
  let sent = 0, skipped = 0

  for (const row of students) {
    const name = (row.name || '').trim()
    if (!name) continue

    const items = Array.isArray(row.items) ? row.items.filter(it => it?.subject || it?.chapter) : []
    if (items.length === 0) { lines.push(`  SKIP ${name} — no items`); skipped++; continue }

    // Resolve destinations once (student + parents), logging contact SKIPs a
    // single time rather than per-item.
    const dests = []
    const destStudent = redirectNorm || normMobile(row.mobile)
    if (destStudent) dests.push({ role: 'student', dest: destStudent })
    else { lines.push(`  SKIP ${name} — no mobile`); skipped++ }

    for (const parentRaw of (row.parentMobiles || [])) {
      const destParent = redirectNorm || normMobile(parentRaw)
      if (destParent) dests.push({ role: 'parent', dest: destParent })
      else { lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`); skipped++ }
    }

    // The approved Wabridge template has one item per message: positional
    // {{1}}=name {{2}}=subject {{3}}=topic(chapter) {{4}}=type. A student with
    // N pending items gets N messages per destination.
    for (const item of items) {
      const variables = [name, asciiClean(item.subject), asciiClean(item.chapter), typeLabel(item.type)]
      for (const { role, dest } of dests) {
        console.log(`[homework] → ${name} ${role} dest=${dest} redirect=${redirectNorm ?? 'none'} templateId=${templateId} vars=${JSON.stringify(variables.slice(1))}`)
        const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, dest, variables)
        if (ok) { lines.push(`  SENT → ${name} (${role} → ${dest})`); sent++ }
        else    { lines.push(`  FAIL → ${name} (${role} → ${dest}): ${detail}`); skipped++ }
      }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, lines })
}
