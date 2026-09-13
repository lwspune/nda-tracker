// Grading a scanned sheet.
//
// ── This is where the feature meets a load-bearing invariant ─────────────────
// For an Evalbee exam, `exam_results.responses` is the MACHINE'S per-question
// verdict and `exams.questions[].answer` drives only the displayed answer,
// solution and analytics — never marks. A scanned sheet has no machine verdict:
// we read the letter the student filled, and we grade it against the key.
//
// Decided 2026-09-13 (option A): the exam RECORDS how it was graded. Evalbee
// exams keep reading Evalbee's verdict and must never be re-derived from a key;
// scanner-graded exams are ours, so correcting a key may legitimately re-grade
// them. Provenance is what makes that distinction safe to act on — without it,
// a future re-grade cannot tell which exams it is allowed to touch.
//
// `responses` is still WRITTEN in the same 1 / -1 / 0 encoding, so every
// consumer downstream reads one contract and none of them needs to know.

/** `exams.graded_by` — who decided the marks. */
export const GRADED_BY_SCANNER = 'scanner'
export const GRADED_BY_VENDOR = 'evalbee'

const norm = v => String(v ?? '').trim().toUpperCase()

/**
 * @param {object} args
 * @param {Record<number, string>} args.outcomes  per question: a letter, 'multi',
 *        or absent for unanswered. Review must already have resolved anything
 *        ambiguous — this grades a decided sheet, it does not decide one.
 * @param {{q:number, answer?:string}[]} args.questions
 * @param {{correct:number, wrong:number}} args.marking
 * @returns {{responses:object, choices:object, correct:number, incorrect:number,
 *            notAttempted:number, totalMarks:number, ungradable:number[]}}
 */
export function gradeScannedSheet({ outcomes = {}, questions = [], marking = {} }) {
  const responses = {}, choices = {}
  const ungradable = []
  let correct = 0, incorrect = 0, notAttempted = 0

  for (const question of questions) {
    const q = question.q
    const outcome = outcomes[q]
    const key = norm(question.answer)

    // A double mark is WRONG, not blank. Measured from real Evalbee exports: a
    // cell holding "A, C" scores negative even when one of the two is the key.
    // Scoring it 0 would turn a wrong answer into an unattempted one and hand
    // the student a mark back.
    if (outcome === 'multi') {
      choices[q] = null
      responses[q] = -1
      incorrect++
      continue
    }

    const letter = norm(outcome)
    if (!letter) {
      choices[q] = null
      responses[q] = 0
      notAttempted++
      continue
    }
    choices[q] = letter

    // No stored key means we cannot grade this one. Marking it wrong would cost
    // a student a real mark for a gap in OUR tags file, so it scores nothing and
    // is named for the caller to surface.
    if (!key) {
      responses[q] = 0
      ungradable.push(q)
      continue
    }

    if (letter === key) { responses[q] = 1; correct++ } else { responses[q] = -1; incorrect++ }
  }

  const totalMarks = correct * (marking.correct ?? 0) + incorrect * (marking.wrong ?? 0)
  return { responses, choices, correct, incorrect, notAttempted, totalMarks, ungradable }
}
