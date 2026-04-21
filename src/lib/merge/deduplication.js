// ── Duplicate detection ───────────────────────────────────────
import { similarity } from '../validateTags'

const DEDUP_NAME_THRESHOLD = 0.75  // Jaccard — catches single-letter typos

/**
 * Finds pairs of students that are likely the same person.
 *
 * Comparison is scoped within each branch group (students with the same
 * branch value). Students with no branch ('') form their own group.
 * Pass branchFilter to restrict the scan to one branch.
 *
 * Detection signals (any triggers inclusion):
 *   - Jaccard bigram similarity of canonical_name ≥ DEDUP_NAME_THRESHOLD
 *   - Identical non-empty mobile number
 *   - Identical non-empty eis_reg_no
 *
 * @param {Array}  students     snake_case students array from students_db.json
 * @param {Object} [opts]
 * @param {string} [opts.branchFilter]  restrict to one branch value ('' = unassigned)
 * @param {number} [opts.threshold]     override DEDUP_NAME_THRESHOLD
 * @returns {Array<{ studentA, studentB, score, reasons }>} sorted by score desc
 */
export function findDuplicateCandidates(students, opts = {}) {
  const { branchFilter, threshold = DEDUP_NAME_THRESHOLD } = opts

  // Group students by branch
  const groups = {}
  for (const s of students) {
    const key = s.branch || ''
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }

  // Determine which groups to scan
  const groupKeys = branchFilter !== undefined
    ? [branchFilter]
    : Object.keys(groups)

  const candidates = []

  for (const key of groupKeys) {
    const group = groups[key] || []
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]

        const reasons = []

        const score = similarity(
          (a.canonical_name || '').toLowerCase(),
          (b.canonical_name || '').toLowerCase(),
        )
        if (score >= threshold) reasons.push('name_similar')

        if (a.mobile && b.mobile && a.mobile === b.mobile) reasons.push('same_mobile')

        if (a.eis_reg_no && b.eis_reg_no && a.eis_reg_no === b.eis_reg_no) {
          reasons.push('same_eis')
        }

        if (reasons.length > 0) {
          candidates.push({ studentA: a, studentB: b, score, reasons })
        }
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}
