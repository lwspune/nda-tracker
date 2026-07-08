import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { buildDailyChain, resolveOnLeave, buildWardenAlert } from '../src/lib/analytics/chain.js'

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

// Local-IST day bounds for a DD-MM-YYYY date (for leave-overlap arithmetic).
function dayBounds(dmy) {
  const [d, m, y] = dmy.split('-')
  const startIso = `${y}-${m}-${d}T00:00:00+05:30`
  const endIso = `${y}-${m}-${d}T23:59:59+05:30`
  return { startIso, endIso, startMs: Date.parse(startIso), endMs: Date.parse(endIso) }
}

async function sendWabridge(appKey, authKey, deviceId, templateId, destination, variables) {
  const payload = {
    'app-key': appKey, 'auth-key': authKey,
    'destination_number': destination, 'device_id': deviceId,
    'template_id': templateId, variables,
  }
  try {
    const r = await fetch(WABRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await r.json()
    if (data.status) return { ok: true, detail: String(data.data?.messageid || 'ok') }
    return { ok: false, detail: data.message || 'Unknown error' }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
}

// Hostel warden alert — the "fell off the chain, unexplained" list for APJ
// boarders on a given day. The chain is RECOMPUTED server-side from the tables
// (single source of truth; never trusts a client-sent list). Triggered by:
//   • Admin (POST + admin JWT) — manual button; supports { dryRun, redirectTo, date }.
//   • Vercel cron (GET, Authorization: Bearer <CRON_SECRET>) — cron-ready, not yet scheduled.
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

  const { data: leaveRows, error: lErr } = await svc.from('leaves').select('lws_id, from_ts, to_ts').lte('from_ts', endIso).gte('to_ts', startIso)
  if (lErr) { res.status(500).json({ ok: false, error: 'Failed to load leaves: ' + lErr.message }); return }

  const { data: stateRow, error: sErr } = await svc.from('faculty_state').select('data').eq('id', 1).single()
  if (sErr) { res.status(500).json({ ok: false, error: 'Failed to load faculty_state: ' + sErr.message }); return }
  const recipientsRaw = stateRow?.data?.hostelAlertMobiles || []

  // ── Recompute the chain + shape the alert ──
  const rosterMapped = (roster || []).map(s => ({ lwsId: s.lws_id, name: s.canonical_name }))
  const onLeaveIds = resolveOnLeave(
    (leaveRows || []).map(r => ({ lwsId: r.lws_id, fromMs: Date.parse(r.from_ts), toMs: Date.parse(r.to_ts) })),
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
