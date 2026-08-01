import { describe, it, expect } from 'vitest'
import { buildPracticeSet, BUCKETS } from '../practiceSet'

// One exam the student sat: q1 right, q2 wrong, q3 skipped, q4 a different subtopic.
const sat = {
  id: 'e1', name: 'Mock 1', date: '2026-07-01',
  questions: [
    { q: 1, chapter: 'Probability', subtopic: 'Probability via Counting', difficulty: 'Easy' },
    { q: 2, chapter: 'Probability', subtopic: 'Probability via Counting', difficulty: 'Hard' },
    { q: 3, chapter: 'Probability', subtopic: 'Probability via Counting' },
    { q: 4, chapter: 'Statistics',  subtopic: 'Regression and Correlation' },
  ],
  students: [{ name: 'Amy', responses: { 1: 1, 2: -1, 3: 0, 4: 1 } }],
}

// An exam her batch sat that she has no result row for.
const missed = {
  id: 'e2', name: 'Mock 2', date: '2026-07-08',
  questions: [
    { q: 1, chapter: 'Probability', subtopic: 'Probability via Counting', difficulty: 'Moderate' },
    { q: 2, chapter: 'Statistics',  subtopic: 'Regression and Correlation' },
  ],
  students: [{ name: 'Someone Else', responses: { 1: 1, 2: 1 } }],
}

const breakdown = [
  { subtopic: 'Probability via Counting', chapter: 'Probability', marksAtStake: 11.8, projected: 4.6, gap: 7.2 },
  { subtopic: 'Regression and Correlation', chapter: 'Statistics', marksAtStake: 3.8, projected: 0, gap: 3.8 },
  { subtopic: 'Never Set', chapter: 'Lines', marksAtStake: 4.5, projected: 0, gap: 4.5 },
]

const base = { subtopicBreakdown: breakdown, exams: [sat], name: 'Amy', absentExams: [missed] }

describe('buildPracticeSet', () => {
  it('sorts subtopics by marks recoverable and honours topN', () => {
    const { rows } = buildPracticeSet({ ...base, topN: 2 })
    expect(rows.map(r => r.subtopic)).toEqual(['Probability via Counting', 'Never Set'])
  })

  it('splits a subtopic into the four buckets', () => {
    const { rows } = buildPracticeSet(base)
    const p = rows.find(r => r.subtopic === 'Probability via Counting')
    expect(p.counts).toEqual({ right: 1, wrong: 1, skipped: 1, absent: 1 })
  })

  it('orders questions wrong → skipped → absent → right', () => {
    const { rows } = buildPracticeSet(base)
    const p = rows.find(r => r.subtopic === 'Probability via Counting')
    expect(p.questions.map(q => q.bucket)).toEqual(['wrong', 'skipped', 'absent', 'right'])
  })

  it('reads the verdict from responses, never from questions[].answer', () => {
    // answer is deliberately absent from the fixtures — grading is Evalbee's.
    const { rows } = buildPracticeSet(base)
    const p = rows.find(r => r.subtopic === 'Probability via Counting')
    expect(p.questions.find(q => q.bucket === 'wrong').q).toBe(2)
    expect(p.questions.find(q => q.bucket === 'right').q).toBe(1)
  })

  it('carries difficulty through, and tolerates its absence', () => {
    const { rows } = buildPracticeSet(base)
    const p = rows.find(r => r.subtopic === 'Probability via Counting')
    expect(p.questions.find(q => q.q === 2 && q.bucket === 'wrong').difficulty).toBe('Hard')
    expect(p.questions.find(q => q.bucket === 'skipped').difficulty).toBe('')
  })

  it('matches on subtopic NAME, not chapter+subtopic', () => {
    // Same subtopic filed under a different chapter — PYQ Vault puts
    // "Continuity and Differentiability" under Limits & Continuity while our
    // tags say Differentiation. Keying on the pair silently drops those.
    const oddChapter = {
      ...sat, id: 'e3',
      questions: [{ q: 1, chapter: 'A Different Chapter', subtopic: 'Probability via Counting' }],
      students: [{ name: 'Amy', responses: { 1: -1 } }],
    }
    const { rows } = buildPracticeSet({ ...base, exams: [oddChapter], absentExams: [] })
    expect(rows.find(r => r.subtopic === 'Probability via Counting').counts.wrong).toBe(1)
  })

  it('keeps a subtopic with no questions rather than dropping it', () => {
    const { rows } = buildPracticeSet(base)
    const empty = rows.find(r => r.subtopic === 'Never Set')
    expect(empty).toBeDefined()
    expect(empty.questions).toEqual([])
    expect(empty.counts).toEqual({ right: 0, wrong: 0, skipped: 0, absent: 0 })
  })

  it('ignores exams the student has no result row in when bucketing answers', () => {
    // `missed` contains a Regression question; it must land in absent, not skipped.
    const { rows } = buildPracticeSet(base)
    const r = rows.find(r => r.subtopic === 'Regression and Correlation')
    expect(r.counts).toEqual({ right: 1, wrong: 0, skipped: 0, absent: 1 })
  })

  it('numbers questions sequentially across the whole set for the answer key', () => {
    const { rows, totals } = buildPracticeSet(base)
    const ns = rows.flatMap(r => r.questions.map(q => q.n))
    expect(ns).toEqual([...Array(ns.length)].map((_, i) => i + 1))
    expect(totals.questions).toBe(ns.length)
  })

  it('totals the counts and the recoverable marks', () => {
    const { totals } = buildPracticeSet(base)
    expect(totals.counts).toEqual({ right: 2, wrong: 1, skipped: 1, absent: 2 })
    expect(totals.lift).toBeCloseTo(7.2 + 4.5 + 3.8, 5)
  })

  it('returns empty rather than throwing when there is no breakdown', () => {
    expect(buildPracticeSet({ subtopicBreakdown: [], exams: [], name: 'Amy' }).rows).toEqual([])
  })

  it('exposes the bucket order it used', () => {
    expect(BUCKETS).toEqual(['wrong', 'skipped', 'absent', 'right'])
  })
})

// ── findAbsentExams ─────────────────────────────────────────────────────────
// "Her batch sat it and she didn't" — NOT "some classmate has a result here".
// The naive version counted 1,101 questions for one real student where the
// batch-tagged answer is 180: 9 of 12 "missed" exams were other cohorts' papers
// that a single batch-mate happened to sit.

import { findAbsentExams } from '../practiceSet'

const mkExam = (id, batch, students = []) => ({
  id, name: id, date: '2026-07-01', batch,
  questions: [{ q: 1, chapter: 'C', subtopic: 'S' }],
  students,
})

describe('findAbsentExams', () => {
  const batches = ['LWS_NDA_2Y_(25-27)_A']

  it('returns exams tagged to her batch that she has no result in', () => {
    const exams = [mkExam('missed', 'LWS_NDA_2Y_(25-27)_A', [{ name: 'Someone' }])]
    expect(findAbsentExams({ exams, name: 'Amy', batches }).map(e => e.id)).toEqual(['missed'])
  })

  it('excludes exams she sat', () => {
    const exams = [mkExam('sat', 'LWS_NDA_2Y_(25-27)_A', [{ name: 'Amy' }])]
    expect(findAbsentExams({ exams, name: 'Amy', batches })).toEqual([])
  })

  it('excludes another cohort\'s paper even when a batch-mate sat it', () => {
    // The 9-of-12 false positives: tagged to APJ, one shared-tag student present.
    const exams = [mkExam('other', 'APJ_NDA_12th_(26-27)', [{ name: 'Classmate' }])]
    expect(findAbsentExams({ exams, name: 'Amy', batches })).toEqual([])
  })

  it('splits a comma-joined batch tag', () => {
    const exams = [mkExam('multi', 'LWS_NDA_2Y_(25-27)_B, LWS_NDA_2Y_(25-27)_A', [])]
    expect(findAbsentExams({ exams, name: 'Amy', batches }).map(e => e.id)).toEqual(['multi'])
  })

  it('ignores untagged exams and offline exams with no questions', () => {
    const exams = [
      mkExam('untagged', null, []),
      { ...mkExam('offline', 'LWS_NDA_2Y_(25-27)_A', []), questions: [] },
    ]
    expect(findAbsentExams({ exams, name: 'Amy', batches })).toEqual([])
  })

  it('returns nothing when the student has no batch — never guesses', () => {
    const exams = [mkExam('x', 'LWS_NDA_2Y_(25-27)_A', [])]
    expect(findAbsentExams({ exams, name: 'Amy', batches: [] })).toEqual([])
  })
})

describe('name variants', () => {
  // Results are filed under whatever the Evalbee sheet spelled. Tapasya Mohan
  // Shelke's sit under "Tapasya Shelke"; matching only the canonical name
  // reported her as having sat nothing and dumped 1,468 questions into absent.
  const variantExam = {
    id: 'v1', name: 'Mock', date: '2026-07-01', batch: 'B1',
    questions: [{ q: 1, chapter: 'C', subtopic: 'Probability via Counting' }],
    students: [{ name: 'T Shelke', responses: { 1: -1 } }],
  }
  const names = ['Tapasya Mohan Shelke', 'T Shelke']

  it('buckets answers filed under a name variant', () => {
    const { rows } = buildPracticeSet({
      subtopicBreakdown: breakdown, exams: [variantExam],
      name: 'Tapasya Mohan Shelke', names, absentExams: [],
    })
    expect(rows.find(r => r.subtopic === 'Probability via Counting').counts.wrong).toBe(1)
  })

  it('does not call an exam absent when the variant sat it', () => {
    expect(findAbsentExams({
      exams: [variantExam], name: 'Tapasya Mohan Shelke', names, batches: ['B1'],
    })).toEqual([])
  })
})
