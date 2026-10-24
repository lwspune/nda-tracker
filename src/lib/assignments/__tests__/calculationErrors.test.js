import { describe, it, expect } from 'vitest'
import { summariseCalculationErrors } from '../calculationErrors'
import { buildPaperReport } from '../paperReport'

// Grade rows in the student-payload shape (studentHomeworkList).
const g = (label, maxMarks, awarded, cause = null) => ({
  position: Number(label.slice(1)), label, maxMarks,
  outcome: awarded === null ? 'not_attempted' : 'scored', awarded,
  earned: null, missing: null, cause, topic: null,
})

const hw = (id, dueAt, grades, status = 'graded') => ({
  id, title: `Homework ${id}`, subject: 'Maths', dueAt, maxMarks: 10,
  submission: status ? {
    status, grades,
    totalAwarded: grades.reduce((s, q) => s + (q.outcome === 'scored' ? q.awarded : 0), 0),
    totalMax: grades.reduce((s, q) => s + q.maxMarks, 0),
  } : null,
})

describe('summariseCalculationErrors', () => {
  const list = [
    hw('a', '2026-10-01T12:00:00Z', [g('Q1', 5, 3, 'careless'), g('Q2', 5, 4.5, 'careless')]),
    hw('b', '2026-10-10T12:00:00Z', [g('Q1', 5, 5), g('Q2', 5, 2, 'concept')]),
    hw('c', '2026-10-20T12:00:00Z', [g('Q1', 4, 3.5, 'careless'), g('Q2', 6, 6)]),
    hw('d', '2026-10-22T12:00:00Z', [], 'submitted'),
    hw('e', '2026-10-23T12:00:00Z', [], null),
  ]
  const s = summariseCalculationErrors(list)

  it('adds up the marks lost to calculation errors across graded homework', () => {
    expect(s.lost).toBe(3)
    expect(s.graded).toBe(3)
    expect(s.withErrors).toBe(2)
  })

  it('lists only the homework that had errors, newest first', () => {
    expect(s.rows.map(r => r.id)).toEqual(['c', 'a'])
  })

  it('gives each row its questions, marks lost, and the score with them fixed', () => {
    expect(s.rows[1]).toEqual({
      id: 'a', title: 'Homework a', dueAt: '2026-10-01T12:00:00Z',
      lost: 2.5, questions: ['Q1', 'Q2'], score: 7.5, max: 10, fixedScore: 10,
    })
  })

  it('uses the same numbers as the homework\'s own report', () => {
    const report = buildPaperReport(list[0].submission.grades)
    expect(s.rows[1].lost).toBe(report.potential.avoidable)
    expect(s.rows[1].fixedScore).toBe(report.potential.marks)
    expect(s.rows[1].score).toBe(report.total)
  })

  it('is null when nothing has been graded yet', () => {
    expect(summariseCalculationErrors([hw('d', '2026-10-22T12:00:00Z', [], 'submitted')])).toBeNull()
    expect(summariseCalculationErrors([])).toBeNull()
    expect(summariseCalculationErrors(null)).toBeNull()
  })

  it('reports graded homework with no calculation errors as zero, not null', () => {
    const none = summariseCalculationErrors([list[1]])
    expect(none).toEqual({ lost: 0, graded: 1, withErrors: 0, rows: [] })
  })
})
