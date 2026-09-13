// Turning bubble fill scores into answers — or refusing to.
//
// THE RULE: never guess. A bubble that is not clearly filled and not clearly
// empty goes to a human with its score attached. The reader's job is not to
// maximise how many answers it extracts; it is to be right about the ones it
// reports. A silently misread bubble becomes a wrong mark in a parent's
// WhatsApp, which is far worse than a slow manual pass — the same posture as
// `assessMarking` refusing rather than assuming and `findKeyMismatches`
// surfacing a conflict rather than overwriting it.
//
// Scores are 0..1, "how dark is this bubble" — pure numbers, so this module has
// no idea what an image is. Sampling lives with the capture code; the decision
// lives here where it can be tested.

/**
 * Minimum contrast between the empty baseline and the darkest mark before a
 * sheet is treated as having any marks at all.
 *
 * Without it, an UNFILLED sheet gets its own paper-noise stretched across the
 * full range and every bubble lands in the ambiguous band — 600 review items
 * for a sheet nobody wrote on, which would bury the operator on the one case
 * that should be instant.
 */
export const MIN_CONTRAST = 0.12

// Fractions of the sheet's own contrast range. Between these two lines a bubble
// is neither filled nor empty, and goes to review.
const EMPTY_AT = 0.30
const FILL_AT = 0.55

const quantile = (sorted, p) => {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[i]
}

/**
 * Work out this sheet's own empty and filled levels.
 *
 * Calibrating per sheet rather than against a fixed threshold is what lets
 * pencil and biro, light and heavy hands, and a dim photo all read correctly:
 * what matters is a mark's contrast against ITS OWN sheet, not its absolute
 * darkness.
 */
export function calibrate(scores) {
  const sorted = [...scores].sort((a, b) => a - b)
  // The bulk of any sheet is empty paper, so the low end is the baseline; the
  // top end is a real mark. Both are taken off-extreme to shrug off outliers.
  const low = quantile(sorted, 0.15)
  const high = quantile(sorted, 0.98)
  const range = high - low
  if (range < MIN_CONTRAST) {
    return { blank: true, low, high, range, emptyAt: Infinity, fillAt: Infinity }
  }
  return {
    blank: false,
    low,
    high,
    range,
    emptyAt: low + range * EMPTY_AT,
    fillAt: low + range * FILL_AT,
  }
}

/**
 * Classify one question's four scores.
 *
 * @returns {{
 *   q:number, state:'single'|'blank'|'multi'|'review',
 *   choice:string|null, marked:string[], review:boolean, scores:number[],
 * }}
 */
export function decideQuestion(row, cal) {
  const { q, options, scores } = row
  if (cal.blank) {
    return { q, state: 'blank', choice: null, marked: [], review: false, scores }
  }
  const marked = [], unsure = []
  scores.forEach((s, i) => {
    if (s >= cal.fillAt) marked.push(options[i])
    else if (s > cal.emptyAt) unsure.push(options[i])
  })

  // An ambiguous bubble is decisive even when another option looks clear: the
  // classic case is an erasure next to a fresh mark, and picking the dark one
  // silently discards the student's actual intent.
  if (unsure.length) {
    return { q, state: 'review', choice: null, marked, review: true, scores, unsure }
  }
  if (marked.length === 1) {
    return { q, state: 'single', choice: marked[0], marked, review: false, scores }
  }
  if (marked.length === 0) {
    return { q, state: 'blank', choice: null, marked, review: false, scores }
  }
  // Two or more clear marks. Evalbee scores a double mark WRONG even when one of
  // them is the key, so `multi` must stay distinct from `blank` — collapsing it
  // would turn a wrong answer into an unattempted one.
  return { q, state: 'multi', choice: null, marked, review: true, scores }
}

/**
 * Read a whole sheet.
 *
 * @param {{q:number, options:string[], scores:number[]}[]} rows
 * @returns {{
 *   answers: Record<number, string|null>,
 *   decisions: object[], needsReview: object[], reviewCount: number,
 *   complete: boolean, calibration: object,
 * }}
 */
export function readSheet(rows, { calibration } = {}) {
  const cal = calibration || calibrate(rows.flatMap(r => r.scores))
  const decisions = rows.map(r => decideQuestion(r, cal))
  const needsReview = decisions.filter(d => d.review)
  const answers = {}
  for (const d of decisions) answers[d.q] = d.choice
  return {
    answers,
    decisions,
    needsReview,
    reviewCount: needsReview.length,
    // Mirrors writtenQuizCompletion().complete — a half-read stack must not be
    // committable as though it were finished.
    complete: needsReview.length === 0,
    calibration: cal,
  }
}
