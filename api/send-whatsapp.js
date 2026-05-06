import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'
const TRACKER_BASE = 'https://lwspune.github.io/nda-tracker/'
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
  const supabaseUrl  = env.VITE_SUPABASE_URL     || process.env.VITE_SUPABASE_URL     || ''
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  const appKey     = env.WABRIDGE_APP_KEY      || process.env.WABRIDGE_APP_KEY      || ''
  const authKey    = env.WABRIDGE_AUTH_KEY     || process.env.WABRIDGE_AUTH_KEY     || ''
  const deviceId   = env.WABRIDGE_DEVICE_ID    || process.env.WABRIDGE_DEVICE_ID    || ''
  const templateId = env.WABRIDGE_TEMPLATE_ID  || process.env.WABRIDGE_TEMPLATE_ID  || ''

  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge credentials not configured. Add WABRIDGE_APP_KEY, WABRIDGE_AUTH_KEY, WABRIDGE_DEVICE_ID, WABRIDGE_TEMPLATE_ID to Vercel environment variables.' })
    return
  }

  // Verify faculty session via Supabase JWT
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) {
    res.status(401).json({ ok: false, error: 'Unauthorized — no session token' })
    return
  }
  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const { data: { user } } = await anonClient.auth.getUser(jwt)
  if (!user) {
    res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' })
    return
  }

  // Use user's JWT for all Supabase queries (respects RLS)
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })

  const { examName, redirectTo, students } = req.body

  // Load exam from faculty_state JSONB
  const { data: stateRow, error: stateErr } = await supabase
    .from('faculty_state')
    .select('state')
    .eq('id', 1)
    .single()

  if (stateErr || !stateRow) {
    res.status(500).json({ ok: false, error: 'Could not load faculty state from Supabase' })
    return
  }

  const exams = stateRow.state.exams || []
  const exam = examName
    ? exams.find(e => (e.name || '').trim().toLowerCase() === (examName || '').trim().toLowerCase())
    : [...exams].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]

  if (!exam) {
    res.status(404).json({ ok: false, error: `Exam not found: ${examName}` })
    return
  }

  // Load student mobiles from normalised students table
  const { data: studentRows } = await supabase
    .from('students')
    .select('canonical_name, mobile, parent_mobiles, name_variants')

  const mobileMap = {}
  const parentMap = {}
  for (const s of (studentRows || [])) {
    const name = (s.canonical_name || '').trim()
    const keys = [name.toLowerCase(), ...(s.name_variants || []).map(v => v.trim().toLowerCase())]
    for (const key of keys) {
      if (!key) continue
      if (s.mobile)               mobileMap[key] = s.mobile
      if (s.parent_mobiles?.length) parentMap[key] = s.parent_mobiles
    }
  }

  let results = exam.students || exam.results || []
  if (students?.length) {
    const filter = new Set(students.map(n => n.toLowerCase()))
    results = results.filter(r => filter.has((r.name || '').toLowerCase()))
  }

  const lines = []
  let sent = 0, skipped = 0
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null
  const examDate = fmtDate(exam.date || '')

  for (const row of results) {
    const name = (row.name || '').trim()
    if (!name) continue

    const correct = row.correct || 0
    const wrong   = row.incorrect || row.wrong || 0
    const na      = row.notAttempted || row.skipped || 0
    const total   = correct + wrong + na
    const pct     = total ? Math.round(correct / total * 100) : 0

    const mobileRaw  = mobileMap[name.toLowerCase()] || ''
    const mobileNorm = normMobile(mobileRaw)
    const trackerUrl = mobileRaw ? `${TRACKER_BASE}?mobile=${mobileRaw}` : TRACKER_BASE
    const makeParams = url => [name, exam.name, examDate, `${pct}%`, String(correct), String(total), url]

    // Student
    const destStudent = redirectNorm || mobileNorm
    if (destStudent) {
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destStudent, makeParams(trackerUrl))
      if (ok) { lines.push(`  SENT → ${name} (student → ${destStudent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (student → ${destStudent}): ${detail}`); skipped++ }
    } else {
      lines.push(`  SKIP ${name} — no mobile`)
      skipped++
    }

    // Parents
    for (const parentRaw of (parentMap[name.toLowerCase()] || [])) {
      const destParent = redirectNorm || normMobile(parentRaw)
      if (!destParent) {
        lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`)
        skipped++
        continue
      }
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, makeParams(TRACKER_BASE))
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, lines })
}
