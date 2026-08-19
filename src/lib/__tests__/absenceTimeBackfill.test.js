import { describe, it, expect } from 'vitest'
import { planAbsenceTimeBackfill } from '../absenceTimeBackfill'

// A timetabled lecture_absences row stores no clock time — it re-derives one
// from the slot row at render time (absentRoster.js). That makes history
// MUTABLE: retime the slot and every past absence filed against it silently
// re-renders at the new time. This backfill stamps each historical row with the
// time it actually ran at, so a future retime cannot reach backwards.
//
// The invariant under test: freeze what already happened, touch nothing else.

const SLOT_TIMES = {
  slot_a: { startTime: '1:45 PM', endTime: '2:50 PM' },
  slot_b: { startTime: '9:30 AM', endTime: '10:50 AM' },
  slot_gone: undefined,
}

const row = (over = {}) => ({
  lws_id: 'LWS001',
  date: '2026-07-16',
  slot_id: 'slot_a',
  subject: 'Maths',
  start_time: null,
  end_time: null,
  ...over,
})

describe('planAbsenceTimeBackfill', () => {
  it('stamps a timetabled row with its slot\'s current time', () => {
    const out = planAbsenceTimeBackfill({ rows: [row()], slotTimes: SLOT_TIMES })
    expect(out).toEqual([
      { lws_id: 'LWS001', date: '2026-07-16', slot_id: 'slot_a', start_time: '1:45 PM', end_time: '2:50 PM' },
    ])
  })

  // Re-running the migration must not overwrite a time already frozen — that
  // would re-introduce the drift on a second run against a retimed slot.
  it('is idempotent — a row that already carries a time is skipped', () => {
    const already = row({ start_time: '1:45 PM', end_time: '2:50 PM' })
    expect(planAbsenceTimeBackfill({ rows: [already], slotTimes: SLOT_TIMES })).toEqual([])
  })

  it('skips a row whose start_time is set even when end_time is null', () => {
    const half = row({ start_time: '1:45 PM', end_time: null })
    expect(planAbsenceTimeBackfill({ rows: [half], slotTimes: SLOT_TIMES })).toEqual([])
  })

  // An impromptu period already persists its own time and has no timetable slot
  // to consult. Detected by the `adhoc_` prefix, never by a null start_time.
  it('leaves impromptu (adhoc_) rows alone', () => {
    const adhoc = row({ slot_id: 'adhoc_x1', start_time: '4:00 PM', end_time: '5:00 PM' })
    expect(planAbsenceTimeBackfill({ rows: [adhoc], slotTimes: SLOT_TIMES })).toEqual([])
  })

  // A deleted slot leaves nothing to copy. Inventing a time would be worse than
  // leaving the row blank, so it is reported, not guessed.
  it('does not invent a time for a row whose slot no longer exists', () => {
    const orphan = row({ slot_id: 'slot_gone' })
    const out = planAbsenceTimeBackfill({ rows: [orphan], slotTimes: SLOT_TIMES })
    expect(out).toEqual([])
  })

  it('reports orphans separately so a silent skip cannot hide them', () => {
    const { updates, orphans } = planAbsenceTimeBackfill(
      { rows: [row(), row({ slot_id: 'slot_gone' })], slotTimes: SLOT_TIMES },
      { withReport: true },
    )
    expect(updates).toHaveLength(1)
    expect(orphans).toEqual(['slot_gone'])
  })

  it('skips a slot present in the index but missing a start time', () => {
    const slotTimes = { slot_c: { startTime: null, endTime: null } }
    const out = planAbsenceTimeBackfill({ rows: [row({ slot_id: 'slot_c' })], slotTimes })
    expect(out).toEqual([])
  })

  it('handles a mixed batch, preserving row identity for the upsert key', () => {
    const rows = [
      row({ lws_id: 'A', slot_id: 'slot_a' }),
      row({ lws_id: 'B', slot_id: 'slot_b', date: '2026-08-04' }),
      row({ lws_id: 'C', start_time: '1:45 PM' }),
      row({ lws_id: 'D', slot_id: 'adhoc_z' }),
    ]
    const out = planAbsenceTimeBackfill({ rows, slotTimes: SLOT_TIMES })
    expect(out).toEqual([
      { lws_id: 'A', date: '2026-07-16', slot_id: 'slot_a', start_time: '1:45 PM', end_time: '2:50 PM' },
      { lws_id: 'B', date: '2026-08-04', slot_id: 'slot_b', start_time: '9:30 AM', end_time: '10:50 AM' },
    ])
  })

  it('tolerates empty / missing input', () => {
    expect(planAbsenceTimeBackfill({ rows: [], slotTimes: {} })).toEqual([])
    expect(planAbsenceTimeBackfill({})).toEqual([])
    expect(planAbsenceTimeBackfill()).toEqual([])
  })
})
