// ── Duplicate detection ───────────────────────────────────────
import { similarity } from '../validateTags'

const DEDUP_NAME_THRESHOLD = 0.75  // Jaccard — catches single-letter typos

/**
 * Returns exam-appearing names that have no entry in studentProfiles.
 * studentProfiles is keyed by canonical name AND all name variants, so a name
 * already linked as a variant will be correctly excluded.
 *
 * @param {Array}  exams           store exams array
 * @param {Object} studentProfiles camelCase keyed object from the store
 * @returns {string[]} unmatched exam names (deduplicated, insertion order)
 */
export function getUnmatchedExamNames(exams, studentProfiles) {
  const seen = new Set()
  const unmatched = []
  for (const exam of exams) {
    for (const s of exam.students || []) {
      const name = s.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      if (!studentProfiles[name]) unmatched.push(name)
    }
  }
  return unmatched
}

/**
 * For each unmatched exam name, finds registered profiles whose name is similar
 * enough to suggest they are the same person.
 *
 * Signals: name_similar (Jaccard bigram ≥ threshold) and name_subset (all tokens
 * of the shorter name appear as tokens in the longer name, ≥ 2 tokens required).
 *
 * @param {string[]} unmatchedNames   output of getUnmatchedExamNames
 * @param {Array}    snakeProfiles    snake_case profile objects ({ lws_id, canonical_name, … })
 * @param {Object}   [opts]
 * @param {number}   [opts.threshold] override DEDUP_NAME_THRESHOLD
 * @returns {Array<{ examName, profile, score, reasons }>} sorted by score desc
 */
export function findExamNameCandidates(unmatchedNames, snakeProfiles, opts = {}) {
  const { threshold = DEDUP_NAME_THRESHOLD } = opts
  const candidates = []

  for (const examName of unmatchedNames) {
    const examLower  = examName.toLowerCase()
    const examTokens = examLower.split(/\s+/).filter(Boolean)

    for (const profile of snakeProfiles) {
      const profileLower  = (profile.canonical_name || '').toLowerCase()
      const profileTokens = profileLower.split(/\s+/).filter(Boolean)

      const reasons = []

      const score = similarity(examLower, profileLower)
      if (score >= threshold) reasons.push('name_similar')

      const [shorter, longer] = examTokens.length <= profileTokens.length
        ? [examTokens, profileTokens]
        : [profileTokens, examTokens]
      if (shorter.length >= 2 && shorter.every(t => longer.includes(t))) {
        reasons.push('name_subset')
      }

      if (reasons.length > 0) candidates.push({ examName, profile, score, reasons })
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

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

  // When a specific branch is requested, compare only within that branch.
  // When no filter is set (all-branches scan), compare every student against every
  // other student regardless of branch — cross-branch duplicates must also be caught.
  let group
  if (branchFilter !== undefined) {
    group = students.filter(s => (s.branch || '') === branchFilter)
  } else {
    group = students
  }

  const candidates = []

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

      // Token-subset: all tokens of the shorter name appear in the longer name.
      // Requires ≥ 2 tokens in the shorter name to avoid false positives on
      // single-word surnames that are shared across many unrelated students.
      const tokensA = (a.canonical_name || '').toLowerCase().split(/\s+/).filter(Boolean)
      const tokensB = (b.canonical_name || '').toLowerCase().split(/\s+/).filter(Boolean)
      const [shorter, longer] = tokensA.length <= tokensB.length
        ? [tokensA, tokensB]
        : [tokensB, tokensA]
      if (shorter.length >= 2 && shorter.every(t => longer.includes(t))) {
        reasons.push('name_subset')
      }

      if (a.mobile && b.mobile && a.mobile === b.mobile) reasons.push('same_mobile')

      if (a.eis_reg_no && b.eis_reg_no && a.eis_reg_no === b.eis_reg_no) {
        reasons.push('same_eis')
      }

      if (reasons.length > 0) {
        candidates.push({ studentA: a, studentB: b, score, reasons })
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}
