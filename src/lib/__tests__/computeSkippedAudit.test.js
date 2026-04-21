import { describe, it, expect } from 'vitest'
import { computeSkippedAudit } from '../analytics'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExam({ id = 'e1', date = '2024-01-01', questions = [], students = [] } = {}) {
  return {
    id,
    name: `Exam ${id}`,
    date,
    marking: { correct: 4, wrong: -1 },
    questions,
    students,
  }
}

function makeQuestion(q, chapter, subtopic) {
  return { q, chapter, subtopic, correct: 'A' }
}

function makeStudent(name, responses) {
  return { name, totalMarks: 0, correct: 0, incorrect: 0, notAttempted: 0, responses }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeSkippedAudit', () => {

  it('returns empty array when student has no exams', () => {
    expect(computeSkippedAudit('Alice', [])).toEqual([])
  })

  it('returns empty array when student has no skipped questions', () => {
    const exam = makeExam({
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students:  [makeStudent('Alice', { 1: 1 })],  // all correct
    })
    expect(computeSkippedAudit('Alice', [exam])).toEqual([])
  })

  it('returns empty array when only wrong answers exist (no skips)', () => {
    const exam = makeExam({
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students:  [makeStudent('Alice', { 1: -1 })],  // wrong, not skipped
    })
    expect(computeSkippedAudit('Alice', [exam])).toEqual([])
  })

  it('returns one entry when a subtopic has skipped questions', () => {
    const exam = makeExam({
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students:  [makeStudent('Alice', { 1: 0 })],  // skipped
    })
    const result = computeSkippedAudit('Alice', [exam])
    expect(result).toHaveLength(1)
    expect(result[0].chapter).toBe('Algebra')
    expect(result[0].subtopic).toBe('Quadratics')
  })

  it('result item has correct shape', () => {
    const exam = makeExam({
      questions: [
        makeQuestion(1, 'Algebra', 'Quadratics'),
        makeQuestion(2, 'Algebra', 'Quadratics'),
      ],
      students: [makeStudent('Alice', { 1: 0, 2: 1 })],  // 1 skipped, 1 correct
    })
    const [item] = computeSkippedAudit('Alice', [exam])
    expect(item).toMatchObject({
      chapter:  'Algebra',
      subtopic: 'Quadratics',
      skipped:  1,
      correct:  1,
      total:    2,
    })
    expect(typeof item.skipRate).toBe('number')
  })

  it('skipRate = skipped / total', () => {
    const exam = makeExam({
      questions: [
        makeQuestion(1, 'Algebra', 'Quadratics'),
        makeQuestion(2, 'Algebra', 'Quadratics'),
        makeQuestion(3, 'Algebra', 'Quadratics'),
        makeQuestion(4, 'Algebra', 'Quadratics'),
      ],
      // 2 skipped out of 4 total → skipRate = 0.5
      students: [makeStudent('Alice', { 1: 0, 2: 0, 3: 1, 4: -1 })],
    })
    const [item] = computeSkippedAudit('Alice', [exam])
    expect(item.skipRate).toBeCloseTo(0.5)
  })

  it('sorts by skipped count descending', () => {
    const exam = makeExam({
      questions: [
        makeQuestion(1, 'Trigonometry', 'Identities'),
        makeQuestion(2, 'Trigonometry', 'Identities'),
        makeQuestion(3, 'Algebra', 'Quadratics'),
      ],
      // Trig: 2 skipped, Algebra: 1 skipped
      students: [makeStudent('Alice', { 1: 0, 2: 0, 3: 0 })],
    })
    const result = computeSkippedAudit('Alice', [exam])
    expect(result[0].subtopic).toBe('Identities')
    expect(result[0].skipped).toBe(2)
    expect(result[1].subtopic).toBe('Quadratics')
    expect(result[1].skipped).toBe(1)
  })

  it('excludes subtopics with zero skips even if they have wrong answers', () => {
    const exam = makeExam({
      questions: [
        makeQuestion(1, 'Algebra', 'Quadratics'),   // will be wrong
        makeQuestion(2, 'Trigonometry', 'Identities'), // will be skipped
      ],
      students: [makeStudent('Alice', { 1: -1, 2: 0 })],
    })
    const result = computeSkippedAudit('Alice', [exam])
    expect(result).toHaveLength(1)
    expect(result[0].subtopic).toBe('Identities')
  })

  it('aggregates skips across multiple exams for the same subtopic', () => {
    const exam1 = makeExam({
      id: 'e1', date: '2024-01-01',
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students:  [makeStudent('Alice', { 1: 0 })],
    })
    const exam2 = makeExam({
      id: 'e2', date: '2024-02-01',
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students:  [makeStudent('Alice', { 1: 0 })],
    })
    const [item] = computeSkippedAudit('Alice', [exam1, exam2])
    expect(item.skipped).toBe(2)
    expect(item.total).toBe(2)
  })

  it('does not include data for other students', () => {
    const exam = makeExam({
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students: [
        makeStudent('Alice', { 1: 1 }),   // Alice: correct
        makeStudent('Bob',   { 1: 0 }),   // Bob: skipped
      ],
    })
    expect(computeSkippedAudit('Alice', [exam])).toEqual([])
    expect(computeSkippedAudit('Bob',   [exam])).toHaveLength(1)
  })

  it('returns empty array when student name is not found in any exam', () => {
    const exam = makeExam({
      questions: [makeQuestion(1, 'Algebra', 'Quadratics')],
      students:  [makeStudent('Alice', { 1: 0 })],
    })
    expect(computeSkippedAudit('Charlie', [exam])).toEqual([])
  })
})
