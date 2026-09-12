// Cross-check two independent answer keys for the same paper:
//   - the STORED answer   — a tags-file "Answer" column at upload, or, on the
//                           results re-upload path, the exam's own questions[],
//                           whose key may have come from PYQ Vault via a paper push
//   - results-Excel "Q N Key"  (Evalbee's OMR key — extracted.answerKeys)
//
// Both callers pass an array of `{q, answer}`; `exams.questions[]` carries exactly
// those two fields (plus many others, which are ignored), so the re-upload path
// needs no adapter and no second detector.
//
// A disagreement means one of the two is wrong. It does NOT affect student marks
// (those come from Evalbee's per-question verdict in exam_results.responses), but a
// wrong key drives a wrong displayed correct answer + solution + per-question
// analytics via questions[].answer. Surfacing the disagreement lets faculty pick the
// right one before it ships.
//
// Only a genuine conflict counts: both sides must carry a valid A–D letter and differ.
// A blank on either side is a silent fill, not a mismatch.

const LETTER = /^[ABCD]$/

function normLetter(v) {
  const s = String(v ?? '').trim().toUpperCase()
  return LETTER.test(s) ? s : null
}

// Returns [{ q, storedAnswer, resultsAnswer }] sorted by question number.
export function findKeyMismatches(stored, answerKeys) {
  if (!Array.isArray(stored) || !answerKeys) return []
  const mismatches = []
  for (const t of stored) {
    const storedAnswer = normLetter(t.answer)
    const resultsAnswer = normLetter(answerKeys[t.q])
    if (storedAnswer && resultsAnswer && storedAnswer !== resultsAnswer) {
      mismatches.push({ q: t.q, storedAnswer, resultsAnswer })
    }
  }
  return mismatches.sort((a, b) => a.q - b.q)
}

/**
 * Write the resolved keys back onto the questions.
 *
 * Shared by BOTH callers — the upload wizard and the results re-upload — because
 * it is one rule, and a second copy is how one path silently stops honouring a
 * faculty decision. Three cases, in order:
 *
 *   1. a CONFLICT the user resolved  → their pick ('results' by default, matching
 *      the grading authority: marks are Evalbee's verdict, so the displayed answer
 *      agrees with how the paper was actually graded unless someone says otherwise)
 *   2. no conflict, results has a key → it fills a blank or confirms what is there
 *   3. no conflict, no results key    → untouched
 *
 * Never mutates its inputs.
 *
 * @param {Array}  questions   `{q, answer, …}` — tags rows or an exam's questions[]
 * @param {Array}  mismatches  output of findKeyMismatches
 * @param {Object} choices     { [q]: 'results' | 'stored' }
 * @param {Object} answerKeys  { [q]: 'A'|'B'|'C'|'D' } from the results Excel
 */
export function applyKeyChoices(questions, mismatches, choices, answerKeys) {
  if (!Array.isArray(questions)) return []
  const keys = answerKeys || {}
  const byQ = {}
  for (const m of mismatches || []) byQ[m.q] = m

  return questions.map(q => {
    const mm = byQ[q.q]
    if (mm) {
      const src = (choices || {})[q.q] || 'results'
      return { ...q, answer: src === 'stored' ? mm.storedAnswer : mm.resultsAnswer }
    }
    return keys[q.q] ? { ...q, answer: keys[q.q] } : q
  })
}
