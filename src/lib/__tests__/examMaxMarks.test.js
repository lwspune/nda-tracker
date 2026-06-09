import { describe, it, expect } from 'vitest'
import { examMaxMarks } from '../analyticsHelpers'

describe('examMaxMarks', () => {
  it('derives max from questions.length × marking.correct for MCQ exams', () => {
    const exam = {
      marking: { correct: 4, wrong: -1 },
      questions: [{ q: 1 }, { q: 2 }, { q: 3 }],
    }
    expect(examMaxMarks(exam)).toBe(12)
  })

  it('prefers an explicit maxMarks (offline exam, no questions)', () => {
    const exam = { maxMarks: 100, marking: { correct: 1, wrong: 0 }, questions: [] }
    expect(examMaxMarks(exam)).toBe(100)
  })

  it('explicit maxMarks wins even when questions are present', () => {
    const exam = { maxMarks: 80, marking: { correct: 4, wrong: -1 }, questions: [{ q: 1 }, { q: 2 }] }
    expect(examMaxMarks(exam)).toBe(80)
  })

  it('returns 0 when neither maxMarks nor questions are usable', () => {
    expect(examMaxMarks({ marking: { correct: 4 }, questions: [] })).toBe(0)
    expect(examMaxMarks({})).toBe(0)
  })

  it('treats a non-positive or non-numeric maxMarks as unset and derives', () => {
    expect(examMaxMarks({ maxMarks: 0, marking: { correct: 4 }, questions: [{ q: 1 }] })).toBe(4)
    expect(examMaxMarks({ maxMarks: null, marking: { correct: 4 }, questions: [{ q: 1 }] })).toBe(4)
  })
})
