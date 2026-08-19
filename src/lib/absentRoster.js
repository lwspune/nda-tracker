import { parseTimeToMinutes } from './timetable.js'

// Turns the day's raw `lecture_absences` rows into a per-STUDENT roster:
// who missed something today, which periods, and whether they've been notified.
//
// The Lecture log's period cards only ever showed a COUNT — the names lived
// inside the mark-absentees modal, one period at a time, so there was no way to
// read the day as "these seven students missed something". This is that read.
//
// Pure: no store, no fetch. The component supplies the rows and the lookups.

// slotId → { startTime, endTime }, across every timetable.
//
// Timetabled `lecture_absences` rows leave start_time NULL and re-derive their
// clock time from the timetable (only impromptu rows persist it), so the roster
// needs this to show a time. Slot ids are per-timetable and two batches can
// legitimately share one — first timetable wins, which is fine because the time
// here is display-only and never a join key.
export function buildSlotTimeIndex(timetables) {
  const index = {}
  for (const t of timetables ?? []) {
    for (const slot of t?.timeSlots ?? []) {
      if (!slot?.id || index[slot.id]) continue
      index[slot.id] = { startTime: slot.startTime ?? null, endTime: slot.endTime ?? null }
    }
  }
  return index
}

// rows            — lecture_absences rows for one date: { lws_id, slot_id, subject, start_time?, end_time? }
// studentProfiles — the store's canonical-name-keyed map (values carry lwsId/name/batches)
// slotTimes       — buildSlotTimeIndex output
// batchName       — null/'' = every batch; otherwise only students in that batch
// notifiedLwsIds  — Set of ids already sent a lecture-miss message
//
// Returns [{ lwsId, name, batches, periods: [{ subject, startTime, endTime }], notified }]
// sorted by name, each student's periods sorted by clock time.
export function buildAbsentRoster({
  rows,
  studentProfiles,
  slotTimes = {},
  batchName = null,
  notifiedLwsIds = null,
}) {
  const profileByLwsId = new Map()
  for (const p of Object.values(studentProfiles ?? {})) {
    if (p?.lwsId && !profileByLwsId.has(p.lwsId)) profileByLwsId.set(p.lwsId, p)
  }
  const notified = notifiedLwsIds instanceof Set ? notifiedLwsIds : new Set(notifiedLwsIds ?? [])

  const byStudent = new Map()
  for (const r of rows ?? []) {
    if (!r?.lws_id || !r.slot_id) continue // legacy/orphan rows without slot_id are skipped
    const profile = profileByLwsId.get(r.lws_id) ?? null
    const batches = Array.isArray(profile?.batches) ? profile.batches : []

    // A batch filter can only honestly include someone whose batch we know, so
    // a profile-less row is dropped there and kept in all-batches mode — the
    // day's headcount never silently loses a student.
    if (batchName && !batches.includes(batchName)) continue

    if (!byStudent.has(r.lws_id)) {
      byStudent.set(r.lws_id, {
        lwsId: r.lws_id,
        name: profile?.name ?? r.lws_id,
        batches,
        periods: [],
        notified: notified.has(r.lws_id),
      })
    }
    const slot = slotTimes?.[r.slot_id] ?? null
    byStudent.get(r.lws_id).periods.push({
      subject:   r.subject ?? null,
      // Impromptu rows carry their own time; timetabled rows re-derive it.
      startTime: r.start_time ?? slot?.startTime ?? null,
      endTime:   r.end_time ?? slot?.endTime ?? null,
    })
  }

  const out = [...byStudent.values()]
  for (const s of out) {
    s.periods.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime))
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}
