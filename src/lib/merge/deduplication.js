// ── Duplicate detection ───────────────────────────────────────
import { similarity } from '../validateTags'

const DEDUP_NAME_THRESHOLD = 0.75  // Jaccard — catches single-letter typos
const TOKEN_EDIT_MIN_LEN   = 5     // protects Anil/Sunil/Amit class from false positives
const TOKEN_EDIT_MAX_DIST  = 2     // catches V/W, l/i, double-letter swaps
const TOKEN_PREFIX_MIN_LEN = 4     // protects Anu/Raj/Om from matching every Anu* profile

// Levenshtein distance — small DP. Used by the name_token_edit signal to
// surface candidates whose Jaccard score sits below 0.75 because the
// differing letters appear twice in the bigram window (V/W in "Vardhamane"
// vs "Wardhamane" flips both " v"/"va" and " w"/"wa" — Jaccard 0.73).
function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

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
 * Signals:
 *   - name_similar     — Jaccard bigram ≥ threshold (default 0.75)
 *   - name_subset      — all tokens of shorter name appear in longer (≥ 2 tokens)
 *   - name_token_edit  — ≥ 2 tokens on each side; exactly 1 unique token per side;
 *                        Levenshtein ≤ 2 on the unique pair; min(token len) ≥ 5
 *   - name_token_prefix — single-token exam name (length ≥ 4) that exactly matches
 *                         one of a multi-token profile's tokens
 *
 * Multiple signals can fire on the same pair; the UI badge list shows all.
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

      // name_token_edit — order-independent, token-anchored fuzzy match.
      // Both sides need ≥ 2 tokens, exactly one token unique to each side,
      // Levenshtein ≤ 2, and min length ≥ 5 to avoid Anil/Sunil-class noise.
      if (examTokens.length >= 2 && profileTokens.length >= 2) {
        const examSet    = new Set(examTokens)
        const profileSet = new Set(profileTokens)
        const examOnly    = examTokens.filter(t => !profileSet.has(t))
        const profileOnly = profileTokens.filter(t => !examSet.has(t))
        if (examOnly.length === 1 && profileOnly.length === 1) {
          const a = examOnly[0], b = profileOnly[0]
          if (Math.min(a.length, b.length) >= TOKEN_EDIT_MIN_LEN
              && levenshtein(a, b) <= TOKEN_EDIT_MAX_DIST) {
            reasons.push('name_token_edit')
          }
        }
      }

      // name_token_prefix — single-token exam name that matches some token in
      // a multi-token profile. Required because name_subset needs ≥ 2 shorter
      // tokens, so 1-token exam records (e.g. "Rajivkumar") are invisible to it.
      if (examTokens.length === 1
          && examTokens[0].length >= TOKEN_PREFIX_MIN_LEN
          && profileTokens.length >= 2
          && profileTokens.includes(examTokens[0])) {
        reasons.push('name_token_prefix')
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
