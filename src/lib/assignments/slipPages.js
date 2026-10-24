// The marked pages where a student lost marks to a calculation slip, for staff
// to download and go through with each student (2026-10-24). PURE.
//
// A slip is the grader's `careless` cause (GRADING.md: the method is right but
// an arithmetic step, a sign, a copied number or units went wrong). A question's
// pages are the pages carrying its marks (homework_page_marks), and page N is
// the submission's Nth marked image — the same drawn page the student sees.
//
// A held grade is never included: the student has not been shown it. A slip
// whose page can't be shown is NAMED in `missing`, never dropped, so a short
// download cannot pass for a complete one.

export function slipQuestions(sub) {
  return (sub?.grades ?? []).filter(q =>
    q.outcome === 'scored' && q.cause === 'careless' && q.awarded < q.maxMarks)
}

const released = sub => sub?.status === 'graded'

export function countSlipStudents(submissions) {
  return (submissions ?? []).filter(s => released(s) && slipQuestions(s).length > 0).length
}

const tidy = n => Math.round(n * 100) / 100
const byName = (a, b) => a.studentName.localeCompare(b.studentName, 'en', { sensitivity: 'base' })

// submissions: mapSubmissionRow output. pageMarks: [{ submissionId, label, page }].
// → { pages: [{ submissionId, studentName, page, path, slips }], missing: [{ studentName, reason, questions }] }
// reason: 'deleted' (purged 30 days after grading) | 'no_pages' (no marked page to show).
export function planSlipPages(submissions, pageMarks) {
  const pages = []
  const missing = []

  const subs = (submissions ?? []).filter(released).sort((a, b) => byName(a, b) || a.id.localeCompare(b.id))
  for (const sub of subs) {
    const slips = slipQuestions(sub).sort((a, b) => a.position - b.position)
    if (slips.length === 0) continue
    const studentName = sub.studentName ?? sub.lwsId

    if (sub.scansDeletedAt) {
      missing.push({ studentName, reason: 'deleted', questions: slips.map(q => q.label) })
      continue
    }

    const byPage = new Map()
    const unplaced = []
    for (const q of slips) {
      const onPages = new Set((pageMarks ?? [])
        .filter(m => m.submissionId === sub.id && m.label === q.label && sub.markedPages?.[m.page - 1])
        .map(m => m.page))
      if (onPages.size === 0) { unplaced.push(q.label); continue }
      const slip = { label: q.label, lost: tidy(q.maxMarks - q.awarded), max: q.maxMarks, missing: q.missing ?? null }
      for (const page of onPages) {
        if (!byPage.has(page)) byPage.set(page, [])
        byPage.get(page).push(slip)
      }
    }

    for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
      pages.push({ submissionId: sub.id, studentName, page, path: sub.markedPages[page - 1], slips: byPage.get(page) })
    }
    if (unplaced.length) missing.push({ studentName, reason: 'no_pages', questions: unplaced })
  }

  return { pages, missing }
}

// The text printed above a page: who, which page, and one line per slip.
export function slipPageHeader(entry) {
  return {
    title: `${entry.studentName} · page ${entry.page}`,
    lines: entry.slips.map(s => `${s.label} (lost ${s.lost} of ${s.max})${s.missing ? `: ${s.missing}` : ''}`),
  }
}
