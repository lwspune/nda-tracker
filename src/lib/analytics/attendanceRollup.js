// Branch-wise attendance roll-up for a single recorded date.
//
// Two buckets only: Absent = students whose status is 'A' that day; Present =
// every enrolled member who is NOT absent (status P / L / '-' / no record at all).
// Cohort is Active-only. Late is NOT a separate bucket.
//
// Returns name lists (not just counts) so the dashboard's drill-down can show
// who is behind each number. Shape:
//   { [branch]: { [batch]: { male:   { present:[names], absent:[names] },
//                            female: { present:[names], absent:[names] } } } }
//
// Branch grouping comes from syllabusBatchBranches (batch → branch), falling back
// to profile.branch when a batch isn't mapped. A multi-batch student is counted
// under each of their batches. Variant-keyed profile entries are skipped via
// `p.name === key` (same guard as getExamAbsentees) so each student counts once.
//
// `offReason(lwsId)` → holiday name | null for this date (src/lib/holidays.js).
// A member on their day off is in neither bucket — the register marks everyone
// 'A' on a holiday. Each batch carries `holiday`: the name when EVERY member is
// off (the row then reads "Holiday"), else null.
export function buildAttendanceRollup({ attendanceRows = [], studentProfiles = {}, syllabusBatchBranches = {}, offReason = null }) {
  const absentSet = new Set(
    attendanceRows.filter(r => r.status === 'A').map(r => r.lws_id)
  )

  const rollup = {}
  const slot = (branch, batch) => {
    if (!rollup[branch]) rollup[branch] = {}
    if (!rollup[branch][batch]) {
      rollup[branch][batch] = {
        male:   { present: [], absent: [] },
        female: { present: [], absent: [] },
        holiday: undefined, // undefined = no member yet; resolved to name | null below
      }
    }
    return rollup[branch][batch]
  }

  for (const [key, p] of Object.entries(studentProfiles)) {
    if (!p || p.name !== key) continue          // skip variant-keyed entries
    if (p.accountStatus !== 'Active') continue  // Active-only cohort
    const batches = p.batches || []
    if (batches.length === 0) continue          // can't place without a batch

    const gender = p.gender === 'Female' ? 'female' : 'male'
    const bucket = absentSet.has(p.lwsId) ? 'absent' : 'present'
    const off = offReason ? offReason(p.lwsId) : null

    for (const batch of batches) {
      const branch = syllabusBatchBranches[batch] || p.branch || 'Unknown'
      const s = slot(branch, batch)
      // A batch is a holiday only while every member seen so far is off.
      s.holiday = s.holiday === undefined ? (off || null) : (s.holiday && off ? s.holiday : null)
      if (!off) s[gender][bucket].push(p.name)
    }
  }

  return rollup
}
