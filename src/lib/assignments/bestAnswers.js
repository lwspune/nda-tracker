// Best answers per homework (2026-10-24): for each question, one student's
// answer, chosen in a Claude Code session for accuracy, thoroughness and
// presentation, cropped from their marked page into a PDF staff share with the
// class. PURE. Imported by scripts/grading/best.js under plain Node, so it has
// no imports without a .js extension.
//
// The shortlist is mechanical; the choice among it is a judgement made by
// looking at the pages (scripts/grading/BEST_ANSWERS.md). best.json records
// that choice and is checked here before anything is drawn or saved.

// In the homework's own folder of the homework-files bucket: staff-readable,
// and outside questions/, which is the only folder the student endpoint signs.
// The PDF is the record: the bucket takes images and PDFs only, and best.json
// stays in the local inbox.
export const BEST_FOLDER = 'best'
export const bestAnswersPdfPath = assignmentId => `${assignmentId}/${BEST_FOLDER}/best-answers.pdf`

// A grade the handwriting check doubted is never held up to the class as a model.
const DOUBTED_HAND = new Set(['mismatch', 'unclear'])

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// assignment: { dueAt }. submissions: mapSubmissionRow output. → [message]
export function bestAnswersBlockers(assignment, submissions, now = new Date()) {
  const blockers = []
  if (new Date(assignment.dueAt).getTime() > now.getTime()) {
    blockers.push('The homework is still open, so more students may hand in. Choose best answers after the deadline.')
  }
  const waiting = (submissions ?? []).filter(s => s.status === 'submitted').length
  if (waiting) blockers.push(`${plural(waiting, 'hand-in is', 'hand-ins are')} still waiting to be graded, and one of them may be the best answer.`)
  if (!(submissions ?? []).some(s => s.status === 'graded')) blockers.push('Nothing has been graded yet.')
  return blockers
}

const eligible = s =>
  s.status === 'graded' && !DOUBTED_HAND.has(s.handCheck) && !s.scansDeletedAt && (s.markedPages?.length ?? 0) > 0

const byName = (a, b) => String(a.studentName).localeCompare(String(b.studentName), 'en', { sensitivity: 'base' })

// questions: [{ label, marks }] (the homework's breakdown). pageMarks: [{ submissionId, label, page }].
// → [{ label, max, kind: 'full'|'best_attempt'|'none', candidates: [{ submissionId, studentName, awarded, missing, pages, pageCount }] }]
// full: full marks and nothing missing. best_attempt: nobody got there, so the
// highest mark, every tie. An answer needs a mark on a page to be found at all.
export function shortlistBestAnswers(questions, submissions, pageMarks) {
  const subs = (submissions ?? []).filter(eligible)
  return (questions ?? []).map(q => {
    const max = Number(q.marks)
    const answers = []
    for (const s of subs) {
      const grade = (s.grades ?? []).find(r => r.label === q.label)
      if (!grade || grade.outcome !== 'scored' || !(grade.awarded > 0)) continue
      const pages = [...new Set((pageMarks ?? [])
        .filter(m => m.submissionId === s.id && m.label === q.label && m.page <= s.markedPages.length)
        .map(m => m.page))].sort((a, b) => a - b)
      if (pages.length === 0) continue
      answers.push({ submissionId: s.id, studentName: s.studentName, awarded: grade.awarded, missing: grade.missing ?? null, pages, pageCount: s.markedPages.length })
    }

    const full = answers.filter(a => a.awarded === max && !a.missing)
    if (full.length) return { label: q.label, max, kind: 'full', candidates: full.sort(byName) }
    if (answers.length === 0) return { label: q.label, max, kind: 'none', candidates: [] }
    const top = Math.max(...answers.map(a => a.awarded))
    return { label: q.label, max, kind: 'best_attempt', candidates: answers.filter(a => a.awarded === top).sort(byName) }
  })
}

// The file to fill: every pick empty, which the check refuses.
export function bestFileTemplate(assignmentId, shortlist) {
  return {
    assignmentId,
    picks: shortlist.map(q => ({ label: q.label, submissionId: null, crops: [], reason: '' })),
  }
}

const REASON_MIN = 10
const REASON_MAX = 200
const MIN_SIDE = 5 // percent: a crop smaller than this is a slip of the pen
const isNum = v => typeof v === 'number' && Number.isFinite(v)

// file: best.json. → { ok: true, picks } | { ok: false, errors }
// picks: [{ label, max, kind, submissionId, studentName, awarded, missing, crops, reason }]
export function validateBestFile(file, { assignmentId, shortlist }) {
  const errors = []
  if (file?.assignmentId !== assignmentId) errors.push(`best.json is for homework ${file?.assignmentId}, not ${assignmentId}.`)
  const picks = Array.isArray(file?.picks) ? file.picks : []
  const labels = shortlist.map(q => q.label)
  if (picks.length !== labels.length || picks.some((p, i) => p?.label !== labels[i])) {
    errors.push(`best.json needs one pick per question, in order: ${labels.join(', ')}.`)
    return { ok: false, errors }
  }

  const out = []
  shortlist.forEach((q, i) => {
    const p = picks[i]
    const at = msg => errors.push(`${q.label}: ${msg}`)
    if (q.kind === 'none') {
      if (p.submissionId != null) at('nobody scored on this question, so there is no answer to pick (leave submissionId null).')
      out.push({ label: q.label, max: q.max, kind: 'none', submissionId: null, studentName: null, awarded: null, missing: null, crops: [], reason: '' })
      return
    }

    const c = q.candidates.find(x => x.submissionId === p.submissionId)
    if (!c) { at(`${p.submissionId ?? 'no answer'} is not on the shortlist. Pick one of: ${q.candidates.map(x => x.submissionId).join(', ')}.`); return }

    const crops = Array.isArray(p.crops) ? p.crops : []
    if (crops.length === 0) at('add at least one crop around the answer.')
    crops.forEach((b, n) => {
      const where = `crop ${n + 1}: `
      if (!Number.isInteger(b?.page) || b.page < 1 || b.page > c.pageCount) at(`${where}page ${b?.page} must be a page of this hand-in, 1 to ${c.pageCount}.`)
      const sane = [b?.x, b?.y, b?.w, b?.h].every(isNum)
      if (!sane || b.x < 0 || b.y < 0 || b.w < MIN_SIDE || b.h < MIN_SIDE || b.x + b.w > 100 || b.y + b.h > 100) {
        at(`${where}x, y, w and h are percent of the page; the box must sit inside the page and be at least ${MIN_SIDE} wide and tall.`)
      }
    })
    const reason = typeof p.reason === 'string' ? p.reason.trim() : ''
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) at(`write a reason of ${REASON_MIN}-${REASON_MAX} characters: why this answer is the one to learn from.`)

    out.push({
      label: q.label, max: q.max, kind: q.kind, submissionId: c.submissionId, studentName: c.studentName,
      awarded: c.awarded, missing: c.missing, crops: crops.map(b => ({ page: b.page, x: b.x, y: b.y, w: b.w, h: b.h })), reason,
    })
  })

  return errors.length ? { ok: false, errors } : { ok: true, picks: out }
}
