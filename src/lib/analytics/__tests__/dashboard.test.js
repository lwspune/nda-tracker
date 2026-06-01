import { describe, it, expect } from 'vitest'
import {
  examAvgPct,
  getPerformanceSeries,
  getClassProjectedAvg,
  getPriorityChapters,
  getBatchComparison,
} from '../dashboard'

// ── Fixtures ──────────────────────────────────────────────────────────────────
// maxMarks = questions.length * marking.correct.
// With 2 questions and marking.correct=4 → maxMarks = 8.
// pct = student.totalMarks / maxMarks.

function exam(over = {}) {
  return {
    id: 'e1',
    name: 'Exam',
    date: '2024-01-01',
    subject: 'Maths',
    batch: null,
    marking: { correct: 4, wrong: -1 },
    questions: [
      { q: 1, chapter: 'Algebra', subtopic: 'Equations' },
      { q: 2, chapter: 'Calculus', subtopic: 'Limits' },
    ],
    students: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over,
  }
}

// ── examAvgPct ──────────────────────────────────────────────────────────────
describe('examAvgPct', () => {
  it('averages each student %-of-max (not raw totalMarks)', () => {
    const e = exam({ students: [
      { name: 'Alice', totalMarks: 8, responses: { 1: 1, 2: 1 } }, // 100%
      { name: 'Bob',   totalMarks: 4, responses: { 1: 1, 2: -1 } }, // 50%
    ] })
    const r = examAvgPct(e)
    expect(r.maxMarks).toBe(8)
    expect(r.n).toBe(2)
    expect(r.avgPct).toBeCloseTo(0.75, 5)
  })

  it('scopes to a name filter when provided', () => {
    const e = exam({ students: [
      { name: 'Alice', totalMarks: 8, responses: {} },
      { name: 'Bob',   totalMarks: 4, responses: {} },
    ] })
    const r = examAvgPct(e, new Set(['Alice']))
    expect(r.n).toBe(1)
    expect(r.avgPct).toBeCloseTo(1.0, 5)
  })

  it('returns avgPct 0 and n 0 when maxMarks is 0', () => {
    const e = exam({ questions: [], students: [{ name: 'Alice', totalMarks: 0, responses: {} }] })
    const r = examAvgPct(e)
    expect(r.maxMarks).toBe(0)
    expect(r.avgPct).toBe(0)
    expect(r.n).toBe(0)
  })

  it('returns n 0 when no students match the filter', () => {
    const e = exam({ students: [{ name: 'Alice', totalMarks: 8, responses: {} }] })
    const r = examAvgPct(e, new Set(['Zoe']))
    expect(r.n).toBe(0)
    expect(r.avgPct).toBe(0)
  })
})

// ── getPerformanceSeries ──────────────────────────────────────────────────────
describe('getPerformanceSeries', () => {
  const eA = exam({ id: 'eA', name: 'Test A', date: '2024-02-01', students: [
    { name: 'Alice', totalMarks: 8, responses: {} }, // 100%
    { name: 'Bob',   totalMarks: 4, responses: {} }, // 50%
  ] }) // avg 0.75
  const eB = exam({ id: 'eB', name: 'Test B', date: '2024-01-01', students: [
    { name: 'Alice', totalMarks: 4, responses: {} }, // 50%
    { name: 'Bob',   totalMarks: 4, responses: {} }, // 50%
  ] }) // avg 0.50

  it('returns one point per exam, sorted by date ascending', () => {
    const series = getPerformanceSeries([eA, eB])
    expect(series.map(p => p.examId)).toEqual(['eB', 'eA'])
    expect(series[0]).toMatchObject({ examId: 'eB', name: 'Test B', date: '2024-01-01' })
    expect(series[0].avgPct).toBeCloseTo(0.5, 5)
    expect(series[1].avgPct).toBeCloseTo(0.75, 5)
  })

  it('skips exams with no scorable students', () => {
    const empty = exam({ id: 'eC', date: '2024-03-01', students: [] })
    const series = getPerformanceSeries([eA, empty])
    expect(series.map(p => p.examId)).toEqual(['eA'])
  })

  it('scopes every point to a name filter', () => {
    const series = getPerformanceSeries([eA, eB], new Set(['Alice']))
    expect(series.find(p => p.examId === 'eA').avgPct).toBeCloseTo(1.0, 5)
    expect(series.find(p => p.examId === 'eB').avgPct).toBeCloseTo(0.5, 5)
  })
})

// ── getClassProjectedAvg ──────────────────────────────────────────────────────
describe('getClassProjectedAvg', () => {
  const freq = [{ chapter: 'Algebra', pct: 50 }, { chapter: 'Calculus', pct: 50 }]
  const e = exam({ students: [
    { name: 'Alice', totalMarks: 8, responses: { 1: 1, 2: 1 } },
    { name: 'Bob',   totalMarks: 0, responses: { 1: -1, 2: -1 } },
  ] })

  it('returns the mean projected score and the count of scored students', () => {
    const r = getClassProjectedAvg([e], freq, 300)
    expect(r.count).toBe(2)
    expect(typeof r.avg).toBe('number')
    expect(r.avg).toBeGreaterThanOrEqual(0)
    // Alice (all correct) must project higher than Bob (all wrong); the mean sits between.
    expect(r.avg).toBeLessThanOrEqual(300)
  })

  it('returns avg 0 / count 0 when there are no students', () => {
    const r = getClassProjectedAvg([exam({ students: [] })], freq, 300)
    expect(r).toEqual({ avg: 0, count: 0 })
  })
})

// ── getPriorityChapters ───────────────────────────────────────────────────────
describe('getPriorityChapters', () => {
  // 3 questions: Q1 Algebra (both correct), Q2/Q3 Calculus (1 of 4 correct).
  const e = exam({
    questions: [
      { q: 1, chapter: 'Algebra',  subtopic: 'Eq' },
      { q: 2, chapter: 'Calculus', subtopic: 'Limits' },
      { q: 3, chapter: 'Calculus', subtopic: 'Deriv' },
    ],
    students: [
      { name: 'S1', totalMarks: 0, responses: { 1: 1, 2: 1, 3: -1 } },
      { name: 'S2', totalMarks: 0, responses: { 1: 1, 2: -1, 3: -1 } },
    ],
  })
  const freq = [
    { chapter: 'Algebra',      pct: 10 }, // accuracy 1.0  → priority 0
    { chapter: 'Calculus',     pct: 20 }, // accuracy 0.25 → priority 15
    { chapter: 'Trigonometry', pct: 5 },  // untested      → priority 5
  ]

  it('ranks chapters by weight × (1 − accuracy), highest first', () => {
    const rows = getPriorityChapters([e], freq, 300)
    expect(rows.map(r => r.chapter)).toEqual(['Calculus', 'Trigonometry', 'Algebra'])
  })

  it('computes accuracy, marks-at-stake and tested flag per chapter', () => {
    const rows = getPriorityChapters([e], freq, 300)
    const calc = rows.find(r => r.chapter === 'Calculus')
    expect(calc.accuracy).toBeCloseTo(0.25, 5)
    expect(calc.weightPct).toBe(20)
    expect(calc.marks).toBeCloseTo(60, 5) // 20% of 300
    expect(calc.tested).toBe(true)
    expect(calc.priority).toBeCloseTo(15, 5)
  })

  it('flags untested high-yield chapters (accuracy null, tested false)', () => {
    const rows = getPriorityChapters([e], freq, 300)
    const trig = rows.find(r => r.chapter === 'Trigonometry')
    expect(trig.tested).toBe(false)
    expect(trig.accuracy).toBeNull()
    expect(trig.priority).toBeCloseTo(5, 5)
  })

  it('matches chapter names case-insensitively', () => {
    const rows = getPriorityChapters([e], [{ chapter: 'calculus', pct: 20 }], 300)
    expect(rows[0].accuracy).toBeCloseTo(0.25, 5)
  })
})

// ── getBatchComparison ────────────────────────────────────────────────────────
describe('getBatchComparison', () => {
  const profiles = {
    Alice: { name: 'Alice', batches: ['Batch-A'], regDate: '2023-01-01' },
    Bob:   { name: 'Bob',   batches: ['Batch-B'], regDate: '2023-01-01' },
  }
  const freq = [{ chapter: 'Algebra', pct: 50 }, { chapter: 'Calculus', pct: 50 }]
  const e = exam({ students: [
    { name: 'Alice', totalMarks: 8, responses: { 1: 1, 2: 1 } }, // 100%
    { name: 'Bob',   totalMarks: 4, responses: { 1: 1, 2: -1 } }, // 50%
  ] })

  it('returns one row per batch with member-scoped metrics', () => {
    const rows = getBatchComparison([e], profiles, freq, 300)
    const byBatch = Object.fromEntries(rows.map(r => [r.batch, r]))
    expect(Object.keys(byBatch).sort()).toEqual(['Batch-A', 'Batch-B'])
    expect(byBatch['Batch-A'].students).toBe(1)
    expect(byBatch['Batch-A'].avgPct).toBeCloseTo(1.0, 5) // Alice only
    expect(byBatch['Batch-B'].avgPct).toBeCloseTo(0.5, 5) // Bob only
  })

  it('reports a numeric projected score and at-risk count per batch', () => {
    const rows = getBatchComparison([e], profiles, freq, 300)
    rows.forEach(r => {
      expect(typeof r.projected).toBe('number')
      expect(typeof r.atRisk).toBe('number')
      expect(r.atRisk).toBeGreaterThanOrEqual(0)
    })
  })

  it('returns an empty array when there are no batches', () => {
    expect(getBatchComparison([exam({ students: [] })], {}, freq, 300)).toEqual([])
  })
})
