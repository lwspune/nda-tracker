import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { buildDailyChain, resolveOnLeave, buildWardenAlert } from '../src/lib/analytics/chain.js'

// Two attendance-alert flows share one Serverless Function (Vercel Hobby caps a
// deployment at 12). Dispatched by `kind` in the POST body:
//   • kind: 'lecture' (default) — per-student lecture-miss alerts to student + parents.
//   • kind: 'hostel'            — warden alert for APJ boarders who fell off the daily chain.
// A bare GET (Vercel cron, Bearer CRON_SECRET) routes to the hostel handler.

const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

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

// Wabridge/Meta drop messages whose variables contain unicode dashes/newlines/
// long space runs — free-text names are sanitised to ASCII.
function asciiClean(s) {
  return String(s ?? '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function fmtDate(d) {
  if (!d) return ''
  const parts = d.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return d
  const [y, m, day] = parts
  return `${day} ${MONTHS[m - 1]} ${y}`
}

function istTodayDmy() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000)
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`
}

// Local-IST day bounds for a DD-MM-YYYY date (for leave-overlap arithmetic).
function dayBounds(dmy) {
  const [d, m, y] = dmy.split('-')
  const startIso = `${y}-${m}-${d}T00:00:00+05:30`
  const endIso = `${y}-${m}-${d}T23:59:59+05:30`
  return { startIso, endIso, startMs: Date.parse(startIso), endMs: Date.parse(endIso) }
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

// ── Dispatcher ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const kind = req.body?.kind || req.query?.kind || (req.method === 'GET' ? 'hostel' : 'lecture')
  if (kind === 'hostel') return handleHostelAlert(req, res)
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

  // Suppress alerts for students on an active leave that day — a boarder who went
  // home should not get a "missed class" alert to their parents. `date` here is
  // YYYY-MM-DD (see fmtDate). Read under the caller's session so faculty RLS
  // applies; fail closed if the lookup errors (better to block than mis-alert).
  const startIso = `${date}T00:00:00+05:30`
  const endIso = `${date}T23:59:59+05:30`
  const authed = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: leaveRows, error: lErr } = await authed
    .from('leaves').select('lws_id')
    .lte('from_ts', endIso)
    .or(`to_ts.is.null,to_ts.gte.${startIso}`)   // incl. open-ended (to_ts null)
  if (lErr) { res.status(500).json({ ok: false, error: 'Failed to load leaves: ' + lErr.message }); return }
  const onLeaveIds = new Set((leaveRows || []).map(r => r.lws_id))

  const dateLabel = fmtDate(date)
  const redirectNorm = redirectTo ? normMobile(redirectTo) : null

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
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (cronSecret && bearer === cronSecret) {
    // cron
  } else {
    if (!bearer) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
    const anon = createClient(supabaseUrl, supabaseAnon)
    const { data: { user } } = await anon.auth.getUser(bearer)
    if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
    if (user.user_metadata?.role === 'teacher') { res.status(403).json({ ok: false, error: 'Forbidden' }); return }
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

  // ── Load roster + the three exception sources + recipients ──
  const { data: roster, error: rErr } = await svc.from('students')
    .select('lws_id, canonical_name')
    .eq('branch', 'APJ').eq('account_status', 'Active').eq('residential', true)
  if (rErr) { res.status(500).json({ ok: false, error: 'Failed to load roster: ' + rErr.message }); return }

  const { data: attendanceRows, error: aErr } = await svc.from('student_attendance').select('lws_id, status').eq('date', day)
  if (aErr) { res.status(500).json({ ok: false, error: 'Failed to load attendance: ' + aErr.message }); return }

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
  const onLeaveIds = resolveOnLeave(
    // to_ts null → toMs null (open-ended); Date.parse(null) is NaN, which would
    // break the overlap test, so map it explicitly.
    (leaveRows || []).map(r => ({ lwsId: r.lws_id, fromMs: Date.parse(r.from_ts), toMs: r.to_ts == null ? null : Date.parse(r.to_ts) })),
    startMs, endMs,
  )
  const chain = buildDailyChain({ roster: rosterMapped, attendanceRows: attendanceRows || [], checkpointRows: checkpointRows || [], onLeaveIds })
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

  const redirectNorm = redirectTo ? normMobile(redirectTo) : null
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
