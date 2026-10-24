import { readEnvLocal, envReader } from './_env.js'
import { createClient } from '@supabase/supabase-js'
import { buildDailyChain, resolveOnLeave, buildWardenAlert } from '../src/lib/analytics/chain.js'
import { isTeacherUser } from './_authRole.js'
import { bearerFrom, getUserOrNull } from './_auth.js'
import { normMobile } from './_mobile.js'
import { sendWabridge, fmtDate } from './_wabridge.js'
import { refuseIfFlowOff } from './_flowGate.js'
import { WHATSAPP_FLOWS } from '../src/lib/whatsappFlows.js'
import { makeDayOff, normalizeHolidayRow, filterWorkingDaysByStudent } from '../src/lib/holidays.js'
import { isBlockedStatus } from '../src/lib/accountStatus.js'
import { reportTimes, ATTENDANCE_REPORT_BRANCH, ATTENDANCE_REPORT_GROUP } from '../src/lib/punchReport.js'

// Two attendance-alert flows share one Serverless Function (Vercel Hobby caps a
// deployment at 12). Dispatched by `kind` in the POST body:
//   • kind: 'lecture' (default)    — per-student lecture-miss alerts to student + parents.
//   • kind: 'hostel'               — warden alert for APJ boarders who fell off the daily chain.
//   • kind: 'attendance-report'    — the nightly in/out punch report to LWS Pune student + parents.
//   • kind: 'whatsapp-status'      — which WhatsApp flows have a template ID set, for the
//                                    Settings → WhatsApp badge. Booleans only; sends nothing.
//                                    Lodged here only because of the function cap.
// A bare GET (Vercel cron, Bearer CRON_SECRET) routes to the hostel handler.


// Wabridge/Meta drop messages whose variables contain unicode dashes/newlines/
// long space runs — free-text names are sanitised to ASCII.
function asciiClean(s) {
  return String(s ?? '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function istTodayDmy() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000)
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`
}

// The hostel subsystem speaks DD-MM-YYYY (checkpoint_absences,
// checkpoint_confirmations, the UI picker). `student_attendance` — like every
// non-hostel table — stores YYYY-MM-DD, so it MUST be queried in ISO. Passing
// the DMY string matched nothing, which made the chain's derived `class`
// checkpoint fall back to its default (present) for every boarder, every day.
function dmyToIso(dmy) {
  const [d, m, y] = String(dmy).split('-')
  return `${y}-${m}-${d}`
}

// Local-IST day bounds for a DD-MM-YYYY date (for leave-overlap arithmetic).
function dayBounds(dmy) {
  const [d, m, y] = dmy.split('-')
  const startIso = `${y}-${m}-${d}T00:00:00+05:30`
  const endIso = `${y}-${m}-${d}T23:59:59+05:30`
  return { startIso, endIso, startMs: Date.parse(startIso), endMs: Date.parse(endIso) }
}

// ── Dispatcher ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const kind = req.body?.kind || req.query?.kind || (req.method === 'GET' ? 'hostel' : 'lecture')
  if (kind === 'hostel') return handleHostelAlert(req, res)
  if (kind === 'whatsapp-status') return handleWhatsappStatus(req, res)
  if (kind === 'attendance-report') return handleAttendanceReport(req, res)
  return handleLectureAbsences(req, res)
}

// ── kind: 'lecture' — per-student lecture-miss alerts ────────────────────────
async function handleLectureAbsences(req, res) {
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
  const templateId = env.WABRIDGE_LECTURE_MISS_TEMPLATE_ID || process.env.WABRIDGE_LECTURE_MISS_TEMPLATE_ID || ''

  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge lecture-miss template not configured. Set WABRIDGE_LECTURE_MISS_TEMPLATE_ID (plus app/auth/device) in Vercel env.' })
    return
  }

  const jwt = bearerFrom(req)
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const user = await getUserOrNull(anonClient, jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  // Lecture-miss is parent-facing, so it stays with the office. This check was
  // missing until 2026-09-12 even though handleHostelAlert BELOW has it, and
  // even though send-late / send-homework / send-exam-absence all carry comments
  // saying they 403 teachers "mirroring api/send-attendance-alerts.js" — they
  // were modelled on the one path that never had the check.
  if (isTeacherUser(user)) { res.status(403).json({ ok: false, error: 'Forbidden' }); return }

  const { date, redirectTo, students } = req.body || {}
  if (!date || !Array.isArray(students)) {
    res.status(400).json({ ok: false, error: 'date and students[] are required' })
    return
  }

  // Suppress alerts for students on an active leave that day — a boarder who went
  // home should not get a "missed class" alert to their parents. `date` here is
  // YYYY-MM-DD (see fmtDate). Read under the caller's session so faculty RLS
  // applies; fail closed if the lookup errors (better to block than mis-alert).
  const startIso = `${date}T00:00:00+05:30`
  const endIso = `${date}T23:59:59+05:30`
  const authed = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null

  // Per-flow switch (Settings → WhatsApp), checked before the leaves read so a
  // switched-off flow fails fast. A redirected test send reaches no recipient
  // and bypasses it — keyed on the PARSED redirect. See api/_flowGate.js.
  if (!redirectNorm && await refuseIfFlowOff(authed, 'lectureMiss', res)) return

  const { data: leaveRows, error: lErr } = await authed
    .from('leaves').select('lws_id')
    .lte('from_ts', endIso)
    .or(`to_ts.is.null,to_ts.gte.${startIso}`)   // incl. open-ended (to_ts null)
  if (lErr) { res.status(500).json({ ok: false, error: 'Failed to load leaves: ' + lErr.message }); return }
  const onLeaveIds = new Set((leaveRows || []).map(r => r.lws_id))

  const dateLabel = fmtDate(date)

  const lines = []
  let sent = 0, skipped = 0, onLeaveSkipped = 0

  for (const row of students) {
    const name = (row.name || '').trim()
    if (!name) continue

    // On leave that day → skip entirely (no student or parent message).
    if (row.lwsId && onLeaveIds.has(row.lwsId)) {
      lines.push(`  SKIP ${name} — on leave`); onLeaveSkipped++; continue
    }

    // subjects entries can be either { subject, startTime?, endTime? } objects
    // (new shape, carries time) or plain strings (legacy fallback).
    const entries = Array.isArray(row.subjects)
      ? row.subjects
          .map(s => typeof s === 'string' ? { subject: s } : s)
          .filter(e => e?.subject)
      : []
    if (entries.length === 0) { lines.push(`  SKIP ${name} — no subjects`); skipped++; continue }

    // ASCII-only, no parentheses, no newlines. Meta's WhatsApp template
    // parameter validation silently drops messages whose variable values
    // contain rich-formatting patterns (unicode dashes, parens with
    // colons inside) OR newlines/tabs. Single line with comma-joined
    // "Subject HH:MM AM to HH:MM PM" items is the shape that delivers.
    const fmt = e => (e.startTime && e.endTime)
      ? `${e.subject} ${e.startTime} to ${e.endTime}`
      : e.subject
    const subjectsVar = entries.map(fmt).join(', ')

    const variables = [name, dateLabel, subjectsVar]

    const destStudent = redirectNorm || normMobile(row.mobile)
    if (destStudent) {
      console.log(`[lecture] → ${name} student dest=${destStudent} redirect=${redirectNorm ?? 'none'} templateId=${templateId} varsCount=${variables.length} v3=${JSON.stringify(subjectsVar)}`)
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destStudent, variables)
      if (ok) { lines.push(`  SENT → ${name} (student → ${destStudent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (student → ${destStudent}): ${detail}`); skipped++ }
    } else {
      lines.push(`  SKIP ${name} — no mobile`); skipped++
    }

    for (const parentRaw of (row.parentMobiles || [])) {
      const destParent = redirectNorm || normMobile(parentRaw)
      console.log(`[lecture] → ${name} parent dest=${destParent} redirect=${redirectNorm ?? 'none'}`)
      if (!destParent) { lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`); skipped++; continue }
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, variables)
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}  On leave (suppressed): ${onLeaveSkipped}`)
  res.status(200).json({ ok: true, sent, skipped, onLeaveSkipped, lines })
}

// ── kind: 'hostel' — warden alert for boarders who fell off the daily chain ──
// The chain is RECOMPUTED server-side from the tables (single source of truth;
// never trusts a client-sent list). Triggered by:
//   • Admin (POST + admin JWT) — manual button; supports { dryRun, redirectTo, date }.
//   • Vercel cron (GET, Authorization: Bearer <CRON_SECRET>) — cron-ready, not yet scheduled.
async function handleHostelAlert(req, res) {
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
  const templateId = pick('WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID')
  const cronSecret = pick('CRON_SECRET')

  if (!serviceKey) { res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }); return }

  // ── Auth: cron secret OR admin JWT (teachers rejected) ──
  const bearer = bearerFrom(req)
  let isCron = false
  if (cronSecret && bearer === cronSecret) {
    isCron = true
  } else {
    if (!bearer) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
    const anon = createClient(supabaseUrl, supabaseAnon)
    const user = await getUserOrNull(anon, bearer)
    if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
    if (isTeacherUser(user)) { res.status(403).json({ ok: false, error: 'Forbidden' }); return }
  }

  const { dryRun = false, redirectTo = null, date = null } = (req.method === 'POST' ? req.body : null) || {}

  // Wabridge creds are only needed to actually send — a dry run previews the
  // alert without them, so it can be verified before the template is set up.
  if (!dryRun && (!appKey || !authKey || !deviceId || !templateId)) {
    res.status(500).json({ ok: false, error: 'Wabridge hostel-alert template not configured. Set WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID (plus app/auth/device) in Vercel env.' }); return
  }

  const day = date || istTodayDmy()
  const { startIso, endIso, startMs, endMs } = dayBounds(day)
  const svc = createClient(supabaseUrl, serviceKey)
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null

  // Per-flow switch (Settings → WhatsApp), checked before the chain's five
  // reads so a switched-off alert fails fast. A dry run and a redirected test
  // send reach no warden and bypass it. A cron trigger gets 200 skipped, not
  // 409: an intended stop must not read as an outage. See api/_flowGate.js.
  if (!dryRun && !redirectNorm && await refuseIfFlowOff(svc, 'hostelAlert', res, { cron: isCron })) return

  // ── Load roster + the three exception sources + recipients ──
  const { data: roster, error: rErr } = await svc.from('students')
    .select('lws_id, canonical_name, student_batches(batch_name)')
    .eq('branch', 'APJ').eq('account_status', 'Active').eq('residential', true)
  if (rErr) { res.status(500).json({ ok: false, error: 'Failed to load roster: ' + rErr.message }); return }

  // ISO here — student_attendance does not use the hostel DMY format.
  const { data: attendanceRows, error: aErr } = await svc.from('student_attendance').select('lws_id, status').eq('date', dmyToIso(day))
  if (aErr) { res.status(500).json({ ok: false, error: 'Failed to load attendance: ' + aErr.message }); return }

  // No class on a Sunday or an APJ holiday, but the register still marks every
  // boarder 'A' — so those rows must not reach the chain's class checkpoint.
  // Fails closed like every other read here: a guessed alert is worse than none.
  const { data: holidayRows, error: hErr } = await svc.from('attendance_holidays')
    .select('name, from_date, to_date, branch, batch_names')
    .eq('branch', 'APJ').lte('from_date', dmyToIso(day)).gte('to_date', dmyToIso(day))
  if (hErr) { res.status(500).json({ ok: false, error: 'Failed to load holidays: ' + hErr.message }); return }

  const { data: checkpointRows, error: cErr } = await svc.from('checkpoint_absences').select('lws_id, checkpoint, status').eq('date', day)
  if (cErr) { res.status(500).json({ ok: false, error: 'Failed to load checkpoints: ' + cErr.message }); return }

  // Overlap incl. open-ended leaves (to_ts null → still out). The null branch
  // must match leavesSlice.getActiveLeaves, or an on-leave boarder wrongly shows
  // as unexplained in the warden alert.
  const { data: leaveRows, error: lErr } = await svc.from('leaves').select('lws_id, from_ts, to_ts').lte('from_ts', endIso).or(`to_ts.is.null,to_ts.gte.${startIso}`)
  if (lErr) { res.status(500).json({ ok: false, error: 'Failed to load leaves: ' + lErr.message }); return }

  const { data: stateRow, error: sErr } = await svc.from('faculty_state').select('data').eq('id', 1).single()
  if (sErr) { res.status(500).json({ ok: false, error: 'Failed to load faculty_state: ' + sErr.message }); return }
  const recipientsRaw = stateRow?.data?.hostelAlertMobiles || []

  // ── Recompute the chain + shape the alert ──
  const rosterMapped = (roster || []).map(s => ({ lwsId: s.lws_id, name: s.canonical_name }))
  const dayOff = makeDayOff(
    (holidayRows || []).map(normalizeHolidayRow),
    new Map((roster || []).map(s => [s.lws_id, { branch: 'APJ', batches: (s.student_batches || []).map(b => b.batch_name) }])),
  )
  const classRows = filterWorkingDaysByStudent(attendanceRows || [], dayOff, dmyToIso(day))
  const onLeaveIds = resolveOnLeave(
    // to_ts null → toMs null (open-ended); Date.parse(null) is NaN, which would
    // break the overlap test, so map it explicitly.
    (leaveRows || []).map(r => ({ lwsId: r.lws_id, fromMs: Date.parse(r.from_ts), toMs: r.to_ts == null ? null : Date.parse(r.to_ts) })),
    startMs, endMs,
  )
  const chain = buildDailyChain({ roster: rosterMapped, attendanceRows: classRows, checkpointRows: checkpointRows || [], onLeaveIds })
  const alert = buildWardenAlert(chain, day)
  const variables = [asciiClean(day), asciiClean(alert.listText)]

  if (dryRun) {
    res.status(200).json({ ok: true, dryRun: true, date: day, count: alert.count, message: alert.message, listText: alert.listText, recipients: recipientsRaw.length })
    return
  }

  if (alert.count === 0) {
    res.status(200).json({ ok: true, date: day, count: 0, sent: 0, skipped: 0, message: alert.message, lines: [alert.message] })
    return
  }

  const destinations = redirectNorm ? [redirectNorm] : recipientsRaw.map(normMobile).filter(Boolean)
  if (destinations.length === 0) {
    res.status(200).json({ ok: true, date: day, count: alert.count, sent: 0, skipped: 0, message: 'No warden alert numbers configured — add one in the Hostel & Mess tab.', lines: [] })
    return
  }

  const lines = []
  let sent = 0, skipped = 0
  for (const dest of destinations) {
    const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, dest, variables)
    if (ok) { lines.push(`  SENT → ${dest}: ${alert.listText}`); sent++ }
    else { lines.push(`  FAIL → ${dest}: ${detail}`); skipped++ }
  }
  lines.push(`Done. Alerted ${sent}${redirectNorm ? ' (test redirect)' : ''}  Failed: ${skipped}`)
  res.status(200).json({ ok: true, date: day, count: alert.count, sent, skipped, message: alert.message, lines })
}

// ── kind: 'attendance-report' — the nightly punch report ─────────────────────
// One message per LWS Pune student and each parent: name, date, in time, out
// time (template attendance_report_bulk_message). The browser parses EIS's
// Punch Monitor export and posts { lwsId, status, inTime, outTime } in groups
// of at most ATTENDANCE_REPORT_GROUP — about 250 messages a night would
// outlive one function call.
//
// The request carries ids and punch times ONLY. Name, branch, status and every
// number are read here from `students`, so a tampered request can neither
// reach a number of its choosing nor a student outside LWS Pune.
//
// Never twice: each student is CLAIMED in attendance_report_sends (primary key
// date + lws_id) before any message goes out, so a re-upload, a double click or
// two tabs racing reach each family once. A claim whose family nobody reached
// is released, so the next run retries it. A redirected test send neither
// claims nor checks.
function isIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

async function handleAttendanceReport(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' }); return
  }

  const pick = envReader()
  const appKey     = pick('WABRIDGE_APP_KEY')
  const authKey    = pick('WABRIDGE_AUTH_KEY')
  const deviceId   = pick('WABRIDGE_DEVICE_ID')
  const templateId = pick('WABRIDGE_ATTENDANCE_REPORT_TEMPLATE_ID')
  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge attendance report not configured. Set WABRIDGE_ATTENDANCE_REPORT_TEMPLATE_ID (plus app/auth/device) in Vercel env.' })
    return
  }

  const jwt = bearerFrom(req)
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const supabaseUrl  = pick('VITE_SUPABASE_URL')
  const supabaseAnon = pick('VITE_SUPABASE_ANON_KEY')
  const user = await getUserOrNull(createClient(supabaseUrl, supabaseAnon), jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  // Parent-facing, so it stays with the office.
  if (isTeacherUser(user)) { res.status(403).json({ ok: false, error: 'Forbidden' }); return }

  const { date, redirectTo, students } = req.body || {}
  if (!isIsoDate(date)) { res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' }); return }
  if (!Array.isArray(students) || students.length === 0 || students.length > ATTENDANCE_REPORT_GROUP) {
    res.status(400).json({ ok: false, error: `students[] must hold 1 to ${ATTENDANCE_REPORT_GROUP} rows` }); return
  }
  if (students.some(s => !s?.lwsId || typeof s.lwsId !== 'string')) {
    res.status(400).json({ ok: false, error: 'every student needs an lwsId' }); return
  }

  const db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null
  if (!redirectNorm && await refuseIfFlowOff(db, 'attendanceReport', res)) return

  // Fails CLOSED: without this read there is no name, no number and no way to
  // tell a blocked or out-of-branch student, so nothing goes out.
  const ids = [...new Set(students.map(s => s.lwsId))]
  const { data: rows, error: sErr } = await db
    .from('students')
    .select('lws_id, canonical_name, branch, account_status, mobile, parent_mobiles')
    .in('lws_id', ids)
  if (sErr || !Array.isArray(rows)) {
    res.status(500).json({ ok: false, error: 'Could not read students: ' + (sErr?.message || 'no rows returned') }); return
  }
  const byId = new Map(rows.map(r => [r.lws_id, r]))

  const lines = []
  let sent = 0, skipped = 0, blocked = 0, notInBranch = 0, alreadySent = 0
  const sendable = []
  const seen = new Set()
  for (const punch of students) {
    if (seen.has(punch.lwsId)) continue
    seen.add(punch.lwsId)
    const s = byId.get(punch.lwsId)
    // Unlike the shared block gate, an unknown id is refused, not passed: the
    // branch cannot be checked for a student this table does not hold.
    if (!s || s.branch !== ATTENDANCE_REPORT_BRANCH) {
      lines.push(`  SKIP ${asciiClean(s?.canonical_name) || punch.lwsId} — not an ${ATTENDANCE_REPORT_BRANCH} student`)
      notInBranch++
      continue
    }
    if (isBlockedStatus(s.account_status)) { blocked++; continue }
    sendable.push({ student: s, punch })
  }
  if (blocked) lines.push(`Excluded ${blocked} blocked/inactive student(s).`)

  let toSend = sendable
  if (!redirectNorm && sendable.length) {
    const { data: claimedRows, error: cErr } = await db
      .from('attendance_report_sends')
      .upsert(sendable.map(x => ({ date, lws_id: x.student.lws_id })), { onConflict: 'date,lws_id', ignoreDuplicates: true })
      .select('lws_id')
    if (cErr || !Array.isArray(claimedRows)) {
      res.status(500).json({ ok: false, error: 'Could not record the send, so nothing was sent: ' + (cErr?.message || 'no rows returned') }); return
    }
    const claimed = new Set(claimedRows.map(r => r.lws_id))
    toSend = []
    for (const x of sendable) {
      if (claimed.has(x.student.lws_id)) toSend.push(x)
      else { lines.push(`  SKIP ${asciiClean(x.student.canonical_name)} — already sent for this date`); alreadySent++ }
    }
  }

  const dateLabel = fmtDate(date)
  const unreached = []
  for (const { student: s, punch } of toSend) {
    const name = asciiClean(s.canonical_name) || s.lws_id
    const { inText, outText } = reportTimes(punch)
    const variables = [name, dateLabel, inText, outText]
    let reached = false

    const destStudent = redirectNorm || normMobile(s.mobile)
    if (destStudent) {
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destStudent, variables)
      if (ok) { lines.push(`  SENT → ${name} (student → ${destStudent})`); sent++; reached = true }
      else    { lines.push(`  FAIL → ${name} (student → ${destStudent}): ${detail}`); skipped++ }
    } else {
      lines.push(`  SKIP ${name} — no mobile`); skipped++
    }

    for (const parentRaw of (s.parent_mobiles || [])) {
      const destParent = redirectNorm || normMobile(parentRaw)
      if (!destParent) { lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`); skipped++; continue }
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, variables)
      if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++; reached = true }
      else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
    }
    if (!reached) unreached.push(s.lws_id)
  }

  if (!redirectNorm && unreached.length) {
    const { error: rErr } = await db.from('attendance_report_sends').delete().eq('date', date).in('lws_id', unreached)
    if (rErr) {
      console.error('[attendance-report] could not release unreached claims:', rErr.message)
      lines.push(`  WARN could not release ${unreached.length} unreached student(s) for a retry: ${rErr.message}`)
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}  Already sent: ${alreadySent}`)
  res.status(200).json({ ok: true, sent, skipped, blocked, notInBranch, alreadySent, lines })
}

// ── kind: 'whatsapp-status' — is each flow's template ID set? ───────────────
// Feeds the "Configured" badge in Settings → WhatsApp. The env vars are
// server-only, so the browser cannot tell on its own. Answers with BOOLEANS:
// the template IDs and Wabridge keys are secrets and must never reach a client.
// `shared` covers the three credentials every flow needs; a flow with its own
// template ID set still cannot send while `shared` is false.
async function handleWhatsappStatus(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' }); return
  }

  const pick = envReader()
  const jwt = bearerFrom(req)
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
  const user = await getUserOrNull(anonClient, jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  // Settings is admin-only; which messaging channels are live is office
  // configuration, not something a teacher session needs.
  if (isTeacherUser(user)) { res.status(403).json({ ok: false, error: 'Forbidden' }); return }

  const shared = Boolean(pick('WABRIDGE_APP_KEY') && pick('WABRIDGE_AUTH_KEY') && pick('WABRIDGE_DEVICE_ID'))
  const configured = Object.fromEntries(WHATSAPP_FLOWS.map(f => [f.key, Boolean(pick(f.envVar))]))
  res.status(200).json({ ok: true, shared, configured })
}
