// Freeze the clock time of historical `lecture_absences` rows.
//
// A timetabled absence row stores (student, date, slot_id, subject) and NO
// time — `buildAbsentRoster` re-derives one from the slot row on every render
// (`r.start_time ?? slot?.startTime`). That makes history mutable: retime a
// slot and every past absence filed against it silently re-renders at the new
// time, describing a period that never ran then.
//
// This planner stamps each historical row with the time it actually ran at, so
// a future retime cannot reach backwards. It changes no absence — same student,
// same date, same subject — it only pins down what was already implied.
//
// Pure: no fetch, no store. The migration script supplies rows + slot times
// (from `buildSlotTimeIndex`) and performs the writes.

// A row is impromptu when its slot id carries this prefix. Ad-hoc periods
// persist their own time and have no timetable slot to consult. Detection is by
// the prefix and NEVER by a null start_time — that is exactly what the
// timetabled rows we are backfilling look like before the stamp.
const ADHOC_PREFIX = 'adhoc_'

// { rows, slotTimes } → rows needing a stamp.
//
// rows      — lecture_absences rows: { lws_id, date, slot_id, start_time, end_time }
// slotTimes — buildSlotTimeIndex output: slotId → { startTime, endTime }
//
// Default return is the update list. Pass { withReport: true } for
// { updates, orphans } — orphans are slot ids the rows reference that the
// timetable no longer has, surfaced rather than silently dropped so a shrinking
// update count can't read as "nothing left to do".
export function planAbsenceTimeBackfill({ rows, slotTimes } = {}, { withReport = false } = {}) {
  const updates = []
  const orphans = new Set()

  for (const r of rows ?? []) {
    if (!r?.lws_id || !r.slot_id || !r.date) continue

    // Already frozen. Re-running must not re-stamp from a since-retimed slot,
    // which would re-introduce the very drift this migration removes.
    if (r.start_time) continue

    if (r.slot_id.startsWith(ADHOC_PREFIX)) continue

    const slot = slotTimes?.[r.slot_id]
    if (!slot?.startTime) {
      // No slot, or a slot with no time on it. Inventing one would be worse
      // than leaving the row to render blank.
      orphans.add(r.slot_id)
      continue
    }

    updates.push({
      lws_id: r.lws_id,
      date: r.date,
      slot_id: r.slot_id,
      start_time: slot.startTime,
      end_time: slot.endTime ?? null,
    })
  }

  return withReport ? { updates, orphans: [...orphans] } : updates
}
