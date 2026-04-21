// ── Roll-number enrichment ────────────────────────────────────
import { similarity } from '../validateTags'

const AUTO_MATCH_THRESHOLD = 0.85  // auto-assign roll no
const CANDIDATE_THRESHOLD  = 0.55  // show as suggestion in UI (below → no candidate)

/**
 * Cross-references an Evalbee exam file's student list against the students
 * array and populates evalbee_roll_nos[] and name_variants[].
 *
 * Matching priority (mirrors matchStudents.js but works on snake_case):
 *   1. Exact canonical_name match
 *   2. Exact name_variants[] match
 *   3. Bigram similarity ≥ AUTO_MATCH_THRESHOLD  → auto-match (confidence 'fuzzy')
 *   4. Bigram similarity ≥ CANDIDATE_THRESHOLD   → unresolved with candidate
 *   5. Below CANDIDATE_THRESHOLD                 → unresolved, no candidate
 *
 * @param {Array} students     snake_case array from students_db.json
 * @param {Array} examStudents output of parseExcelFull().students
 *                             each entry must have { name, rollNo }
 * @returns {{
 *   students:   Array,
 *   matched:    Array<{ examName, rollNo, studentName, lwsId, confidence }>,
 *   unresolved: Array<{ examName, rollNo, candidate, candidateScore }>,
 * }}
 */
export function enrichWithRollNos(students, examStudents) {
  const result = students.map(s => ({ ...s }))

  const matched    = []
  const unresolved = []

  for (const es of examStudents) {
    const examName = String(es.name  || '').trim()
    const rollNo   = String(es.rollNo || '').trim()
    if (!examName) continue

    const lower = examName.toLowerCase()

    // ── 1 & 2: exact name / variant match ──────────────────
    let matchIdx = result.findIndex(
      s => s.canonical_name?.toLowerCase() === lower ||
           (s.name_variants || []).some(v => v?.toLowerCase() === lower)
    )

    let confidence = matchIdx >= 0 ? 'exact' : null

    // ── 3: fuzzy match ──────────────────────────────────────
    if (matchIdx < 0) {
      let bestScore = 0
      let bestIdx   = -1
      const seen    = new Set()

      result.forEach((s, i) => {
        const key = s.lws_id || s.canonical_name
        if (seen.has(key)) return
        seen.add(key)

        const score = similarity(lower, (s.canonical_name || '').toLowerCase())
        if (score > bestScore) { bestScore = score; bestIdx = i }

        ;(s.name_variants || []).forEach(v => {
          const vs = similarity(lower, (v || '').toLowerCase())
          if (vs > bestScore) { bestScore = vs; bestIdx = i }
        })
      })

      if (bestScore >= AUTO_MATCH_THRESHOLD) {
        matchIdx   = bestIdx
        confidence = 'fuzzy'
      } else if (bestScore >= CANDIDATE_THRESHOLD) {
        unresolved.push({
          examName,
          rollNo,
          candidate:      bestIdx >= 0 ? result[bestIdx].canonical_name : null,
          candidateScore: bestScore,
        })
        continue
      } else {
        unresolved.push({ examName, rollNo, candidate: null, candidateScore: bestScore })
        continue
      }
    }

    // ── Apply enrichment to matched student ─────────────────
    const s = result[matchIdx]

    if (rollNo && !(s.evalbee_roll_nos || []).includes(rollNo)) {
      s.evalbee_roll_nos = [...(s.evalbee_roll_nos || []), rollNo]
    }

    if (examName !== s.canonical_name && !(s.name_variants || []).includes(examName)) {
      s.name_variants = [...(s.name_variants || []), examName]
    }

    matched.push({
      examName,
      rollNo,
      studentName: s.canonical_name,
      lwsId:       s.lws_id,
      confidence,
    })
  }

  return { students: result, matched, unresolved }
}

/**
 * Applies a manual resolution from the UI (user confirmed an unresolved match).
 * Mutates nothing — returns updated students array.
 */
export function applyManualMatch(students, canonicalName, examName, rollNo) {
  return students.map(s => {
    if (s.canonical_name !== canonicalName) return s
    const updated = { ...s }

    if (rollNo && !(updated.evalbee_roll_nos || []).includes(rollNo)) {
      updated.evalbee_roll_nos = [...(updated.evalbee_roll_nos || []), rollNo]
    }
    if (examName && examName !== updated.canonical_name &&
        !(updated.name_variants || []).includes(examName)) {
      updated.name_variants = [...(updated.name_variants || []), examName]
    }
    return updated
  })
}
