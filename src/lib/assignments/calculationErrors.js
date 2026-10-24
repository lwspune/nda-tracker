// A student's calculation errors across every graded homework (2026-10-24),
// for the card above their homework list. PURE.
//
// A calculation error is the grader's `careless` cause (GRADING.md: the
// method is right, but an arithmetic step, a sign, a copied number or units
// went wrong). Every number is buildPaperReport's `potential`, the same one
// each homework's own report shows, so the card can never disagree with it.
//
// Input is studentHomeworkList output: a held grade arrives there as
// "submitted", so it is never counted.

import { buildPaperReport } from './paperReport.js'

const tidy = n => Math.round(n * 100) / 100

// homework: [{ id, title, dueAt, submission: { status, grades } }]
// → null when nothing is graded, else { lost, graded, withErrors, rows }
// rows: [{ id, title, dueAt, lost, questions, score, max, fixedScore }], newest first.
export function summariseCalculationErrors(homework) {
  const graded = (homework ?? []).filter(h => h.submission?.status === 'graded')
  if (graded.length === 0) return null

  const rows = graded
    .map(h => {
      const r = buildPaperReport(h.submission.grades)
      return {
        id: h.id, title: h.title, dueAt: h.dueAt,
        lost: r.potential.avoidable, questions: r.potential.questions,
        score: r.total, max: r.max, fixedScore: r.potential.marks,
      }
    })
    .filter(r => r.lost > 0)
    .sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt))

  return {
    lost: tidy(rows.reduce((s, r) => s + r.lost, 0)),
    graded: graded.length,
    withErrors: rows.length,
    rows,
  }
}
