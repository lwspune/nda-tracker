import { describe, it, expect } from 'vitest'
import { writtenQuizCompletion, buildWrittenQuizExam, findDuplicateWrittenQuiz } from '../writtenQuiz'

const ROSTER = [
  { lwsId: 'LWS-1', name: 'Aarav Nair' },
  { lwsId: 'LWS-2', name: 'Bhavya Rao' },
  { lwsId: 'LWS-3', name: 'Chetan Joshi' },
]

describe('writtenQuizCompletion', () => {
  // The whole point of the explicit absent tick: on the teacher grid a blank
  // means "not entered yet", NOT "did not appear" (which is what it means on
  // the admin grid). Without this gate a half-finished session would silently
  // save as a room full of no-shows.
  it('counts a blank as pending, not as absent', () => {
    const c = writtenQuizCompletion({ roster: ROSTER, marks: { 'LWS-1': 8 }, absentIds: new Set() })
    expect(c).toMatchObject({ entered: 1, absent: 0, pending: 2, complete: false })
  })

  it('is complete only when every student is marked or ticked absent', () => {
    const c = writtenQuizCompletion({
      roster: ROSTER, marks: { 'LWS-1': 8, 'LWS-3': 0 }, absentIds: new Set(['LWS-2']),
    })
    expect(c).toMatchObject({ entered: 2, absent: 1, pending: 0, complete: true })
  })

  it('treats an explicit zero as entered, not as blank', () => {
    const c = writtenQuizCompletion({ roster: ROSTER, marks: { 'LWS-1': 0 }, absentIds: new Set() })
    expect(c.entered).toBe(1)
  })

  it('does not count a mark for a student who is also ticked absent', () => {
    // Absent wins — the tick is the deliberate action.
    const c = writtenQuizCompletion({
      roster: ROSTER, marks: { 'LWS-1': 8, 'LWS-2': 5, 'LWS-3': 4 }, absentIds: new Set(['LWS-2']),
    })
    expect(c).toMatchObject({ entered: 2, absent: 1, pending: 0, complete: true })
  })

  it('is not complete for an empty roster', () => {
    // Nothing to record — saving would create an exam with no results.
    expect(writtenQuizCompletion({ roster: [], marks: {}, absentIds: new Set() }))
      .toMatchObject({ entered: 0, absent: 0, pending: 0, complete: false })
  })
})

describe('buildWrittenQuizExam', () => {
  const base = {
    id: 'wq1', name: 'Trig Test', date: '2026-07-28', subject: 'Maths',
    batchName: '12th_A', maxMarks: 20, roster: ROSTER, createdBy: 'akash@lwspune.com',
  }

  it('produces an OFFLINE exam — empty questions + explicit maxMarks', () => {
    // Offline-ness is derived from questions.length, and examMaxMarks is the
    // single %-of-max denominator, so both have to be right at the source.
    const exam = buildWrittenQuizExam({ ...base, marks: { 'LWS-1': 8 }, absentIds: new Set(['LWS-2', 'LWS-3']) })
    expect(exam.questions).toEqual([])
    expect(exam.maxMarks).toBe(20)
  })

  it('stamps it as teacher-created so reports can tag it "Written Quiz"', () => {
    const exam = buildWrittenQuizExam({ ...base, marks: { 'LWS-1': 8 }, absentIds: new Set(['LWS-2', 'LWS-3']) })
    expect(exam.source).toBe('teacher')
    expect(exam.createdBy).toBe('akash@lwspune.com')
  })

  it('omits absent and not-entered students from the results', () => {
    // A student with no result simply has none; exam_absences is never written
    // from this path (absence sync is hard-disabled), and admin can still
    // derive absentees from the batch roster.
    const exam = buildWrittenQuizExam({
      ...base, marks: { 'LWS-1': 8 }, absentIds: new Set(['LWS-2']),
    })
    expect(exam.students.map(s => s.name)).toEqual(['Aarav Nair'])
  })

  it('keeps an explicit zero as a real result', () => {
    const exam = buildWrittenQuizExam({ ...base, marks: { 'LWS-2': 0 }, absentIds: new Set() })
    expect(exam.students).toEqual([
      expect.objectContaining({ name: 'Bhavya Rao', totalMarks: 0 }),
    ])
  })

  it('records results in roster order with empty per-question data', () => {
    const exam = buildWrittenQuizExam({
      ...base, marks: { 'LWS-3': 4, 'LWS-1': 9 }, absentIds: new Set(),
    })
    expect(exam.students.map(s => s.name)).toEqual(['Aarav Nair', 'Chetan Joshi'])
    expect(exam.students[0].responses).toEqual({})
  })

  it('carries subject and batch so it scopes to the teacher\'s own class', () => {
    const exam = buildWrittenQuizExam({ ...base, marks: { 'LWS-1': 1 }, absentIds: new Set() })
    expect(exam).toMatchObject({ subject: 'Maths', batch: '12th_A', name: 'Trig Test', date: '2026-07-28' })
  })
})

describe('findDuplicateWrittenQuiz', () => {
  const exams = [
    { id: 'e1', date: '2026-07-28', subject: 'Maths', batch: '12th_A', name: 'Trig Test' },
    { id: 'e2', date: '2026-07-28', subject: 'Physics', batch: '12th_A', name: 'Optics' },
    { id: 'e3', date: '2026-07-27', subject: 'Maths', batch: '12th_A', name: 'Older' },
  ]

  it('flags an exam already on the same date + subject + batch', () => {
    expect(findDuplicateWrittenQuiz(exams, { date: '2026-07-28', subject: 'Maths', batchName: '12th_A' }))
      .toMatchObject({ id: 'e1' })
  })

  it('does not flag a different subject, batch or date', () => {
    expect(findDuplicateWrittenQuiz(exams, { date: '2026-07-28', subject: 'Chemistry', batchName: '12th_A' })).toBeNull()
    expect(findDuplicateWrittenQuiz(exams, { date: '2026-07-28', subject: 'Maths', batchName: '11th_B' })).toBeNull()
    expect(findDuplicateWrittenQuiz(exams, { date: '2026-07-26', subject: 'Maths', batchName: '12th_A' })).toBeNull()
  })

  it('matches a multi-batch exam whose comma list contains the batch', () => {
    const multi = [{ id: 'm1', date: '2026-07-28', subject: 'Maths', batch: '12th_A, 11th_B' }]
    expect(findDuplicateWrittenQuiz(multi, { date: '2026-07-28', subject: 'Maths', batchName: '11th_B' }))
      .toMatchObject({ id: 'm1' })
  })

  it('ignores the exam being edited, and tolerates empty input', () => {
    expect(findDuplicateWrittenQuiz(exams, { date: '2026-07-28', subject: 'Maths', batchName: '12th_A', excludeId: 'e1' }))
      .toBeNull()
    expect(findDuplicateWrittenQuiz(null, { date: '2026-07-28', subject: 'Maths', batchName: '12th_A' })).toBeNull()
  })
})
