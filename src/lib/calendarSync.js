// Pure reconcile logic for syncing teacher teaching-blocks to Google Calendar.
// No network / no Google client here — those live in api/_googleCalendar.js.
// The endpoint (api/sync-calendar.js) wires these pure fns to the Google client.
//
// A "block" = one teacher's one recurring teaching period:
//   blockKey  = `${teacherId}|${timetableId}|${slotId}|${day}`  (stable identity)
//   signature = hash of the block's content (start/end/label/batch/branch/email)
// Keying by (teacher, timetable, slot, day) makes a teacher swap clean: the old
// teacher's key disappears (released) and the new teacher's appears (added).

const DAY_TO_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
const DAY_TO_RRULE = { Sunday: 'SU', Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA' }

// Parse "9:30 AM" / "2:50PM" / "13:45" → { h, m } in 24h. Returns null if unparseable.
function parseClock(str) {
  if (!str) return null
  const s = String(str).trim().toUpperCase()
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const m = parseInt(m12[2], 10)
    if (m >= 60 || h < 1 || h > 12) return null
    if (m12[3] === 'PM' && h !== 12) h += 12
    if (m12[3] === 'AM' && h === 12) h = 0
    return { h, m }
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10), m = parseInt(m24[2], 10)
    if (h > 23 || m >= 60) return null
    return { h, m }
  }
  return null
}

const pad = n => String(n).padStart(2, '0')

// Stable content fingerprint for change detection (NOT identity — that's blockKey).
export function blockSignature({ startTime, endTime, label, batchName, branch, teacherEmail }) {
  return [startTime, endTime, label, batchName, branch, teacherEmail].join('|')
}

// Walk every timetable → slot → day; emit a block for each class cell whose
// mapping resolves to a teacher WITH an email (an attendee is required to land
// the event on the teacher's calendar). Skips breaks, __span rows, unassigned
// mappings, missing mappings, and email-less teachers.
// Pass refYmd (the sync date) to fold the current window into each block's
// signature, so a weekly re-sync rolls the dates (signature changes → patch);
// omit it (date-agnostic signature) only for tests / non-windowed callers.
export function buildTeacherBlocks(timetables, mappings, teachers, refYmd = null) {
  const mapById = new Map((mappings ?? []).map(m => [m.id, m]))
  const teacherById = new Map((teachers ?? []).map(t => [t.id, t]))
  const win = refYmd ? computeWindow(refYmd) : null
  const blocks = []

  for (const tt of timetables ?? []) {
    const grid = tt.grid ?? {}
    for (const slot of tt.timeSlots ?? []) {
      const row = grid[slot.id]
      if (!row || row.__span) continue
      for (const [day, cell] of Object.entries(row)) {
        if (day === '__span') continue
        if (!cell || cell.type !== 'class') continue
        const mapping = mapById.get(cell.mappingId)
        if (!mapping || !mapping.teacherId) continue
        const teacher = teacherById.get(mapping.teacherId)
        if (!teacher || !(teacher.email || '').trim()) continue
        const block = {
          blockKey: `${teacher.id}|${tt.id}|${slot.id}|${day}`,
          teacherId: teacher.id,
          teacherName: teacher.name,
          teacherEmail: teacher.email.trim(),
          timetableId: tt.id,
          slotId: slot.id,
          day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          label: mapping.label,
          subject: mapping.subject ?? null,
          batchName: tt.batchName,
          branch: tt.branch,
        }
        block.signature = blockSignature(block)
        if (win) block.signature += `|${nextDateForWeekday(day, win.anchorFrom)}|${win.untilUtc}`
        blocks.push(block)
      }
    }
  }
  // Deterministic order — keeps diffs/tests stable.
  blocks.sort((a, b) => a.blockKey.localeCompare(b.blockKey))
  return blocks
}

// Reconcile desired blocks against the persisted ledger rows.
// ledger row shape: { block_key, signature, event_id }
// → { toCreate: block[], toUpdate: (block & {eventId})[], toDelete: {blockKey,eventId}[] }
export function diffBlocks(desired, ledger) {
  const ledgerByKey = new Map((ledger ?? []).map(r => [r.block_key, r]))
  const desiredKeys = new Set((desired ?? []).map(b => b.blockKey))

  const toCreate = []
  const toUpdate = []
  for (const b of desired ?? []) {
    const existing = ledgerByKey.get(b.blockKey)
    if (!existing) toCreate.push(b)
    else if (existing.signature !== b.signature) toUpdate.push({ ...b, eventId: existing.event_id })
  }
  const toDelete = []
  for (const r of ledger ?? []) {
    if (!desiredKeys.has(r.block_key)) toDelete.push({ blockKey: r.block_key, eventId: r.event_id })
  }
  return { toCreate, toUpdate, toDelete }
}

// First date on/after `refYmd` (a 'YYYY-MM-DD' string) that falls on `dayName`.
// UTC arithmetic — no local-timezone drift, deterministic for tests.
export function nextDateForWeekday(dayName, refYmd) {
  const [Y, M, D] = refYmd.split('-').map(Number)
  const base = new Date(Date.UTC(Y, M - 1, D))
  const delta = (DAY_TO_NUM[dayName] - base.getUTCDay() + 7) % 7
  base.setUTCDate(base.getUTCDate() + delta)
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`
}

// Internal date helpers (UTC arithmetic — no local-tz drift).
function ymdToUTC(ymd) { const [Y, M, D] = ymd.split('-').map(Number); return new Date(Date.UTC(Y, M - 1, D)) }
function utcToYmd(dt) { return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` }
function addDays(ymd, n) { const d = ymdToUTC(ymd); d.setUTCDate(d.getUTCDate() + n); return utcToYmd(d) }

// The "remaining-current-week + next-week" window for a sync run anchored at
// refYmd (IST date 'YYYY-MM-DD'):
// - anchorFrom: each block's first occurrence is the next weekday on/after this
//   date — = today for Mon–Sat (so already-passed days this week roll to next
//   week), = tomorrow's Monday when synced on a Sunday (which has no teaching).
// - untilUtc: RRULE UNTIL = NEXT week's Saturday, 23:59:59 IST (→ UTC `Z`), so a
//   passed weekday gets 1 occurrence (next week only) and an upcoming one gets 2.
export function computeWindow(refYmd) {
  const dow = ymdToUTC(refYmd).getUTCDay() // 0=Sun .. 6=Sat
  const monday = dow === 0 ? addDays(refYmd, 1) : addDays(refYmd, -(dow - 1))
  const anchorFrom = dow === 0 ? monday : refYmd
  const untilDate = addDays(monday, 12) // next week's Saturday
  const untilUtc = untilDate.replace(/-/g, '') + 'T182959Z' // 23:59:59 IST = 18:29:59Z
  return { anchorFrom, untilUtc, untilDate }
}

// Build the Google Calendar event resource for a block. `refYmd` anchors the
// first occurrence; the RRULE then repeats it weekly. Times are emitted as
// local wall-clock + an explicit Asia/Kolkata zone (India has no DST), so no
// offset math is needed.
export function toGCalEvent(block, refYmd) {
  const { anchorFrom, untilUtc } = computeWindow(refYmd)
  const date = nextDateForWeekday(block.day, anchorFrom)
  const s = parseClock(block.startTime)
  const e = parseClock(block.endTime)
  const fmt = t => `${date}T${pad(t.h)}:${pad(t.m)}:00`
  const batchLabel = block.batchName ? ` · ${block.branch} ${block.batchName}` : ''
  return {
    summary: `${block.label}${batchLabel}`,
    location: block.branch || undefined,
    start: { dateTime: fmt(s), timeZone: 'Asia/Kolkata' },
    end: { dateTime: fmt(e), timeZone: 'Asia/Kolkata' },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${DAY_TO_RRULE[block.day]};UNTIL=${untilUtc}`],
    attendees: [{ email: block.teacherEmail }],
    transparency: 'opaque', // shows the teacher as busy
    extendedProperties: { private: { blockKey: block.blockKey, signature: block.signature } },
  }
}
