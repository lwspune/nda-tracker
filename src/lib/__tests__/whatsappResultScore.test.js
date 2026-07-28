import { describe, it, expect } from 'vitest'
import { examScoreBasis, resultScore } from '../whatsappResultScore'

// The single source for the three score values carried by the WhatsApp result
// template (Score %, "Correct Qs", "Total Qs"). Both api/send-whatsapp.js and
// WhatsAppPreviewModal call this, so the preview shows exactly what the parent
// receives — the preview is a cross-check only while there is one formula.
//
// Regression: offline exams (questions: []) have correct/incorrect/notAttempted
// all 0 and carry their marks in totalMarks. Scoring them off the counters
// messaged 13 families "Score: 0%, Correct Qs: 0, Total Qs: 0" (2026-07-28).

const MCQ_EXAM = {
  questions: Array.from({ length: 30 }, (_, i) => ({ q: i + 1 })),
  marking:   { correct: 1, wrong: 0 },
  maxMarks:  null,
}

const OFFLINE_EXAM = {
  questions: [],
  marking:   { correct: 1, wrong: 0 },
  maxMarks:  5,
}

describe('examScoreBasis', () => {
  it('derives offline-ness from an empty questions[] (no stored flag)', () => {
    expect(examScoreBasis(OFFLINE_EXAM).isOffline).toBe(true)
    expect(examScoreBasis(MCQ_EXAM).isOffline).toBe(false)
  })

  it('takes the offline denominator from the explicit maxMarks', () => {
    expect(examScoreBasis(OFFLINE_EXAM).maxMarks).toBe(5)
  })

  it('derives the MCQ denominator from questions × marking.correct', () => {
    expect(examScoreBasis(MCQ_EXAM).maxMarks).toBe(30)
  })

  it('treats a missing exam as offline with no denominator (no throw)', () => {
    expect(examScoreBasis(undefined)).toEqual({ isOffline: true, maxMarks: 0 })
  })
})

describe('resultScore — offline exams', () => {
  const basis = examScoreBasis(OFFLINE_EXAM)

  it('scores from totalMarks / maxMarks', () => {
    expect(resultScore(basis, { totalMarks: 4, correct: 0, incorrect: 0, notAttempted: 0 }))
      .toEqual({ pct: 80, scored: 4, outOf: 5 })
  })

  it('accepts a numeric string totalMarks (Supabase numeric arrives as text)', () => {
    expect(resultScore(basis, { totalMarks: '4' })).toEqual({ pct: 80, scored: 4, outOf: 5 })
  })

  it('reports a genuine zero as 0 out of the paper max, not 0 out of 0', () => {
    expect(resultScore(basis, { totalMarks: 0 })).toEqual({ pct: 0, scored: 0, outOf: 5 })
  })

  it('rounds to the nearest whole percent', () => {
    const b = examScoreBasis({ questions: [], maxMarks: 30 })
    expect(resultScore(b, { totalMarks: 20 }).pct).toBe(67)   // 66.67
    expect(resultScore(b, { totalMarks: 10 }).pct).toBe(33)   // 33.33
  })

  it('never emits NaN when maxMarks is unusable', () => {
    const b = examScoreBasis({ questions: [], maxMarks: null })
    expect(resultScore(b, { totalMarks: 4 })).toEqual({ pct: 0, scored: 4, outOf: 0 })
  })
})

describe('resultScore — MCQ exams', () => {
  const basis = examScoreBasis(MCQ_EXAM)

  it('scores from the per-question counters, not totalMarks', () => {
    // totalMarks would give a different answer under negative marking — the
    // template counts questions here, so the counters are authoritative.
    expect(resultScore(basis, { correct: 20, incorrect: 5, notAttempted: 5, totalMarks: 15 }))
      .toEqual({ pct: 67, scored: 20, outOf: 30 })
  })

  it('uses the student attempt total as the denominator, not the paper size', () => {
    // A short-marked sheet (counters summing below questions.length) still
    // reports out of what that student actually has — unchanged behaviour.
    expect(resultScore(basis, { correct: 5, incorrect: 5, notAttempted: 0 }))
      .toEqual({ pct: 50, scored: 5, outOf: 10 })
  })

  it('treats missing counters as zero without emitting NaN', () => {
    expect(resultScore(basis, {})).toEqual({ pct: 0, scored: 0, outOf: 0 })
  })
})
