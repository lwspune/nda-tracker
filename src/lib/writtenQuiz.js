import { getExamBatches } from './analytics/filters'

// A "Written Quiz" — a pen-and-paper class test a teacher conducts and marks
// themselves, entered at /school-attendance instead of being read out to the
// office. Stored as a normal OFFLINE exam (`questions: []` + explicit
// `maxMarks`), stamped `source:'teacher'` so parent-facing reports can label it
// "Written Quiz" rather than let it read like a full mock.
//
// "Written" is load-bearing in that label: this app also has an in-app Daily
// Quiz (`quizzes`/`quiz_attempts`), which is deliberately never folded into
// `exams`. Do not shorten the label to "Quiz" anywhere a parent sees it.

// Has this student had a mark typed for them? An explicit 0 counts; blank,
// whitespace and non-numeric do not.
function hasMark(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return false
  return Number.isFinite(parseFloat(raw))
}

// Progress through the grid — and, crucially, what a BLANK means here.
//
// On the admin offline grid a blank mark means "did not appear" and feeds
// absentee flagging. On the teacher grid it means "not entered yet": a teacher
// marks papers in one sitting and a half-finished session must never save as a
// room full of no-shows. So absence is an explicit tick, and `complete` gates
// the Save button until every student is one or the other.
export function writtenQuizCompletion({ roster, marks, absentIds }) {
  const absent = absentIds instanceof Set ? absentIds : new Set(absentIds ?? [])
  let entered = 0, absentCount = 0
  for (const s of roster ?? []) {
    if (absent.has(s.lwsId)) { absentCount++; continue }  // the tick is the deliberate action
    if (hasMark(marks?.[s.lwsId])) entered++
  }
  const total = (roster ?? []).length
  const pending = total - entered - absentCount
  return { entered, absent: absentCount, pending, complete: total > 0 && pending === 0 }
}

// Assembles the exam object in the store's camelCase shape. Student rows match
// `buildOfflineStudentRows` (per-question fields intentionally empty — offline
// exams carry no question data, so they never feed chapter stats or the
// projected NDA score).
//
// Absent and not-entered students are simply omitted: a student with no result
// has none. `exam_absences` is never written from this path — the teacher flow
// hard-disables absence sync so nothing here can reach a parent — and admin can
// still derive absentees from the batch roster via `getExamAbsentees`.
export function buildWrittenQuizExam({
  id, name, date, subject, batchName, maxMarks, roster, marks, absentIds, createdBy, branch = null,
}) {
  const absent = absentIds instanceof Set ? absentIds : new Set(absentIds ?? [])
  const students = []
  for (const s of roster ?? []) {
    if (absent.has(s.lwsId)) continue
    const raw = marks?.[s.lwsId]
    if (!hasMark(raw)) continue
    students.push({
      name: s.name,
      rollNo: '',
      totalMarks: parseFloat(raw),
      correct: 0,
      incorrect: 0,
      notAttempted: 0,
      responses: {},
    })
  }
  return {
    id,
    name,
    date,
    subject: subject || null,
    batch: batchName || null,
    branch,
    marking: { correct: 1, wrong: 0 },   // inert for offline — maxMarks drives %-of-max
    questions: [],
    maxMarks,
    source: 'teacher',
    createdBy: createdBy ?? null,
    students,
  }
}

// An exam already on this (date, subject, batch)? Warned about before creating,
// because `exams` has no dedup of its own — unlike students, there is no
// variant-linking or merge tooling to clean up afterwards.
//
// `exam.batch` is a comma-joined list, so a multi-batch exam matches if it
// CONTAINS the batch.
export function findDuplicateWrittenQuiz(exams, { date, subject, batchName, excludeId = null }) {
  for (const e of exams ?? []) {
    if (!e || e.id === excludeId) continue
    if (e.date !== date) continue
    if ((e.subject || null) !== (subject || null)) continue
    if (!getExamBatches(e).includes(batchName)) continue
    return e
  }
  return null
}
