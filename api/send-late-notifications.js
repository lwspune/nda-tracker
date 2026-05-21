import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

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

function fmtDate(d) {
  if (!d) return ''
  const parts = d.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return d
  const [y, m, day] = parts
  return `${day} ${MONTHS[m - 1]} ${y}`
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
  const appKey     = env.WABRIDGE_APP_KEY        || process.env.WABRIDGE_APP_KEY        || ''
  const authKey    = env.WABRIDGE_AUTH_KEY       || process.env.WABRIDGE_AUTH_KEY       || ''
  const deviceId   = env.WABRIDGE_DEVICE_ID      || process.env.WABRIDGE_DEVICE_ID      || ''
  const templateId = env.WABRIDGE_LATE_TEMPLATE_ID || process.env.WABRIDGE_LATE_TEMPLATE_ID || ''

  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge late-template credentials not configured. Set WABRIDGE_LATE_TEMPLATE_ID (plus app/auth/device) in Vercel env.' })
    return
  }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const { data: { user } } = await anonClient.auth.getUser(jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }

  const { date, redirectTo, students } = req.body || {}
  if (!date || !Array.isArray(students)) {
    res.status(400).json({ ok: false, error: 'date and students[] are required' })
    return
  }

  const dateLabel = fmtDate(date)
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null

  const lines = []
  let sent = 0, skipped = 0

  for (const row of students) {
    const name = (row.name || '').trim()
    if (!name) continue

    // Wabridge expects positional variables — the Meta-approved template body
    // must use {{1}}, {{2}} placeholders (Meta does NOT substitute {{name}}).
    const variables = [name, dateLabel]

    // Student
    const destStudent = redirectNorm || normMobile(row.mobile)
    if (destStudent) {
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destStudent, variables)
      if (ok) { lines.push(`  SENT → ${name} (student → ${destStudent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (student → ${destStudent}): ${detail}`); skipped++ }
    } else {
      lines.push(`  SKIP ${name} — no mobile`); skipped++
    }

    // Parents
    for (const parentRaw of (row.parentMobiles || [])) {
      const destParent = redirectNorm || normMobile(parentRaw)
      if (!destParent) { lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`); skipped++; continue }
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, variables)
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, lines })
}
