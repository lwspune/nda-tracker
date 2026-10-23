import { describe, it, expect } from 'vitest'
import { writtenExamId, planWrittenExam, buildHomeworkExam, defaultExamDate } from '../writtenExam'

const NOW = new Date('2026-10-20T10:00:00Z')
const DUE = '2026-10-19T12:30:00Z' // 19 Oct, 6:00 pm IST

const assignment = (over = {}) => ({
  id: 'a1', title: 'Unit Test 2 — Limits', subject: 'Maths', batchNames: ['12th_A', '6M'],
  status: 'published', dueAt: DUE, maxMarks: 40, ...over,
})

const profiles = {
  'Aarav Nair':   { name: 'Aarav Nair',   lwsId: 'L1', batches: ['12th_A'] },
  'Aarav Nayar':  { name: 'Aarav Nair',   lwsId: 'L1', batches: ['12th_A'] }, // a name variant
  'Bhavya Rao':   { name: 'Bhavya Rao',   lwsId: 'L2', batches: ['12th_A'] },
  'Chetan Joshi': { name: 'Chetan Joshi', lwsId: 'L3', batches: ['6M'] },
}

const sub = (lwsId, status, over = {}) => ({ id: `s_${lwsId}`, lwsId, status, totalAwarded: null, ...over })
const row = (lwsId, name, status, submission = null) => ({ lwsId, name, status, submission })

describe('writtenExamId', () => {
  // One homework, one exam: recording again updates it rather than duplicating.
  it('is derived from the homework id', () => {
    expect(writtenExamId('a1')).toBe('exam_hw_a1')
  })
})

describe('planWrittenExam', () => {
  it('records each graded total and lists everyone else as absent', () => {
    const rows = [
      row('L1', 'Aarav Nair', 'graded', sub('L1', 'graded', { totalAwarded: 31.5 })),
      row('L2', 'Bhavya Rao', 'not_submitted'),
    ]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.blockers).toEqual([])
    expect(plan.students).toEqual([
      { name: 'Aarav Nair', rollNo: '', totalMarks: 31.5, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
    ])
    expect(plan.absent).toEqual(['Bhavya Rao'])
    expect(plan.sentBack).toEqual([])
  })

  // A real zero is a mark; only "no grade" is absence.
  it('keeps a graded zero as a mark', () => {
    const rows = [row('L1', 'Aarav Nair', 'graded', sub('L1', 'graded', { totalAwarded: 0 }))]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.students.map(s => s.totalMarks)).toEqual([0])
    expect(plan.absent).toEqual([])
  })

  // Owner ruling 2026-10-23: sent back = absent, named so the recorder sees who.
  it('treats a sent-back hand-in as absent and names it', () => {
    const rows = [
      row('L1', 'Aarav Nair', 'graded', sub('L1', 'graded', { totalAwarded: 20 })),
      row('L2', 'Bhavya Rao', 'rejected', sub('L2', 'rejected')),
    ]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.blockers).toEqual([])
    expect(plan.students.map(s => s.name)).toEqual(['Aarav Nair'])
    expect(plan.absent).toEqual(['Bhavya Rao'])
    expect(plan.sentBack).toEqual(['Bhavya Rao'])
  })

  // Exam results are filed by name, so the name must be the profile's
  // canonical one — whatever the submission row happened to carry.
  it('files a result under the canonical profile name, found by LWS id', () => {
    const rows = [row('L1', 'Aarav Nayar', 'graded', sub('L1', 'graded', { totalAwarded: 12 }))]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.students[0].name).toBe('Aarav Nair')
  })

  // Membership is current; the homework is historical.
  it('keeps a graded student who has since left the batch', () => {
    const rows = [row('L9', 'Old Student', 'graded', sub('L9', 'graded', { totalAwarded: 25 }))]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.students.map(s => [s.name, s.totalMarks])).toEqual([['Old Student', 25]])
  })

  it('refuses while the homework is still open', () => {
    const rows = [row('L1', 'Aarav Nair', 'graded', sub('L1', 'graded', { totalAwarded: 20 }))]
    const plan = planWrittenExam(assignment({ dueAt: '2026-10-21T12:30:00Z' }), rows, profiles, NOW)
    expect(plan.blockers).toEqual([expect.stringMatching(/still open/i)])
  })

  it('refuses a draft', () => {
    const plan = planWrittenExam(assignment({ status: 'draft' }), [], profiles, NOW)
    expect(plan.blockers).toEqual([expect.stringMatching(/not been published/i)])
  })

  it('refuses while any hand-in is waiting to be graded', () => {
    const rows = [
      row('L1', 'Aarav Nair', 'graded', sub('L1', 'graded', { totalAwarded: 20 })),
      row('L2', 'Bhavya Rao', 'submitted', sub('L2', 'submitted')),
    ]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.blockers).toEqual(['1 hand-in is still waiting to be graded.'])
  })

  // A held grade has not been shown to the student. Recording it would publish
  // it on their exam history before the teacher has released it.
  it('refuses while any grade is held for a handwriting check', () => {
    const rows = [
      row('L1', 'Aarav Nair', 'held', sub('L1', 'held', { totalAwarded: 20 })),
      row('L2', 'Bhavya Rao', 'held', sub('L2', 'held', { totalAwarded: 18 })),
      row('L3', 'Chetan Joshi', 'graded', sub('L3', 'graded', { totalAwarded: 30 })),
    ]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.blockers).toEqual([expect.stringMatching(/^2 grades are held for a handwriting check/)])
  })

  it('refuses when nothing has been graded', () => {
    const plan = planWrittenExam(assignment(), [row('L1', 'Aarav Nair', 'not_submitted')], profiles, NOW)
    expect(plan.blockers).toEqual(['No hand-in has been graded yet.'])
  })

  // Never record a graded student as absent because their total is missing.
  it('refuses a graded hand-in that carries no total', () => {
    const rows = [row('L1', 'Aarav Nair', 'graded', sub('L1', 'graded', { totalAwarded: null }))]
    const plan = planWrittenExam(assignment(), rows, profiles, NOW)
    expect(plan.blockers).toEqual(['Aarav Nair is graded but has no total. Re-open the grade before recording.'])
  })
})

describe('buildHomeworkExam', () => {
  const students = [{ name: 'Aarav Nair', rollNo: '', totalMarks: 31.5, correct: 0, incorrect: 0, notAttempted: 0, responses: {} }]

  it('builds a written exam: no questions, the homework total as the ceiling', () => {
    const exam = buildHomeworkExam(assignment(), students, {
      name: ' Unit Test 2 ', date: '2026-10-19', mode: 'admin', email: 'office@lws.com', now: NOW,
    })
    expect(exam).toEqual({
      id: 'exam_hw_a1',
      name: 'Unit Test 2',
      date: '2026-10-19',
      subject: 'Maths',
      batch: '12th_A, 6M',
      branch: null,
      marking: { correct: 1, wrong: 0 },
      questions: [],
      maxMarks: 40,
      students,
      source: 'admin',
      createdBy: null,
      createdAt: NOW.toISOString(),
    })
  })

  it('stamps a teacher as the author, as a Written Quiz does', () => {
    const exam = buildHomeworkExam(assignment(), students, {
      name: 'UT2', date: '2026-10-19', mode: 'teacher', email: 'asha@lws.com', now: NOW,
    })
    expect(exam.source).toBe('teacher')
    expect(exam.createdBy).toBe('asha@lws.com')
  })

  // Updating after a regrade must not change who recorded it or wipe fields
  // edited on the Exams page that this flow does not own.
  it('keeps the original author and other fields when updating', () => {
    const existing = {
      id: 'exam_hw_a1', name: 'Old', date: '2026-10-18', branch: 'APJ', source: 'teacher',
      createdBy: 'asha@lws.com', createdAt: '2026-10-19T13:00:00Z', students: [],
    }
    const exam = buildHomeworkExam(assignment(), students, {
      name: 'UT2', date: '2026-10-19', mode: 'admin', email: 'office@lws.com', existing, now: NOW,
    })
    expect(exam.source).toBe('teacher')
    expect(exam.createdBy).toBe('asha@lws.com')
    expect(exam.createdAt).toBe('2026-10-19T13:00:00Z')
    expect(exam.branch).toBe('APJ')
    expect(exam.students).toBe(students)
    expect(exam.name).toBe('UT2')
  })
})

describe('default exam date', () => {
  it('is the deadline’s date in IST', () => {
    expect(defaultExamDate(assignment({ dueAt: '2026-10-19T19:00:00Z' }))).toBe('2026-10-20') // 00:30 IST next day
    expect(defaultExamDate(assignment())).toBe('2026-10-19')
  })
})
