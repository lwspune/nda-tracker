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
export function buildAttendanceRollup({ attendanceRows = [], studentProfiles = {}, syllabusBatchBranches = {} }) {
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

    for (const batch of batches) {
      const branch = syllabusBatchBranches[batch] || p.branch || 'Unknown'
      slot(branch, batch)[gender][bucket].push(p.name)
    }
  }

  return rollup
}
