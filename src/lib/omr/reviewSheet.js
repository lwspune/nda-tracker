// Settling what a read sheet left open.
//
// The reader refuses to guess: an unclear mark, a double mark, a roll block left
// blank, a roll that is not on the roster. Each of those makes the sheet
// incomplete, and an incomplete sheet blocks the save — deliberately, because
// the alternative is filing a guess against a real student.
//
// So every refusal needs an answer a human can give, and one place that decides
// whether the sheet is settled. That rule was written inline in the page and is
// the rule the Save button is gated on; two copies of it would eventually
// disagree about what "done" means.

/** Every question answered, and we know whose sheet it is. */
export function withCompleteness(result) {
  const decisions = result.decisions || []
  const needsReview = decisions.filter(d => d.review)
  return {
    ...result,
    decisions,
    needsReview,
    reviewCount: needsReview.length,
    answers: Object.fromEntries(decisions.map(d => [d.q, d.choice])),
    // The roll number is a ROUTE to identity, not a question in its own right.
    // Gating on `roll.review` as well meant a sheet handed in with the roll block
    // untouched stayed blocked no matter who you said it belonged to — which
    // made assigning a student by hand pointless.
    complete: needsReview.length === 0 && !result.student?.review,
  }
}

/**
 * One flagged question, decided by a human.
 *
 * @param {string} outcome 'A'|'B'|'C'|'D' | 'blank' | 'multi'
 *        'multi' is a double mark, which grades WRONG rather than unanswered —
 *        the same verdict Evalbee gives it, so the same paper does not score
 *        differently depending on who read it.
 */
export function resolveQuestion(result, q, outcome) {
  const decisions = (result.decisions || []).map(d => {
    if (d.q !== q) return d
    return {
      ...d,
      review: false,
      resolvedByHand: true,
      choice: outcome === 'multi' || outcome === 'blank' ? null : outcome,
      state: outcome === 'multi' ? 'multi' : outcome === 'blank' ? 'blank' : 'single',
    }
  })
  return withCompleteness({ ...result, decisions })
}

/** Whose sheet this is, said by a human rather than read off the paper. */
export function assignStudent(result, lwsId) {
  if (!lwsId) return withCompleteness(result)
  return withCompleteness({
    ...result,
    student: {
      ...result.student,
      lwsId,
      // Kept distinct from 'evalbee'/'lws': a mark filed against a name somebody
      // chose is a different thing from one a roll number resolved.
      matchedBy: 'manual',
      review: false,
      reason: null,
    },
  })
}
