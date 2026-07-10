// Pure derivation for the lecture-log Present/Absent toggle.
//
// A teacher shares EITHER a short present list or a short absent list. Faculty
// tap the named students; the mode decides how that tap-set is interpreted. In
// both modes an on-leave student is ALWAYS excluded — a hostel leave already
// explains the absence, so they must never be logged as a lecture absence (nor
// alerted). For a non-hostel branch `onLeaveIds` is empty, so this collapses to
// a plain present/absent toggle with no special-casing.
//
//   rosterIds:   string[]        — everyone expected in the period (pooled union)
//   selectedIds: string[] | Set  — the students the faculty tapped
//   mode:        'absent' | 'present'
//   onLeaveIds:  string[] | Set  — students on an active leave that day
// Returns the absentee lwsIds to log, in roster order.
export function computeAbsentees({ rosterIds = [], selectedIds = [], mode = 'absent', onLeaveIds = [] } = {}) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds)
  const onLeave = onLeaveIds instanceof Set ? onLeaveIds : new Set(onLeaveIds)

  return rosterIds.filter(id => {
    if (onLeave.has(id)) return false               // leave explains it — never absent
    return mode === 'present' ? !selected.has(id)   // present list → the rest are absent
                              : selected.has(id)     // absent list → exactly the tapped
  })
}
