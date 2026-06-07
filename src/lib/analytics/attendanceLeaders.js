// Dashboard "attendance leaders" — top-N students by absence / late / lecture-miss
// / homework-miss over a window. Pure: the slice does the (windowed) fetch; this
// just counts already-fetched rows and ranks them.
//
// Cohort: Active-only, class-wide. Rows are keyed by lws_id; we map each to its
// canonical profile (skipping variant-keyed entries) and drop any lws_id whose
// profile is missing or not Active — same guards as the attendance roll-up.

/** Build lwsId → { name, branch } for Active, non-variant profiles. */
function activeProfilesByLwsId(studentProfiles) {
  const map = new Map()
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue            // skip variant-keyed duplicates
    if (!p.lwsId) continue
    if (p.accountStatus !== 'Active') continue     // class-wide but Active-only
    if (!map.has(p.lwsId)) map.set(p.lwsId, { name: p.name, branch: p.branch || '' })
  }
  return map
}

/** Count rows per lws_id, keep only Active profiles, rank by count desc (name asc tiebreak), take topN. */
function rank(rows, byLwsId, topN) {
  const counts = new Map()
  for (const r of rows) {
    const id = r?.lws_id
    if (!id || !byLwsId.has(id)) continue
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([lwsId, count]) => ({ lwsId, count, ...byLwsId.get(lwsId) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, topN)
}

/**
 * @param {Object} args
 * @param {Array}  args.attendanceRows  [{ lws_id, status }]  (status 'A' = absent, 'L' = late)
 * @param {Array}  args.lectureRows     [{ lws_id }]          one row per missed lecture-period
 * @param {Array}  args.homeworkRows    [{ lws_id }]          one row per flagged homework/notes item
 * @param {Object} args.studentProfiles canonical+variant keyed profile map
 * @param {number} [args.topN=5]
 * @returns {{ absentees, late, homeworkMiss, lectureMiss }} each [{ lwsId, name, branch, count }]
 */
export function buildAttendanceLeaders({ attendanceRows = [], lectureRows = [], homeworkRows = [], studentProfiles = {}, topN = 5 }) {
  const byLwsId = activeProfilesByLwsId(studentProfiles)
  return {
    absentees:    rank(attendanceRows.filter(r => r?.status === 'A'), byLwsId, topN),
    late:         rank(attendanceRows.filter(r => r?.status === 'L'), byLwsId, topN),
    lectureMiss:  rank(lectureRows,  byLwsId, topN),
    homeworkMiss: rank(homeworkRows, byLwsId, topN),
  }
}
