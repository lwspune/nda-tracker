import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { isBlockedStatus } from '../src/lib/accountStatus.js'

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

  const { examName, redirectTo, students, monitorMobiles } = req.body

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
    .select('canonical_name, mobile, parent_mobiles, name_variants, account_status')

  const mobileMap = {}
  const parentMap = {}
  const canonicalMap = {}   // any name-key (canonical or variant, lc) → canonical roster spelling
  const blockedKeys = new Set()   // name-keys whose student is Block/Quit/Inactive — never messaged
  for (const s of (studentRows || [])) {
    const name = (s.canonical_name || '').trim()
    const keys = [name.toLowerCase(), ...(s.name_variants || []).map(v => v.trim().toLowerCase())]
    const blocked = isBlockedStatus(s.account_status)
    for (const key of keys) {
      if (!key) continue
      canonicalMap[key] = name
      if (blocked)                 blockedKeys.add(key)
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

  // Never message a blocked / quit / inactive student — drop them before any leg
  // (student, parent, AND the monitor sample). Server-enforced so an omitted or
  // stale client filter can't opt them back in. Mirrors the login gate.
  const beforeBlock = results.length
  results = results.filter(r => !blockedKeys.has((r.name || '').toLowerCase()))
  const blocked = beforeBlock - results.length

  const lines = []
  let sent = 0, skipped = 0, monitor = 0
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null
  const examDate = fmtDate(exam.date || '')

  // Builds the 7 template variables for one result row. The deep-link pre-fills
  // the student's own mobile (one-tap login to the right child, no sibling
  // picker) + the exam id so the portal lands on this exam's result. The message
  // shows the canonical roster spelling (falls back to the exam-sheet name when
  // the student has no matched profile). Single source so the student, parent,
  // and monitoring copies can never diverge.
  function makeParamsForRow(row) {
    const nm  = (row.name || '').trim()
    const dn  = canonicalMap[nm.toLowerCase()] || nm
    const c   = row.correct      || 0
    const w   = row.incorrect    || 0
    const a   = row.notAttempted || 0
    const t   = c + w + a
    const p   = t ? Math.round(c / t * 100) : 0
    const url = buildTrackerUrl(mobileMap[nm.toLowerCase()] || '', exam.id)
    return [dn, exam.name, examDate, `${p}%`, String(c), String(t), url]
  }

  for (const row of results) {
    const name = (row.name || '').trim()   // exam-sheet spelling — used for mobile/parent lookup
    if (!name) continue

    const mobileNorm = normMobile(mobileMap[name.toLowerCase()] || '')
    const params = makeParamsForRow(row)

    // Student
    const destStudent = redirectNorm || mobileNorm
    if (destStudent) {
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destStudent, params)
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
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, params)
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
  }

  // ── Monitoring copy ────────────────────────────────────────────────────────
  // Send one random student's exact result message to each monitor number, so
  // the process can be observed from a fixed phone. Skipped on test sends
  // (redirectTo) — monitoring is for real blasts only — and when no numbers set.
  if (!redirectNorm && Array.isArray(monitorMobiles) && monitorMobiles.length && results.length) {
    const sample      = results[Math.floor(Math.random() * results.length)]
    const sampleName  = (sample.name || '').trim()
    const sampleParams = makeParamsForRow(sample)
    for (const monRaw of monitorMobiles) {
      const dest = normMobile(monRaw)
      if (!dest) {
        lines.push(`  SKIP monitor ${monRaw} — unrecognised format`)
        skipped++
        continue
      }
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, dest, sampleParams)
      if (ok) { lines.push(`  MONITOR → ${dest} (sample: ${sampleName})`); monitor++ }
      else    { lines.push(`  FAIL → monitor ${dest}: ${detail}`); skipped++ }
    }
  }

  if (blocked) lines.push(`Excluded ${blocked} blocked/inactive student(s).`)
  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, monitor, blocked, lines })
}
