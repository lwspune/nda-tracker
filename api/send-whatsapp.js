import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'
const TRACKER_BASE = 'https://nda-tracker.vercel.app/'
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

// Build the student-portal link carried in the result message. Pre-fills the
// mobile (one-tap login) and the exam id (lands on this exam's result).
function buildTrackerUrl(mobileRaw, examId) {
  const params = []
  if (mobileRaw) params.push(`mobile=${mobileRaw}`)
  if (examId)    params.push(`exam=${examId}`)
  return params.length ? `${TRACKER_BASE}?${params.join('&')}` : TRACKER_BASE
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
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY  || process.env.VITE_SUPABASE_ANON_KEY  || ''
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

  // JWT-scoped client for all DB queries (respects RLS)
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })

  const { examName, redirectTo, students } = req.body

  // ── Load exam from normalised exams table ──────────────────────────────────

  const { data: allExams, error: examsErr } = await supabase.from('exams').select('*')

  if (examsErr) {
    res.status(500).json({ ok: false, error: 'Could not load exams' })
    return
  }

  const exam = examName
    ? (allExams || []).find(e =>
        (e.name || '').trim().toLowerCase() === (examName || '').trim().toLowerCase()
      )
    : [...(allExams || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]

  if (!exam) {
    res.status(404).json({ ok: false, error: `Exam not found: ${examName}` })
    return
  }

  // ── Load student results from normalised exam_results table ───────────────

  const { data: resultRows, error: resultsErr } = await supabase
    .from('exam_results')
    .select('student_name, correct, incorrect, not_attempted')
    .eq('exam_id', exam.id)

  if (resultsErr) {
    res.status(500).json({ ok: false, error: 'Could not load exam results' })
    return
  }

  // ── Load student contact info ──────────────────────────────────────────────

  const { data: studentRows } = await supabase
    .from('students')
    .select('canonical_name, mobile, parent_mobiles, name_variants')

  const mobileMap = {}
  const parentMap = {}
  const canonicalMap = {}   // any name-key (canonical or variant, lc) → canonical roster spelling
  for (const s of (studentRows || [])) {
    const name = (s.canonical_name || '').trim()
    const keys = [name.toLowerCase(), ...(s.name_variants || []).map(v => v.trim().toLowerCase())]
    for (const key of keys) {
      if (!key) continue
      canonicalMap[key] = name
      if (s.mobile)                mobileMap[key] = s.mobile
      if (s.parent_mobiles?.length) parentMap[key] = s.parent_mobiles
    }
  }

  // ── Apply student filter and send ─────────────────────────────────────────

  let results = (resultRows || []).map(r => ({
    name:         r.student_name,
    correct:      r.correct,
    incorrect:    r.incorrect,
    notAttempted: r.not_attempted,
  }))

  if (students?.length) {
    const filter = new Set(students.map(n => n.toLowerCase()))
    results = results.filter(r => filter.has((r.name || '').toLowerCase()))
  }

  const lines = []
  let sent = 0, skipped = 0
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null
  const examDate = fmtDate(exam.date || '')

  for (const row of results) {
    const name = (row.name || '').trim()   // exam-sheet spelling — used for mobile/parent lookup
    if (!name) continue
    // Message shows the canonical roster spelling (falls back to the exam-sheet
    // name when the student has no matched profile).
    const displayName = canonicalMap[name.toLowerCase()] || name

    const correct = row.correct      || 0
    const wrong   = row.incorrect    || 0
    const na      = row.notAttempted || 0
    const total   = correct + wrong + na
    const pct     = total ? Math.round(correct / total * 100) : 0

    const mobileRaw  = mobileMap[name.toLowerCase()] || ''
    const mobileNorm = normMobile(mobileRaw)
    // Deep-link: pre-fill the student's own mobile (one-tap login to the right
    // child, no sibling picker) + the exam id so the portal lands on this exam's
    // result. Used for BOTH the student and the parent message (parents otherwise
    // got a bare link with no pre-fill and landed on the dashboard root).
    const trackerUrl = buildTrackerUrl(mobileRaw, exam.id)
    const makeParams = url => [displayName, exam.name, examDate, `${pct}%`, String(correct), String(total), url]

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
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, makeParams(trackerUrl))
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, lines })
}
