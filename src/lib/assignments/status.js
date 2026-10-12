// Where a homework assignment and its submissions stand. PURE.
//
// Shared by the teacher page, the student portal and api/student-quizzes.js, so
// the open/closed boundary the student sees is the one the server enforces.

const isHalf = n => Math.round(n * 2) === n * 2

// 'draft' | 'open' | 'closed'. Closes AT the due time (the quiz-submit
// boundary). An unreadable due time is closed, never open forever.
export function assignmentState(assignment, now = new Date()) {
  if (assignment?.status !== 'published') return 'draft'
  const due = assignment.dueAt ? new Date(assignment.dueAt).getTime() : NaN
  if (!Number.isFinite(due)) return 'closed'
  return now.getTime() < due ? 'open' : 'closed'
}

// The submission that counts: submitted or graded. An abandoned upload and a
// rejected sheet do not — the student may try again while the assignment is open.
export function liveSubmission(submissions) {
  return (submissions ?? []).find(s => s?.status === 'submitted' || s?.status === 'graded') ?? null
}

// May this student start an upload now? `submissions` is theirs, for this assignment.
export function canStartSubmission(assignment, submissions, now = new Date()) {
  const state = assignmentState(assignment, now)
  if (state === 'draft') return { ok: false, error: 'This homework is not open yet.' }
  if (state === 'closed') return { ok: false, error: 'The deadline for this homework has passed.' }
  if (liveSubmission(submissions)) return { ok: false, error: 'You have already submitted this homework.' }
  return { ok: true }
}

// One row per student for the teacher's view: every current member, plus
// anyone who submitted and has since left the batch (membership is current, the
// assignment is historical — dropping them would hide graded work).
//
// members: [{ lwsId, name }]; submissions: [{ id, lwsId, studentName, status, ... }]
// → [{ lwsId, name, status: 'not_submitted'|'submitted'|'graded'|'rejected', submission }]
export function submissionRoster(members, submissions) {
  const byStudent = new Map()
  for (const s of submissions ?? []) {
    if (!s?.lwsId || s.status === 'uploading') continue
    if (!byStudent.has(s.lwsId)) byStudent.set(s.lwsId, [])
    byStudent.get(s.lwsId).push(s)
  }
  const pick = list => liveSubmission(list) ?? list.find(s => s.status === 'rejected') ?? null

  const rows = []
  const seen = new Set()
  for (const m of members ?? []) {
    seen.add(m.lwsId)
    const sub = pick(byStudent.get(m.lwsId) ?? [])
    rows.push({ lwsId: m.lwsId, name: m.name, status: sub?.status ?? 'not_submitted', submission: sub })
  }
  for (const [lwsId, list] of byStudent) {
    if (seen.has(lwsId)) continue
    const sub = pick(list)
    if (sub) rows.push({ lwsId, name: sub.studentName ?? lwsId, status: sub.status, submission: sub })
  }
  return rows
}

// Can this assignment be published? Names every missing piece.
export function validateAssignmentForPublish(a, now = new Date()) {
  const errors = []
  if (!String(a?.title ?? '').trim()) errors.push('Give the homework a title.')
  if (!String(a?.subject ?? '').trim()) errors.push('Choose a subject.')
  if (!Array.isArray(a?.batchNames) || a.batchNames.length === 0) errors.push('Choose at least one batch.')
  const due = a?.dueAt ? new Date(a.dueAt).getTime() : NaN
  if (!Number.isFinite(due) || due <= now.getTime()) errors.push('Set a deadline in the future.')
  const max = a?.maxMarks
  if (typeof max !== 'number' || !(max > 0) || !isHalf(max)) errors.push('Set the total marks (in halves).')
  if (!Array.isArray(a?.questionFiles) || a.questionFiles.length === 0) errors.push('Upload the question paper.')

  const qs = Array.isArray(a?.questions) ? a.questions : []
  if (qs.length > 0) {
    const labels = qs.map(q => String(q?.label ?? '').trim())
    if (labels.some(l => !l)) errors.push('Every question in the breakdown needs a label.')
    if (new Set(labels).size !== labels.length) errors.push('Two questions in the breakdown share a label.')
    if (qs.some(q => typeof q?.marks !== 'number' || !(q.marks > 0) || !isHalf(q.marks))) {
      errors.push('Every question in the breakdown needs marks (in halves).')
    }
    const sum = qs.reduce((s, q) => s + (typeof q?.marks === 'number' ? q.marks : 0), 0)
    if (typeof max === 'number' && sum !== max) errors.push(`The breakdown adds up to ${sum}, not ${max}.`)
  }
  return { ok: errors.length === 0, errors }
}
