import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fmtNudgeDate, isNudgeDay, istDateString, pickDailyMentees, MENTEES_PER_DAY } from '../src/lib/mentorNudge.js'

const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'

function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf-8')
        .split('\n')
        .map(l => l.match(/^([A-Z0-9_]+)=(.*)/))
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

// Wabridge/Meta drop messages whose variables contain unicode dashes, newlines,
// tabs, or long space runs — student names (free text) are sanitised to ASCII.
function asciiClean(s) {
  return String(s ?? '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function sendWabridge(appKey, authKey, deviceId, templateId, destination, variables) {
  const payload = {
    'app-key': appKey,
    'auth-key': authKey,
    'destination_number': destination,
    'device_id': deviceId,
    'template_id': templateId,
    variables,
  }
  try {
    const r = await fetch(WABRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json()
    if (data.status) return { ok: true, detail: String(data.data?.messageid || 'ok') }
    return { ok: false, detail: data.message || 'Unknown error' }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
}

// Daily mentorship nudge. Triggered two ways:
//   • Vercel cron (GET, Authorization: Bearer <CRON_SECRET>) — real send, Mon–Fri.
//   • Admin (POST + admin JWT) — manual run; supports { dryRun, redirectTo, force }.
// Reads assignments/students/nudges via the service-role client (cron has no
// user session, and RLS on the operational tables is authenticated-only).
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' }); return
  }

  const env = readEnvLocal()
  const pick = k => env[k] || process.env[k] || ''
  const supabaseUrl = pick('VITE_SUPABASE_URL')
  const supabaseAnon = pick('VITE_SUPABASE_ANON_KEY')
  const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY')
  const appKey = pick('WABRIDGE_APP_KEY')
  const authKey = pick('WABRIDGE_AUTH_KEY')
  const deviceId = pick('WABRIDGE_DEVICE_ID')
  const templateId = pick('WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID')
  const cronSecret = pick('CRON_SECRET')

  if (!serviceKey) { res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }); return }

  // ── Auth: cron secret OR admin JWT (teachers rejected) ──
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  let mode
  if (cronSecret && bearer === cronSecret) {
    mode = 'cron'
  } else {
    if (!bearer) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
    const anon = createClient(supabaseUrl, supabaseAnon)
    const { data: { user } } = await anon.auth.getUser(bearer)
    if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
    if (user.user_metadata?.role === 'teacher') { res.status(403).json({ ok: false, error: 'Forbidden' }); return }
    mode = 'admin'
  }

  const { dryRun = false, redirectTo = null, force = false } = (req.method === 'POST' ? req.body : null) || {}

  // Wabridge creds are only needed to actually send — a dry run previews picks
  // without them, so the rotation can be verified before the template is set up.
  if (!dryRun && (!appKey || !authKey || !deviceId || !templateId)) {
    res.status(500).json({ ok: false, error: 'Wabridge mentor-nudge template not configured. Set WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID (plus app/auth/device) in Vercel env.' }); return
  }

  const today = istDateString(new Date())

  if (!isNudgeDay(today) && !force) {
    res.status(200).json({ ok: true, skipped: 'weekend', today, sent: 0, lines: [`Skipped — ${today} is not Mon–Fri (use force to override).`] })
    return
  }

  const svc = createClient(supabaseUrl, serviceKey)
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null

  // ── Load assignments, student names/status, teacher mobiles, nudge history ──
  const { data: assignments, error: aErr } = await svc.from('mentor_assignments').select('lws_id, teacher_id')
  if (aErr) { res.status(500).json({ ok: false, error: 'Failed to load assignments: ' + aErr.message }); return }
  if (!assignments?.length) { res.status(200).json({ ok: true, sent: 0, lines: ['No mentor assignments.'] }); return }

  const lwsIds = [...new Set(assignments.map(a => a.lws_id))]
  const { data: students, error: sErr } = await svc.from('students').select('lws_id, canonical_name, account_status').in('lws_id', lwsIds)
  if (sErr) { res.status(500).json({ ok: false, error: 'Failed to load students: ' + sErr.message }); return }
  const studentById = new Map((students || []).map(s => [s.lws_id, s]))

  const { data: nudges, error: nErr } = await svc.from('mentor_nudges').select('teacher_id, lws_id, date')
  if (nErr) { res.status(500).json({ ok: false, error: 'Failed to load nudge history: ' + nErr.message }); return }
  const logByTeacher = new Map()
  for (const n of (nudges || [])) {
    if (!logByTeacher.has(n.teacher_id)) logByTeacher.set(n.teacher_id, [])
    logByTeacher.get(n.teacher_id).push({ lwsId: n.lws_id, date: n.date })
  }

  const { data: stateRow, error: stateErr } = await svc.from('faculty_state').select('data').eq('id', 1).single()
  if (stateErr) { res.status(500).json({ ok: false, error: 'Failed to load faculty_state: ' + stateErr.message }); return }
  const teacherById = new Map((stateRow.data?.timetableTeachers || []).map(t => [t.id, t]))

  // ── Group active mentees by teacher ──
  const menteesByTeacher = new Map()
  for (const a of assignments) {
    const s = studentById.get(a.lws_id)
    if (!s || s.account_status !== 'Active') continue // exclude Block/inactive
    if (!menteesByTeacher.has(a.teacher_id)) menteesByTeacher.set(a.teacher_id, [])
    menteesByTeacher.get(a.teacher_id).push({ lwsId: a.lws_id, name: s.canonical_name })
  }

  const dateLabel = fmtNudgeDate(today)
  const lines = []
  let sent = 0, skipped = 0
  const planned = []

  for (const [teacherId, mentees] of menteesByTeacher) {
    const teacher = teacherById.get(teacherId)
    const teacherName = teacher?.name || teacherId
    const picks = pickDailyMentees(mentees, logByTeacher.get(teacherId) || [], { n: MENTEES_PER_DAY, today })
    if (picks.length === 0) { lines.push(`  SKIP ${teacherName} — round complete / no active mentees`); skipped++; continue }

    const namesList = picks.map(p => asciiClean(p.name)).join(', ')
    // Positional vars per the approved template: {{1}}=date, {{2}}=students.
    // (Order verified on first dry-run send — flip if the preview shows otherwise.)
    const variables = [dateLabel, namesList]
    planned.push({ teacher: teacherName, students: picks.map(p => p.name) })

    if (dryRun) { lines.push(`  PLAN ${teacherName} → ${namesList}`); continue }

    const dest = redirectNorm || normMobile(teacher?.mobile)
    if (!dest) { lines.push(`  SKIP ${teacherName} — no mobile on teacher record`); skipped++; continue }

    const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, dest, variables)
    if (!ok) { lines.push(`  FAIL ${teacherName} (→ ${dest}): ${detail}`); skipped++; continue }

    // A redirected (test) send never advances the real rotation.
    if (redirectNorm) { lines.push(`  TEST ${teacherName} (→ ${dest}): ${namesList} [rotation not advanced]`); sent++; continue }

    // Advance the rotation ONLY after a successful real send.
    const rows = picks.map(p => ({ teacher_id: teacherId, lws_id: p.lwsId, date: today }))
    const { error: insErr } = await svc.from('mentor_nudges').insert(rows)
    if (insErr) lines.push(`  WARN ${teacherName} sent but log insert failed: ${insErr.message}`)
    lines.push(`  SENT ${teacherName} (→ ${dest}): ${namesList}`)
    sent++
  }

  if (dryRun) { lines.unshift(`DRY RUN — ${today} (${dateLabel})`); res.status(200).json({ ok: true, dryRun: true, today, planned, lines }); return }
  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, mode, today, sent, skipped, lines })
}
