import { describe, it, expect } from 'vitest'
import { gradeScannedSheet } from '../gradeSheet'

// Grading a scanned sheet is the one place this feature touches a load-bearing
// invariant. For an Evalbee exam `responses` is the MACHINE'S verdict and the
// answer key drives only what is displayed. A scanned sheet has no machine
// verdict, so we grade — and the exam records that we did, which is what makes a
// later re-grade legitimate on our exams and still forbidden on Evalbee's.

const questions = [
  { q: 1, answer: 'A' },
  { q: 2, answer: 'B' },
  { q: 3, answer: 'C' },
  { q: 4, answer: 'D' },
]
const marking = { correct: 4, wrong: -1 }

describe('gradeScannedSheet', () => {
  it('scores a correct letter +1 and a wrong one -1, in the verdict encoding', () => {
    const g = gradeScannedSheet({
      outcomes: { 1: 'A', 2: 'C' }, questions, marking,
    })
    expect(g.responses[1]).toBe(1)
    expect(g.responses[2]).toBe(-1)
    expect(g.choices[1]).toBe('A')
    expect(g.choices[2]).toBe('C')
  })

  it('treats an unanswered question as skipped, worth nothing either way', () => {
    const g = gradeScannedSheet({ outcomes: { 1: 'A' }, questions, marking })
    expect(g.responses[2]).toBe(0)
    expect(g.choices[2]).toBeNull()
    expect(g.notAttempted).toBe(3)
  })

  it('scores a DOUBLE MARK wrong, not blank', () => {
    // Measured from real Evalbee exports: a cell holding "A, C" is scored
    // negative even when one of the two marked options is the key. Treating it
    // as a skip would turn a wrong answer into an unattempted one and quietly
    // hand the student a mark back.
    const g = gradeScannedSheet({ outcomes: { 1: 'multi' }, questions, marking })
    expect(g.responses[1]).toBe(-1)
    expect(g.choices[1]).toBeNull()      // no single letter to record
    expect(g.incorrect).toBe(1)
    expect(g.notAttempted).toBe(3)
  })

  it('totals marks from the exam’s own scheme', () => {
    const g = gradeScannedSheet({
      outcomes: { 1: 'A', 2: 'B', 3: 'A', 4: 'multi' }, questions, marking,
    })
    expect(g.correct).toBe(2)
    expect(g.incorrect).toBe(2)
    expect(g.totalMarks).toBe(2 * 4 + 2 * -1)
  })

  it('handles a non-round negative, as real papers use', () => {
    const g = gradeScannedSheet({
      outcomes: { 1: 'A', 2: 'A' }, questions, marking: { correct: 4, wrong: -1.33 },
    })
    expect(g.totalMarks).toBeCloseTo(4 - 1.33, 5)
  })

  it('REFUSES to grade a question with no stored answer, rather than marking it wrong', () => {
    // A tags file that never carried an answer for Q3 must not cost the student
    // a mark. It scores nothing and is named, so the caller can surface it.
    const partial = [{ q: 1, answer: 'A' }, { q: 2, answer: '' }, { q: 3 }]
    const g = gradeScannedSheet({
      outcomes: { 1: 'A', 2: 'B', 3: 'C' }, questions: partial, marking,
    })
    expect(g.responses[1]).toBe(1)
    expect(g.responses[2]).toBe(0)
    expect(g.responses[3]).toBe(0)
    expect(g.ungradable).toEqual([2, 3])
    expect(g.correct).toBe(1)
    expect(g.incorrect).toBe(0)
    // the student still chose something — the record of that survives
    expect(g.choices[2]).toBe('B')
  })

  it('is case- and whitespace-tolerant about a stored key', () => {
    const g = gradeScannedSheet({
      outcomes: { 1: 'A' }, questions: [{ q: 1, answer: ' a ' }], marking,
    })
    expect(g.responses[1]).toBe(1)
  })

  it('produces the same row shape the Evalbee parser does', () => {
    // Downstream reads one contract. A scanned sheet is a second producer of
    // it, not a second shape.
    const g = gradeScannedSheet({ outcomes: { 1: 'A' }, questions, marking })
    expect(Object.keys(g).sort()).toEqual(
      ['choices', 'correct', 'incorrect', 'notAttempted', 'responses', 'totalMarks', 'ungradable'])
  })
})
