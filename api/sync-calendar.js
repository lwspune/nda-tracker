import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { buildTeacherBlocks, diffBlocks, toGCalEvent } from '../src/lib/calendarSync.js'
import { getAccessToken, insertEvent, patchEvent, deleteEvent } from './_googleCalendar.js'

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

// "Today" in IST (Asia/Kolkata, no DST) as YYYY-MM-DD — anchors the first
// occurrence of each weekly block.
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

// Run async tasks with bounded concurrency (avoid Calendar rate limits / huge bursts).
async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return }

  const env = readEnvLocal()
  const pick = k => env[k] || process.env[k] || ''
  const supabaseUrl = pick('VITE_SUPABASE_URL')
  const supabaseAnon = pick('VITE_SUPABASE_ANON_KEY')
  const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY')
  const calendarId = pick('FACULTY_CALENDAR_ID')
  const google = {
    clientId: pick('GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: pick('GOOGLE_OAUTH_CLIENT_SECRET'),
    refreshToken: pick('GOOGLE_OAUTH_REFRESH_TOKEN'),
  }

  if (!serviceKey) { res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }); return }
  if (!calendarId || !google.clientId || !google.clientSecret || !google.refreshToken) {
    res.status(500).json({ ok: false, error: 'Google Calendar env not configured (GOOGLE_OAUTH_* / FACULTY_CALENDAR_ID)' }); return
  }

  // ── Admin gate (reject teachers — they must never trigger calendar writes) ──
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anon = createClient(supabaseUrl, supabaseAnon)
  const { data: { user } } = await anon.auth.getUser(jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  if (user.user_metadata?.role === 'teacher') { res.status(403).json({ ok: false, error: 'Forbidden' }); return }

  const { dryRun = false, teacherId = null } = req.body || {}

  const svc = createClient(supabaseUrl, serviceKey)

  // ── Load timetable data + ledger ──
  const { data: stateRow, error: stateErr } = await svc.from('faculty_state').select('data').eq('id', 1).single()
  if (stateErr) { res.status(500).json({ ok: false, error: 'Failed to load faculty_state: ' + stateErr.message }); return }
  const d = stateRow.data || {}

  const refYmd = istToday()
  let desired = buildTeacherBlocks(d.timetables || [], d.timetableMappings || [], d.timetableTeachers || [], refYmd)
  let ledgerQ = svc.from('teacher_calendar_blocks').select('block_key, teacher_id, event_id, signature')
  if (teacherId) { desired = desired.filter(b => b.teacherId === teacherId); ledgerQ = ledgerQ.eq('teacher_id', teacherId) }
  const { data: ledger, error: ledErr } = await ledgerQ
  if (ledErr) { res.status(500).json({ ok: false, error: 'Failed to load ledger: ' + ledErr.message }); return }

  const { toCreate, toUpdate, toDelete } = diffBlocks(desired, ledger || [])

  if (dryRun) {
    res.status(200).json({
      ok: true, dryRun: true,
      summary: { create: toCreate.length, update: toUpdate.length, delete: toDelete.length, desired: desired.length, ledger: (ledger || []).length },
      sample: {
        create: toCreate.slice(0, 5).map(b => `${b.teacherName}: ${b.day} ${b.startTime} ${b.label} (${b.batchName})`),
        delete: toDelete.slice(0, 5).map(x => x.blockKey),
      },
    })
    return
  }

  // ── Execute against Google + reconcile the ledger ──
  let token
  try { token = await getAccessToken(google) }
  catch (e) { res.status(502).json({ ok: false, error: 'Google auth failed: ' + e.message }); return }

  const errors = []
  let created = 0, updated = 0, deleted = 0

  await mapLimit(toCreate, 4, async (b) => {
    const r = await insertEvent(token, calendarId, toGCalEvent(b, refYmd))
    if (!r.ok) { errors.push(`create ${b.blockKey}: ${r.error}`); return }
    const { error } = await svc.from('teacher_calendar_blocks').upsert({
      block_key: b.blockKey, teacher_id: b.teacherId, event_id: r.id,
      calendar_id: calendarId, signature: b.signature, synced_at: new Date().toISOString(),
    })
    if (error) { errors.push(`ledger-create ${b.blockKey}: ${error.message}`); return }
    created++
  })

  await mapLimit(toUpdate, 4, async (b) => {
    const r = await patchEvent(token, calendarId, b.eventId, toGCalEvent(b, refYmd))
    if (!r.ok) { errors.push(`update ${b.blockKey}: ${r.error}`); return }
    const { error } = await svc.from('teacher_calendar_blocks').upsert({
      block_key: b.blockKey, teacher_id: b.teacherId, event_id: b.eventId,
      calendar_id: calendarId, signature: b.signature, synced_at: new Date().toISOString(),
    })
    if (error) { errors.push(`ledger-update ${b.blockKey}: ${error.message}`); return }
    updated++
  })

  await mapLimit(toDelete, 4, async (x) => {
    const r = await deleteEvent(token, calendarId, x.eventId)
    if (!r.ok) { errors.push(`delete ${x.blockKey}: ${r.error}`); return }
    const { error } = await svc.from('teacher_calendar_blocks').delete().eq('block_key', x.blockKey)
    if (error) { errors.push(`ledger-delete ${x.blockKey}: ${error.message}`); return }
    deleted++
  })

  res.status(200).json({ ok: true, dryRun: false, created, updated, deleted, errorCount: errors.length, errors: errors.slice(0, 50) })
}
