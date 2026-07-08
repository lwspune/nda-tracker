// Daily attendance CHAIN for hostel boarders (APJ branch).
//
// A boarder's day is a sequence of checkpoints:
//   hostel_am → breakfast → class → lunch → dinner → hostel_pm
// The `class` checkpoint is DERIVED from daily attendance (student_attendance);
// the four hostel/mess checkpoints come from checkpoint_absences (exception rows
// — a row means a deviation, no row means present). Lectures (lecture_absences)
// are intentionally left out of the Phase-1 chain.
//
// The point of the chain is same-day safety: surface a boarder who "fell off the
// chain" — an UNEXPLAINED absence at some checkpoint with nothing on file. Every
// gap resolves to explained (leave / sick / out-pass) or anomaly (bare 'absent').
//
// Pure + deterministic: all date/leave-window arithmetic happens in the caller
// (see resolveOnLeave for the leave→date resolution helper). This file never
// reads the clock or the DB.

export const CHECKPOINT_ORDER = ['hostel_am', 'breakfast', 'class', 'lunch', 'dinner', 'hostel_pm']

// Which checkpoint statuses count as an unexplained break in the chain.
// 'sick' / 'outpass' / 'leave' / 'late' are all explained → not anomalies.
const ANOMALY_STATUS = 'absent'

// Resolve which students have an approved leave/out-pass covering a given day.
// A leave covers the day when its [fromMs, toMs] window overlaps the day's
// [dayStartMs, dayEndMs] window (boundaries inclusive). Day-granular: partial
// single-checkpoint deviations are captured as an 'outpass' checkpoint status,
// not as a leave row.
//   leaves: [{ lwsId, fromMs, toMs }]  (caller maps from_ts/to_ts → epoch ms)
export function resolveOnLeave(leaves = [], dayStartMs, dayEndMs) {
  const covered = new Set()
  for (const l of leaves) {
    if (l == null) continue
    if (l.fromMs <= dayEndMs && l.toMs >= dayStartMs) covered.add(l.lwsId)
  }
  return covered
}

// Map a daily-attendance status letter to a class-checkpoint status.
function classStatusFromAttendance(letter) {
  if (letter === 'A') return 'absent'
  if (letter === 'L') return 'late'
  return 'present' // P / '-' / missing row → present (default-present)
}

// Build the per-boarder daily chain.
//   roster:          [{ lwsId, name, ... }] — boarders to include (order preserved)
//   attendanceRows:  [{ lws_id, status }]   — student_attendance for the date
//   checkpointRows:  [{ lws_id, checkpoint, status }] — checkpoint_absences for the date
//   onLeaveIds:      Set<lwsId> — from resolveOnLeave
//   order:           checkpoint order (defaults to CHECKPOINT_ORDER)
// Returns [{ lwsId, name, statuses:{cp:status}, anomaly, firstBreak, onLeave }].
export function buildDailyChain({
  roster = [],
  attendanceRows = [],
  checkpointRows = [],
  onLeaveIds = new Set(),
  order = CHECKPOINT_ORDER,
} = {}) {
  // Index the two exception sources by student for O(1) lookup.
  const attendanceByStudent = new Map()
  for (const r of attendanceRows) attendanceByStudent.set(r.lws_id, r.status)

  const checkpointByStudent = new Map() // lwsId → { checkpoint: status }
  for (const r of checkpointRows) {
    if (!checkpointByStudent.has(r.lws_id)) checkpointByStudent.set(r.lws_id, {})
    checkpointByStudent.get(r.lws_id)[r.checkpoint] = r.status
  }

  return roster.map(student => {
    const { lwsId } = student
    const onLeave = onLeaveIds.has(lwsId)
    const cpRows = checkpointByStudent.get(lwsId) || {}

    const statuses = {}
    let firstBreak = null
    for (const cp of order) {
      let status
      if (onLeave) {
        status = 'leave' // an active leave explains every checkpoint
      } else if (cp === 'class') {
        status = classStatusFromAttendance(attendanceByStudent.get(lwsId))
      } else if (cp in cpRows) {
        status = cpRows[cp]
      } else {
        status = 'present'
      }
      statuses[cp] = status
      if (firstBreak === null && status === ANOMALY_STATUS) firstBreak = cp
    }

    return { ...student, statuses, anomaly: firstBreak !== null, firstBreak, onLeave }
  })
}
