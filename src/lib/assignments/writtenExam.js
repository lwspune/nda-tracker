// Record a graded homework as a written exam (2026-10-23). PURE.
//
// A test sat on paper can be run through Homework so the scripts are uploaded
// and graded, but a homework grade reaches nothing on the exam side (Exams,
// Toppers, the monthly report). This turns the saved grades into the same
// written exam `+ Offline marks` would make — questions: [] and an explicit
// maxMarks — so nobody re-types the totals.
//
// The exam id is derived from the homework id, so recording again after a
// regrade updates the one exam instead of adding a second.

import { assignmentState } from './status'
import { isoToIstLocal } from './editor'
import { buildOfflineStudentRows } from '../offlineRoster'

export const writtenExamId = assignmentId => `exam_hw_${assignmentId}`

// The exam's date: the deadline's calendar date in IST.
export function defaultExamDate(assignment) {
  return isoToIstLocal(assignment?.dueAt).slice(0, 10)
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// rows: submissionRoster() output. → { blockers, students, absent, sentBack }
//
// Refuses (blockers) rather than records a partial picture:
// - still open: more students may hand in;
// - waiting: an ungraded hand-in would be recorded as absent;
// - held: the student has not been shown that grade, and the exam side would
//   show it to them (their exam history) before the teacher released it.
// A sent-back hand-in is absent (owner ruling 2026-10-23), named so the
// recorder sees who.
export function planWrittenExam(assignment, rows, studentProfiles, now = new Date()) {
  const blockers = []
  const state = assignmentState(assignment, now)
  if (state === 'draft') blockers.push('This homework has not been published.')
  if (state === 'open') blockers.push('The homework is still open, so more students may hand in. Record it after the deadline.')

  const count = st => (rows ?? []).filter(r => r.status === st).length
  const waiting = count('submitted')
  const held = count('held')
  if (waiting) blockers.push(`${plural(waiting, 'hand-in is', 'hand-ins are')} still waiting to be graded.`)
  if (held) blockers.push(`${plural(held, 'grade is', 'grades are')} held for a handwriting check. Release or send ${held === 1 ? 'it' : 'them'} back first.`)

  // Results are filed by name, so use the profile's canonical name for the id.
  const nameById = new Map()
  for (const [key, p] of Object.entries(studentProfiles ?? {})) {
    if (p?.lwsId && p.name === key) nameById.set(p.lwsId, p.name)
  }
  const nameOf = r => nameById.get(r.lwsId) ?? r.name

  const roster = []
  const marks = {}
  const absent = []
  const sentBack = []
  for (const r of rows ?? []) {
    const name = nameOf(r)
    if (r.status === 'graded') {
      const total = r.submission?.totalAwarded
      if (typeof total !== 'number' || !Number.isFinite(total)) {
        blockers.push(`${name} is graded but has no total. Re-open the grade before recording.`)
        continue
      }
      roster.push({ name })
      marks[name] = String(total)
    } else if (r.status === 'rejected') {
      absent.push(name)
      sentBack.push(name)
    } else if (r.status === 'not_submitted') {
      absent.push(name)
    }
  }
  if (!blockers.length && roster.length === 0) blockers.push('No hand-in has been graded yet.')

  return { blockers, students: buildOfflineStudentRows(roster, marks), absent, sentBack }
}

// The exam object addExam/replaceExam take. `existing` is the exam already
// recorded from this homework, if any: it is spread first so fields this flow
// does not own (a branch set on the Exams page) survive, and so updating keeps
// whoever first recorded it.
export function buildHomeworkExam(assignment, students, { name, date, mode, email, existing = null, now = new Date() }) {
  const teacher = mode === 'teacher'
  return {
    ...(existing ?? {}),
    id: writtenExamId(assignment.id),
    name: String(name ?? '').trim(),
    date,
    subject: assignment.subject,
    batch: (assignment.batchNames ?? []).join(', ') || null,
    branch: existing?.branch ?? null,
    marking: { correct: 1, wrong: 0 },  // inert for a written exam — maxMarks drives %-of-max
    questions: [],
    maxMarks: assignment.maxMarks,
    students,
    source: existing?.source ?? (teacher ? 'teacher' : 'admin'),
    createdBy: existing ? (existing.createdBy ?? null) : (teacher ? email ?? null : null),
    createdAt: existing?.createdAt ?? now.toISOString(),
  }
}
