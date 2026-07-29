import { describe, it, expect } from 'vitest'
import { examFormat, examFormatLabel, examMaxMarks } from '../analyticsHelpers'

// Every exam at LWS is conducted offline — Evalbee doesn't make one "online",
// it machine-grades a paper MCQ sheet. The real split is whether per-question
// data was captured: Evalbee produces it, a hand-graded written paper cannot.
// So format is DERIVED and never stored, and it is independent of who created
// the exam (`source`) — an admin-entered written test is just as written as a
// teacher-entered one.
describe('examFormat', () => {
  it('is MCQ when per-question data exists', () => {
    expect(examFormat({ questions: [{ q: 1 }, { q: 2 }] })).toBe('mcq')
  })

  it('is written when only a total was recorded', () => {
    expect(examFormat({ questions: [], maxMarks: 20 })).toBe('written')
  })

  it('treats a missing questions array as written, never throwing', () => {
    // Legacy rows and half-built objects must not crash a report render.
    expect(examFormat({})).toBe('written')
    expect(examFormat(null)).toBe('written')
    expect(examFormat(undefined)).toBe('written')
  })

  it('ignores `source` — the label describes the paper, not the author', () => {
    expect(examFormat({ questions: [], source: 'admin' })).toBe('written')
    expect(examFormat({ questions: [], source: 'teacher' })).toBe('written')
    expect(examFormat({ questions: [{ q: 1 }], source: 'teacher' })).toBe('mcq')
  })
})

describe('examFormatLabel', () => {
  it('renders the parent-facing labels', () => {
    expect(examFormatLabel({ questions: [{ q: 1 }] })).toBe('MCQ')
    expect(examFormatLabel({ questions: [] })).toBe('Written')
  })
})

// Guard for the shared denominator these labels sit beside — a written exam has
// no questions, so the derived form returns 0 and the explicit maxMarks must win.
describe('examMaxMarks', () => {
  it('prefers an explicit maxMarks over the derived form', () => {
    expect(examMaxMarks({ questions: [], maxMarks: 30 })).toBe(30)
    expect(examMaxMarks({ questions: [{ q: 1 }, { q: 2 }], marking: { correct: 4 }, maxMarks: 30 })).toBe(30)
  })

  it('derives questions × marking.correct when no explicit max is set', () => {
    expect(examMaxMarks({ questions: [{ q: 1 }, { q: 2 }], marking: { correct: 4 } })).toBe(8)
  })

  it('returns 0 when it cannot compute one', () => {
    expect(examMaxMarks({ questions: [] })).toBe(0)
    expect(examMaxMarks(null)).toBe(0)
  })
})
