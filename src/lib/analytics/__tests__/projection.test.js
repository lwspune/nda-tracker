import { describe, it, expect } from 'vitest'
import { computeProjectedScore, getToppers } from '../projection'

// Helper: build a single-exam fixture for one student answering Functions questions.
// `qs` is an array of { subtopic, verdict } — verdict 1 correct / -1 wrong / 0 skipped.
function functionsExam(name, qs) {
  const questions = qs.map((q, i) => ({
    q: i + 1, chapter: 'Functions', subtopic: q.subtopic,
  }))
  const responses = {}
  qs.forEach((q, i) => { responses[i + 1] = q.verdict })
  return [{
    id: 'e1', date: '2026-07-01', name: 'Mock',
    questions,
    students: [{ name, responses }],
  }]
}

const FREQ = [{ chapter: 'Functions', pct: 10 }] // marksAtStake = 10/100 × 300 = 30

describe('computeProjectedScore — pooled (no per-subtopic averaging)', () => {
  it('pools questions across subtopics of unequal size instead of averaging per subtopic', () => {
    // Subtopic A: 1 question correct. Subtopic B: 1 correct + 2 wrong.
    // per-subtopic mean would be (1 + 1/3)/2 = 0.667; pooled is 2 correct / 4 attempted = 0.5.
    const exams = functionsExam('Amy', [
      { subtopic: 'A', verdict: 1 },
      { subtopic: 'B', verdict: 1 },
      { subtopic: 'B', verdict: -1 },
      { subtopic: 'B', verdict: -1 },
    ])
    const { breakdown, total } = computeProjectedScore('Amy', exams, FREQ, 300)
    const fn = breakdown.find(b => b.chapter === 'Functions')

    expect(fn.accuracy).toBeCloseTo(0.5, 5)          // pooled, not 0.667
    // wrongRate = 2/4 = 0.5; projected = 0.5×30 − 0.5×30×0.33 = 15 − 4.95 = 10.05
    expect(fn.wrongRate).toBeCloseTo(0.5, 5)
    expect(fn.projected).toBeCloseTo(10.05, 4)
    expect(total).toBe(10)
  })

  it('counts a skipped question at half weight in the pooled accuracy', () => {
    // Subtopic A: 1 correct. Subtopic B: 1 skipped.
    // per-subtopic mean would be (1 + 0)/2 = 0.5; pooled is (1×w)/(w + 0.5w) = 0.667.
    const exams = functionsExam('Bea', [
      { subtopic: 'A', verdict: 1 },
      { subtopic: 'B', verdict: 0 },
    ])
    const { breakdown } = computeProjectedScore('Bea', exams, FREQ, 300)
    const fn = breakdown.find(b => b.chapter === 'Functions')

    expect(fn.accuracy).toBeCloseTo(2 / 3, 5)        // pooled with skip at half weight
    expect(fn.wrongRate).toBeCloseTo(0, 5)           // no wrong answers → no penalty
    expect(fn.projected).toBeCloseTo((2 / 3) * 30, 4)
  })

  it('reports a full-marks gap for an untested chapter', () => {
    const exams = functionsExam('Cid', [{ subtopic: 'A', verdict: 1 }])
    // Ask for a chapter the student never saw.
    const { breakdown } = computeProjectedScore('Cid', exams, [{ chapter: 'Vectors', pct: 10 }], 300)
    const v = breakdown.find(b => b.chapter === 'Vectors')
    expect(v.accuracy).toBeNull()
    expect(v.projected).toBe(0)
    expect(v.gap).toBeCloseTo(30, 5)
  })
})

// ── Subtopic breakdown (opt-in) ────────────────────────────────────────────
// A flat, cross-chapter ranking one level below the chapter rows. Opt-in
// because getToppers calls computeProjectedScore once PER STUDENT — building
// and sorting 111 subtopic rows for every topper would be pure waste.

// Statistics is the fixture: 4 real subtopics whose shares are 46.87 / 27.50 /
// 16.87 / 8.75. At pct 10 of 300 the chapter is worth 30 marks.
const CT   = 'Measures of Central Tendency — Mean, Median, Mode'
const DISP = 'Dispersion — Standard Deviation, Variance, Mean Deviation'
const REG  = 'Regression and Correlation'
const STATS_FREQ = [{ chapter: 'Statistics', pct: 10 }]

function statsExam(name, qs) {
  const questions = qs.map((q, i) => ({ q: i + 1, chapter: 'Statistics', subtopic: q.subtopic }))
  const responses = {}
  qs.forEach((q, i) => { responses[i + 1] = q.verdict })
  return [{ id: 'e1', date: '2026-07-01', name: 'Mock', questions, students: [{ name, responses }] }]
}

describe('computeProjectedScore — subtopicBreakdown', () => {
  const exams = statsExam('Dev', [
    { subtopic: CT, verdict: 1 },
    { subtopic: CT, verdict: 1 },
    { subtopic: DISP, verdict: -1 },
  ])

  it('is absent unless asked for, and asking does not move the total', () => {
    const off = computeProjectedScore('Dev', exams, STATS_FREQ, 300)
    const on  = computeProjectedScore('Dev', exams, STATS_FREQ, 300, { withSubtopics: true })

    expect(off.subtopicBreakdown).toBeUndefined()
    expect(on.subtopicBreakdown).toBeInstanceOf(Array)
    expect(on.total).toBe(off.total)
    expect(on.breakdown).toEqual(off.breakdown)
  })

  it("splits the chapter's marks across its subtopics without losing any", () => {
    const { breakdown, subtopicBreakdown } = computeProjectedScore(
      'Dev', exams, STATS_FREQ, 300, { withSubtopics: true })
    const chapter = breakdown.find(b => b.chapter === 'Statistics')
    const mine    = subtopicBreakdown.filter(s => s.chapter === 'Statistics')

    expect(mine).toHaveLength(4)                       // every subtopic, not just the tested ones
    const summed = mine.reduce((s, r) => s + r.marksAtStake, 0)
    expect(summed).toBeCloseTo(chapter.marksAtStake, 2)
  })

  it('scores a tested subtopic from its own questions, not the chapter pool', () => {
    const { subtopicBreakdown } = computeProjectedScore(
      'Dev', exams, STATS_FREQ, 300, { withSubtopics: true })

    const ct = subtopicBreakdown.find(s => s.subtopic === CT)
    expect(ct.accuracy).toBeCloseTo(1, 5)              // 2 correct, nothing else
    expect(ct.marksAtStake).toBeCloseTo(14.061, 2)     // 30 × 46.87%
    expect(ct.projected).toBeCloseTo(14.061, 2)

    const disp = subtopicBreakdown.find(s => s.subtopic === DISP)
    expect(disp.accuracy).toBeCloseTo(0, 5)            // 1 wrong
    expect(disp.projected).toBe(0)                     // clamped, never negative
  })

  it('marks an untested subtopic null-accuracy with its full marks at stake as the gap', () => {
    const { subtopicBreakdown } = computeProjectedScore(
      'Dev', exams, STATS_FREQ, 300, { withSubtopics: true })
    const reg = subtopicBreakdown.find(s => s.subtopic === REG)

    expect(reg.accuracy).toBeNull()                    // null ≠ 0 — untested, not wrong
    expect(reg.n).toBe(0)
    expect(reg.projected).toBe(0)
    expect(reg.gap).toBeCloseTo(reg.marksAtStake, 5)
  })

  it('ranks flat across chapters by recoverable marks, highest first', () => {
    const multi = [{
      id: 'e1', date: '2026-07-01', name: 'Mock',
      questions: [
        { q: 1, chapter: 'Statistics', subtopic: CT, },
        { q: 2, chapter: 'Vectors', subtopic: 'Dot Product and Angle' },
      ],
      students: [{ name: 'Eve', responses: { 1: 1, 2: 1 } }],
    }]
    const { subtopicBreakdown } = computeProjectedScore(
      'Eve', multi, [{ chapter: 'Statistics', pct: 10 }, { chapter: 'Vectors', pct: 10 }],
      300, { withSubtopics: true })

    const chapters = new Set(subtopicBreakdown.map(s => s.chapter))
    expect(chapters).toEqual(new Set(['Statistics', 'Vectors']))   // one flat list

    const gaps = subtopicBreakdown.map(s => s.gap)
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a))
  })

  it('omits chapters that have no subtopic taxonomy and counts them instead', () => {
    const exams2 = [{
      id: 'e1', date: '2026-07-01', name: 'Mock',
      questions: [{ q: 1, chapter: 'Made Up Chapter', subtopic: 'Whatever' }],
      students: [{ name: 'Fay', responses: { 1: 1 } }],
    }]
    const res = computeProjectedScore(
      'Fay', exams2, [{ chapter: 'Made Up Chapter', pct: 10 }], 300, { withSubtopics: true })

    // Silently shrinking the list would read as "nothing at stake here".
    expect(res.subtopicBreakdown).toEqual([])
    expect(res.subtopicsUncovered).toEqual(['Made Up Chapter'])
    expect(res.total).toBeGreaterThan(0)               // chapter still scores normally
  })
})

describe('getToppers — gates on projected marks (absolute), not avg %', () => {
  // One exam, 2 Functions questions, freq = 100% Functions → marksAtStake = 300.
  // Hi: both correct  → accuracy 1, wrongRate 0 → projected 300.
  // Lo: both wrong    → accuracy 0, wrongRate 1 → projected max(0, −99) = 0.
  const FN_FREQ = [{ chapter: 'Functions', pct: 100 }]
  const exams = [{
    id: 'e1', date: '2026-07-01', name: 'Mock', subject: 'Maths',
    marking: { correct: 4, wrong: -1 },
    questions: [
      { q: 1, chapter: 'Functions', subtopic: 'A' },
      { q: 2, chapter: 'Functions', subtopic: 'B' },
    ],
    students: [
      { name: 'Hi', totalMarks: 8, responses: { 1: 1, 2: 1 } },
      { name: 'Lo', totalMarks: 0, responses: { 1: -1, 2: -1 } },
    ],
  }]

  it('keeps only students whose projected score meets the marks threshold', () => {
    // threshold = 100 MARKS. Hi (projected 300) qualifies; Lo (projected 0) drops.
    // (Under the old avg-% gate, 100 was a fraction and dropped everyone.)
    const toppers = getToppers(exams, FN_FREQ, 100, 300)
    expect(toppers.map(t => t.name)).toEqual(['Hi'])
  })

  it('threshold 0 returns every scored student (incl. projected-0) — dashboard reuse relies on this', () => {
    const toppers = getToppers(exams, FN_FREQ, 0, 300)
    expect(toppers.map(t => t.name).sort()).toEqual(['Hi', 'Lo'])
  })

  it('ranks qualifiers by projected score descending', () => {
    const toppers = getToppers(exams, FN_FREQ, 0, 300)
    expect(toppers.map(t => t.projected)).toEqual([300, 0])
  })
})
