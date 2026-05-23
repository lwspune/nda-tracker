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

// Meta drops messages containing en-dash, em-dash, newlines, or runs of whitespace.
// Replace common Unicode punctuation with ASCII and collapse whitespace.
function sanitiseExamName(name) {
  if (!name) return ''
  return String(name)
    .replace(/[–—]/g, '-')   // en-dash, em-dash → hyphen
    .replace(/[\r\n\t]+/g, ' ')        // newlines / tabs → space
    .replace(/\s+/g, ' ')              // collapse runs of whitespace
    .trim()
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
  const appKey     = env.WABRIDGE_APP_KEY                  || process.env.WABRIDGE_APP_KEY                  || ''
  const authKey    = env.WABRIDGE_AUTH_KEY                 || process.env.WABRIDGE_AUTH_KEY                 || ''
  const deviceId   = env.WABRIDGE_DEVICE_ID                || process.env.WABRIDGE_DEVICE_ID                || ''
  const templateId = env.WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID || process.env.WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID || ''

  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge exam-absence template credentials not configured. Set WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID (plus app/auth/device) in Vercel env.' })
    return
  }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const { data: { user } } = await anonClient.auth.getUser(jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }

  const { examName, redirectTo, students } = req.body || {}
  if (!examName || !Array.isArray(students) || students.length === 0) {
    res.status(400).json({ ok: false, error: 'examName and students[] are required' })
    return
  }

  const cleanExamName = sanitiseExamName(examName)
  const redirectNorm  = redirectTo ? normMobile(redirectTo) : null

  const lines = []
  let sent = 0, skipped = 0

  for (const row of students) {
    const name = (row.name || '').trim()
    if (!name) continue

    // Positional variables — Meta-approved template body uses {{1}}, {{2}}.
    const variables = [name, cleanExamName]

    const parents = row.parentMobiles || []
    if (parents.length === 0) {
      lines.push(`  SKIP ${name} — no parent mobile`); skipped++
      continue
    }

    for (const parentRaw of parents) {
      const destParent = redirectNorm || normMobile(parentRaw)
      if (!destParent) { lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`); skipped++; continue }
      console.log(`[exam-absence] → ${name} parent dest=${destParent} redirect=${redirectNorm ?? 'none'} vars=${JSON.stringify(variables)}`)
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, variables)
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, lines })
}
