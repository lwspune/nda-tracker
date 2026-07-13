/**
 * Returns the branch shared by at least `threshold` (default 80%) of the
 * students that actually have a branch set. Blank/absent branches are ignored
 * in the denominator — the question is "of those with a branch, does one branch
 * dominate?". Returns '' when no branch clears the threshold (or none are set).
 *
 * Used to pre-select the import modal's "Set branch" default: the roster is
 * effectively single-branch, so make the common case free while staying safe —
 * the write is fill-only, so a wrong guess can never move an existing student.
 *
 * @param {Array<{branch?: string}>} students
 * @param {number} [threshold=0.8] - share (0..1) the top branch must reach
 * @returns {string} the dominant branch, or '' if none qualifies
 */
export function dominantBranch(students, threshold = 0.8) {
  const counts = new Map()
  let branched = 0
  for (const s of students || []) {
    const branch = String(s?.branch ?? '').trim()
    if (!branch) continue
    counts.set(branch, (counts.get(branch) || 0) + 1)
    branched++
  }
  if (branched === 0) return ''

  let topBranch = ''
  let topCount = 0
  for (const [branch, count] of counts) {
    if (count > topCount) {
      topCount = count
      topBranch = branch
    }
  }

  return topCount / branched >= threshold ? topBranch : ''
}
