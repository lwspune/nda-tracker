// Cross-check the two independent answer keys present at exam upload:
//   - tags-file "Answer" column       (authored/solved by whoever built the tags file)
//   - results-Excel "Q N Key"         (Evalbee's OMR key — extracted.answerKeys)
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

// Returns [{ q, tagsAnswer, resultsAnswer }] sorted by question number.
export function findKeyMismatches(tags, answerKeys) {
  if (!Array.isArray(tags) || !answerKeys) return []
  const mismatches = []
  for (const t of tags) {
    const tagsAnswer = normLetter(t.answer)
    const resultsAnswer = normLetter(answerKeys[t.q])
    if (tagsAnswer && resultsAnswer && tagsAnswer !== resultsAnswer) {
      mismatches.push({ q: t.q, tagsAnswer, resultsAnswer })
    }
  }
  return mismatches.sort((a, b) => a.q - b.q)
}
