// Item statistics: what the answer sheets say about each BANK question.
// Spec + the measurements behind it: ITEM_STATS.md
import { describe, it, expect } from 'vitest'
import { computeItemStats } from '../itemStats'

const Q1 = '11111111-1111-4111-8111-111111111111'
const Q2 = '22222222-2222-4222-8222-222222222222'

// One exam record = one sitting. `rows` is [totalMarks, verdict, chosenLetter].
function exam(id, questions, rows) {
  return {
    id, name: `Exam ${id}`, date: '2026-09-01', subject: 'Maths',
    questions,
    students: rows.map(([total, verdict, chose], i) => ({
      name: `S${id}${i}`, totalMarks: total,
      responses: { 1: verdict }, choices: { 1: chose ?? null },
    })),
  }
}
const q1 = (over = {}) => [{ q: 1, questionId: Q1, chapter: 'Vectors', subtopic: 'Dot', answer: 'B', ...over }]

describe('computeItemStats — counting', () => {
  it('separates skipped from wrong, and scores over ATTEMPTED', () => {
    // 2 correct, 1 wrong, 2 skipped -> 3 attempted, 66.7% correct, 40% skipped
    const out = computeItemStats([exam('e1', q1(), [
      [10, 1, 'B'], [10, 1, 'B'], [10, -1, 'C'], [10, 0, null], [10, 0, null],
    ])], { minAttempts: 1 })
    const r = out.rows[0]
    expect(r.seen).toBe(5)
    expect(r.attempted).toBe(3)
    expect(r.skipped).toBe(2)
    expect(r.correct).toBe(2)
    expect(r.pCorrect).toBeCloseTo(2 / 3)     // NOT 2/5
    expect(r.skipRate).toBeCloseTo(2 / 5)
  })

  it('counts chosen options from attempted rows only', () => {
    const out = computeItemStats([exam('e1', q1(), [
      [10, 1, 'B'], [10, -1, 'C'], [10, -1, 'C'], [10, 0, 'C'],  // the skip must not count
    ])], { minAttempts: 1 })
    expect(out.rows[0].choiceCounts).toEqual({ A: 0, B: 1, C: 2, D: 0 })
    expect(out.rows[0].topDistractor).toEqual({ label: 'C', n: 2 })
    expect(out.rows[0].distractorRatio).toBeCloseTo(2)
  })

  it('ignores questions with no bank id, and exams with no questions', () => {
    const out = computeItemStats([
      exam('e1', [{ q: 1, chapter: 'X', answer: 'A' }], [[10, 1, 'A']]),
      { id: 'e2', name: 'written', questions: [], students: [] },
    ], { minAttempts: 1 })
    expect(out.rows).toEqual([])
  })
})

describe('computeItemStats — pooling across sittings', () => {
  // The same paper is deliberately run for several batches, each its own record.
  it('pools one question across the records it appears in', () => {
    const out = computeItemStats([
      exam('e1', q1(), [[10, 1, 'B'], [10, -1, 'A']]),
      exam('e2', q1(), [[10, 1, 'B'], [10, 0, null]]),
    ], { minAttempts: 1 })
    expect(out.rows).toHaveLength(1)
    const r = out.rows[0]
    expect(r.seen).toBe(4)
    expect(r.attempted).toBe(3)
    expect(r.correct).toBe(2)
    expect(r.exams.map(e => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('refuses to pool a question keyed differently in two records', () => {
    const out = computeItemStats([
      exam('e1', q1({ answer: 'B' }), [[10, 1, 'B']]),
      exam('e2', q1({ answer: 'C' }), [[10, 1, 'C']]),
    ], { minAttempts: 1 })
    expect(out.rows).toEqual([])
    expect(out.keyConflicts).toHaveLength(1)
    expect(out.keyConflicts[0].questionId).toBe(Q1)
    expect(out.keyConflicts[0].keys.map(k => k.answer).sort()).toEqual(['B', 'C'])
  })
})

describe('computeItemStats — discrimination', () => {
  // Ability is ranked WITHIN a record: batches differ, so a cross-batch ranking
  // would confuse "weaker student" with "weaker cohort".
  it('is negative when the strong half gets it wrong and the weak half right', () => {
    const rows = []
    for (let i = 0; i < 10; i++) rows.push([100 - i, -1, 'A'])  // top scorers: wrong
    for (let i = 0; i < 10; i++) rows.push([i, 1, 'B'])         // bottom scorers: right
    const out = computeItemStats([exam('e1', q1(), rows)], { minAttempts: 1 })
    expect(out.rows[0].discrimination).toBeLessThan(0)
  })

  it('is positive for a well-behaved question', () => {
    const rows = []
    for (let i = 0; i < 10; i++) rows.push([100 - i, 1, 'B'])
    for (let i = 0; i < 10; i++) rows.push([i, -1, 'A'])
    const out = computeItemStats([exam('e1', q1(), rows)], { minAttempts: 1 })
    expect(out.rows[0].discrimination).toBeGreaterThan(0)
  })
})

describe('computeItemStats — thin evidence is flagged, never dropped', () => {
  it('marks a question below the attempt threshold instead of hiding it', () => {
    const out = computeItemStats([exam('e1', q1(), [[10, 1, 'B'], [10, -1, 'A']])], { minAttempts: 20 })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0].insufficient).toBe(true)
    expect(out.rows[0].attempted).toBe(2)
  })

  it('leaves distractorRatio null when nobody picked the key', () => {
    const out = computeItemStats([exam('e1', q1(), [[10, -1, 'A'], [10, -1, 'A']])], { minAttempts: 1 })
    expect(out.rows[0].distractorRatio).toBeNull()
    expect(out.rows[0].topDistractor).toEqual({ label: 'A', n: 2 })
  })

  it('ranks the review queue worst-first by default', () => {
    const twoQ = [
      { q: 1, questionId: Q1, chapter: 'Vectors', answer: 'B' },
    ]
    const bad = exam('e1', twoQ, [[10, -1, 'C'], [10, -1, 'C'], [10, -1, 'C'], [10, 1, 'B']])
    const good = { ...exam('e2', [{ q: 1, questionId: Q2, chapter: 'Algebra', answer: 'A' }],
      [[10, 1, 'A'], [10, 1, 'A'], [10, -1, 'B']]) }
    const out = computeItemStats([good, bad], { minAttempts: 1 })
    expect(out.rows[0].questionId).toBe(Q1)   // distractor 3:1 beats 1:2
  })
})
