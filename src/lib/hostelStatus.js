// The behavioural half of the hostel checkpoint status model, shared by the
// admin Hostel board (pages/Attendance/HostelTab.jsx) and the warden's own
// capture page (pages/HostelAttendance/index.jsx).
//
// Both screens capture the same exceptions against the same five checkpoints
// and write the same `checkpoint_absences` rows, so the tap cycle and the
// definition of "away" have to be one thing. They were copied between the two
// until 2026-09-12, under a comment that read "Mirrors HostelTab."
//
// STATUS_META (labels + Tailwind classes) is deliberately NOT here. The two
// screens render genuinely different sets: the admin board also shows `leave`
// and `late`, which the daily chain DERIVES rather than captures, and it
// colours `present` green where the capture page greys it out. Those are
// presentational differences owned by each screen — merging them would force
// one look on two different jobs.

// Exception status cycle on tap: present -> absent -> sick -> out-pass -> present.
//
// `undefined` IS the present state. Capture here is exception-only — no stored
// row means present — so the cycle starts and ends at "no row" rather than at a
// 'present' string. Do not add one; it would write a row for every boarder
// every day and defeat the whole model.
export const STATUS_CYCLE = {
  undefined: 'absent',
  absent:    'sick',
  sick:      'outpass',
  outpass:   undefined,
}

// For a roll reconciliation, "away" = physically not in the dorm. A boarder
// marked `sick` IS in the dorm and must still be counted in the headcount —
// that is the whole reason this is not simply "has any exception".
export const AWAY_STATUSES = new Set(['absent', 'outpass'])

// One tap. Two defensive details:
//   - `null` is normalised to `undefined` first. Both mean "no exception
//     stored", but a bare object lookup coerces them to the DIFFERENT keys
//     'null' and 'undefined', so a null would silently skip the first step of
//     the cycle instead of advancing to 'absent'.
//   - an unrecognised status returns to present rather than sticking, so a
//     value written by an older client cannot trap the cell.
export function nextStatus(status) {
  return STATUS_CYCLE[status ?? undefined]
}

export function isAway(status) {
  return AWAY_STATUSES.has(status)
}
