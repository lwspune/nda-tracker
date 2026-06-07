import { describe, it, expect } from 'vitest'
import { quizCohort, quizSummary, quizQuestionStats, quizNotAttempted, attemptsWithProfile } from '../quizStats'

const QUIZ = {
  batch: 'BATCH_A',
  marking: { correct: 1, wrong: 0 },
  questions: [
    { q: 1, chapter: 'Algebra', question: 'A?', answer: 'A' },
    { q: 2, chapter: 'Trig', question: 'B?', answer: 'B' },
  ],
}

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'L1', batches: ['BATCH_A'], accountStatus: 'Active' },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'L2', batches: ['BATCH_A'], accountStatus: 'Active' },
  'Old Student':  { name: 'Old Student',  lwsId: 'L3', batches: ['BATCH_A'], accountStatus: 'Block' },
  'Other Batch':  { name: 'Other Batch',  lwsId: 'L4', batches: ['BATCH_B'], accountStatus: 'Active' },
  // variant-keyed duplicate of Arjun — must be skipped
  'Arjun':        { name: 'Arjun Sharma', lwsId: 'L1', batches: ['BATCH_A'], accountStatus: 'Active' },
}

describe('quizCohort', () => {
  it('returns Active in-batch students, skipping Block and other-batch and variant keys', () => {
    const cohort = quizCohort(PROFILES, QUIZ)
    expect(cohort.map(p => p.lwsId).sort()).toEqual(['L1', 'L2'])
  })

  it('treats an empty batch as all Active students', () => {
    const cohort = quizCohort(PROFILES, { ...QUIZ, batch: null })
    expect(cohort.map(p => p.lwsId).sort()).toEqual(['L1', 'L2', 'L4'])
  })

  it('matches any batch in a comma-joined multi-batch quiz', () => {
    const cohort = quizCohort(PROFILES, { ...QUIZ, batch: 'BATCH_A, BATCH_B' })
    expect(cohort.map(p => p.lwsId).sort()).toEqual(['L1', 'L2', 'L4'])
  })
})

describe('quizSummary', () => {
  it('computes n, avgScore, avgPct against max score', () => {
    const attempts = [{ score: 2 }, { score: 1 }] // max = 2 questions × 1
    const s = quizSummary(QUIZ, attempts)
    expect(s.n).toBe(2)
    expect(s.maxScore).toBe(2)
    expect(s.avgScore).toBe(1.5)
    expect(s.avgPct).toBe(0.75)
  })

  it('returns zeros for no attempts', () => {
    expect(quizSummary(QUIZ, [])).toEqual({ n: 0, avgScore: 0, avgPct: 0, maxScore: 2 })
  })
})

describe('quizQuestionStats', () => {
  it('counts correct + attempted per question and a correct% over all attempts', () => {
    const attempts = [
      { answers: { 1: 'A', 2: 'C' } }, // q1 right, q2 wrong
      { answers: { 1: 'A' } },          // q1 right, q2 skipped
      { answers: { 1: 'D', 2: 'B' } }, // q1 wrong, q2 right
    ]
    const stats = quizQuestionStats(QUIZ, attempts)
    expect(stats[0]).toMatchObject({ q: 1, chapter: 'Algebra', correctCount: 2, attemptedCount: 3, n: 3 })
    expect(stats[0].pct).toBeCloseTo(2 / 3)
    expect(stats[1]).toMatchObject({ q: 2, correctCount: 1, attemptedCount: 2, n: 3 })
    expect(stats[1].pct).toBeCloseTo(1 / 3)
  })

  it('is case-insensitive on the chosen letter', () => {
    const stats = quizQuestionStats(QUIZ, [{ answers: { 1: 'a' } }])
    expect(stats[0].correctCount).toBe(1)
  })

  it('returns zero pct with no attempts', () => {
    const stats = quizQuestionStats(QUIZ, [])
    expect(stats[0].pct).toBe(0)
    expect(stats[0].correctCount).toBe(0)
  })

  it('tallies a per-option pick distribution + skipped count', () => {
    const attempts = [
      { answers: { 1: 'A', 2: 'C' } }, // q1 A, q2 C
      { answers: { 1: 'A' } },          // q1 A, q2 skipped
      { answers: { 1: 'D', 2: 'B' } }, // q1 D, q2 B
    ]
    const stats = quizQuestionStats(QUIZ, attempts)
    expect(stats[0].dist).toEqual({ A: 2, B: 0, C: 0, D: 1 })
    expect(stats[0].skipped).toBe(0)
    expect(stats[1].dist).toEqual({ A: 0, B: 1, C: 1, D: 0 })
    expect(stats[1].skipped).toBe(1)
  })
})

describe('attemptsWithProfile', () => {
  it('attaches current branch + batches by lwsId', () => {
    const profiles = {
      'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'L1', branch: 'APJ', batches: ['APJ_NDA_12th_(26-27)'] },
    }
    const out = attemptsWithProfile([{ lwsId: 'L1', studentName: 'Arjun Sharma' }], profiles)
    expect(out[0]).toMatchObject({ lwsId: 'L1', branch: 'APJ', batches: ['APJ_NDA_12th_(26-27)'] })
  })

  it('returns empty branch/batches when no profile matches', () => {
    const out = attemptsWithProfile([{ lwsId: 'L9', studentName: 'Ghost' }], {})
    expect(out[0]).toMatchObject({ branch: '', batches: [] })
  })

  it('ignores variant-keyed entries when indexing (canonical wins)', () => {
    const profiles = {
      'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'L1', branch: 'APJ', batches: ['B1'] },
      'Arjun':        { name: 'Arjun Sharma', lwsId: 'L1', branch: 'WRONG', batches: ['BAD'] },
    }
    const out = attemptsWithProfile([{ lwsId: 'L1' }], profiles)
    expect(out[0].branch).toBe('APJ')
    expect(out[0].batches).toEqual(['B1'])
  })
})

describe('quizNotAttempted', () => {
  it('returns cohort members with no attempt', () => {
    const cohort = [{ lwsId: 'L1', name: 'A' }, { lwsId: 'L2', name: 'B' }]
    const attempts = [{ lwsId: 'L1' }]
    expect(quizNotAttempted(cohort, attempts).map(p => p.lwsId)).toEqual(['L2'])
  })

  it('returns all when there are no attempts', () => {
    const cohort = [{ lwsId: 'L1' }, { lwsId: 'L2' }]
    expect(quizNotAttempted(cohort, [])).toHaveLength(2)
  })
})
