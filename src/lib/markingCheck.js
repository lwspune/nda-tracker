// Is the marking scheme we read off an Evalbee sheet actually trustworthy?
//
// `parseExcelFull` reports two facts and makes no judgement: `markValues` (the
// distinct per-question mark values) and `totalsReconcile` (Σ per-question marks
// vs the Total Marks column, per student). This turns those facts into a verdict.
//
// Measured over 210 real exports (RESULTS_REUPLOAD.md §2.2):
//   • every sheet used exactly ONE positive and AT MOST ONE negative value, so the
//     scheme is read off, not inferred — max/min is right, and provably so;
//   • Σ(Q N Marks) == Total Marks for EVERY student in EVERY file, no exceptions.
// So a `refuse` here means a genuinely unusual sheet: zero false positives on 210.
//
// What this deliberately does NOT use: the sheet's `Correct Answers` /
// `Incorrect Answers` columns. They are wrong in the wild — one 21-student file
// reports 10 correct for a row whose marks only reach at 23 — and a check built on
// them rejects perfectly good files (measured: 1 hard + 8 partial false positives
// over the same 210). See RESULTS_REUPLOAD.md §2.3.
//
// Pure: no fetch, no store, no DOM.

/**
 * @param {{markValues?: number[], totalsReconcile?: {checked, ok, failed}}} input
 * @returns {{correct: number|null, wrong: number|null, status: 'verified'|'warn'|'refuse', detail: string}}
 *
 * `correct`/`wrong` are **null** whenever the status is `refuse` for a scheme
 * reason — a caller must not be able to reach for a number we just said we could
 * not read. They are populated on `refuse` only when the scheme itself was
 * readable and it was the totals that failed, so the UI can show what it rejected.
 */
export function assessMarking(input) {
  const { markValues, totalsReconcile } = input || {}
  const values = Array.isArray(markValues) ? markValues : []
  const { checked = 0, ok = 0 } = totalsReconcile || {}

  const positives = values.filter(v => v > 0)
  const negatives = values.filter(v => v < 0)

  if (positives.length === 0) {
    return refuse(
      values.length === 0
        ? 'No per-question marks found in this file, so no marking scheme could be read.'
        : 'No positive mark value in this file, so the marks-for-a-correct-answer could not be read.'
    )
  }
  if (positives.length > 1) {
    return refuse(
      `This paper uses ${positives.length} different positive mark values (${positives.join(', ')}) — ` +
      'partial credit or a bonus question. A single +correct / −wrong scheme cannot express that, ' +
      'so it has not been guessed.'
    )
  }
  if (negatives.length > 1) {
    return refuse(
      `This paper uses ${negatives.length} different negative mark values (${negatives.join(', ')}). ` +
      'A single +correct / −wrong scheme cannot express that, so it has not been guessed.'
    )
  }

  const correct = positives[0]
  const wrong = negatives.length === 1 ? negatives[0] : 0
  const scheme = `+${correct}/${wrong}`

  if (checked === 0) {
    return { correct, wrong, status: 'warn', detail: `${scheme} — no student rows in this file to verify it against.` }
  }
  if (ok === checked) {
    return { correct, wrong, status: 'verified', detail: `${scheme} · reconciles for ${ok} of ${checked} students.` }
  }
  if (ok === 0) {
    return {
      correct, wrong, status: 'refuse',
      detail:
        `${scheme} — but none of the ${checked} students' marks add up to their Total Marks. ` +
        'This sheet is internally inconsistent; check it in Evalbee before filing these results.',
    }
  }
  return {
    correct, wrong, status: 'warn',
    detail:
      `${scheme} · reconciles for ${ok} of ${checked} students. ` +
      'A dropped or bonus question does this legitimately — check the named students below.',
  }
}

function refuse(detail) {
  return { correct: null, wrong: null, status: 'refuse', detail }
}
