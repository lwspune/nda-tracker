// The class PDF serves both exam formats. Layout is visual and reviewed out of
// band; what's tested here is the format branching — which columns and which
// sections exist for a hand-graded paper that has no per-question data.

import { describe, it, expect } from 'vitest'
import { examPdfSchemeLabel, buildStatBoxes, buildAllStudentsTable } from '../examPdf'

function mcqExam(over = {}) {
  return {
    name: 'Mock 1',
    date: '2026-07-25',
    subject: 'Maths',
    marking: { correct: 4, wrong: -1 },
    questions: Array.from({ length: 70 }, (_, i) => ({ q: i + 1, chapter: 'Sets' })),
    students: [
      { name: 'Alice', totalMarks: 200, correct: 52, incorrect: 8, notAttempted: 10, responses: {} },
    ],
    ...over,
  }
}

function writtenExam(over = {}) {
  return {
    name: 'Sets',
    date: '2026-07-27',
    subject: 'Maths',
    marking: { correct: 1, wrong: 0 },   // inert — maxMarks drives %-of-max
    questions: [],
    maxMarks: 20,
    students: [
      { name: 'Alice', totalMarks: 18, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
      { name: 'Bob',   totalMarks: 8,  correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
    ],
    ...over,
  }
}

describe('examPdfSchemeLabel', () => {
  it('prints the marking scheme for an MCQ paper', () => {
    expect(examPdfSchemeLabel(mcqExam())).toBe('Marking: +4 / -1')
  })

  // A written exam's marking is inert, so "+1 / 0" would state a scheme that was
  // never applied — the paper ceiling is the only meaningful number.
  it('prints the paper ceiling for a written paper, not a scheme', () => {
    const label = examPdfSchemeLabel(writtenExam())
    expect(label).toBe('Written · Max 20')
    expect(label).not.toMatch(/marking/i)
  })
})

describe('buildStatBoxes', () => {
  it('counts questions for an MCQ paper', () => {
    const labels = buildStatBoxes(mcqExam()).map(b => b.label)
    expect(labels).toContain('Questions')
  })

  it('shows the paper ceiling instead of a question count for a written paper', () => {
    const boxes = buildStatBoxes(writtenExam())
    const labels = boxes.map(b => b.label)
    expect(labels).not.toContain('Questions')
    expect(labels).toContain('Max Marks')
    expect(boxes.find(b => b.label === 'Max Marks').value).toBe(20)
  })

  it('reports min, avg and max for both formats', () => {
    for (const exam of [mcqExam(), writtenExam()]) {
      const labels = buildStatBoxes(exam).map(b => b.label)
      expect(labels).toEqual(expect.arrayContaining(['Students', 'Min Score', 'Avg Score', 'Max Score']))
    }
  })
})

describe('buildAllStudentsTable', () => {
  it('includes the per-question counts for an MCQ paper', () => {
    const { head, body } = buildAllStudentsTable(mcqExam())
    expect(head[0]).toEqual(['Rank', 'Student Name', 'Score', '%', 'Correct', 'Wrong', 'Skipped'])
    expect(body[0]).toEqual([1, 'Alice', 200, '71%', 52, 8, 10])
  })

  // Offline exams render "—", never 0, in per-question columns — a zero reads as
  // a real count. Dropping the columns outright is the honest form of that rule.
  it('drops the per-question columns for a written paper', () => {
    const { head, body } = buildAllStudentsTable(writtenExam())
    expect(head[0]).toEqual(['Rank', 'Student Name', 'Marks', '%'])
    expect(body[0]).toEqual([1, 'Alice', 18, '90%'])
    expect(body.flat()).not.toContain(0)
  })

  it('ranks by mark, highest first', () => {
    const { body } = buildAllStudentsTable(writtenExam())
    expect(body.map(r => r[1])).toEqual(['Alice', 'Bob'])
  })

  it('returns no rows when nobody has a result', () => {
    expect(buildAllStudentsTable(writtenExam({ students: [] })).body).toEqual([])
  })
})
