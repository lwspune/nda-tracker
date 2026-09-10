import { describe, it, expect } from 'vitest'
import { defaultErrorSetRange, selectErrorSetExams } from '../errorSetSelect'

// Four papers spanning two subjects, two batches and a written (no questions[])
// exam — the shapes the picker has to tell apart.
const mathsRecent = {
  id: 'm7', name: 'Maths Mock 7', date: '2026-09-07', subject: 'Maths',
  batch: 'LWS_NDA_2Y_(25-27)_A',
  questions: [{ q: 1, question: 'a' }, { q: 2, question: 'b' }],
  students: [{ name: 'A', responses: { 1: 1, 2: -1 } }, { name: 'B', responses: { 1: 0, 2: 0 } }],
}
const mathsOlder = {
  id: 'm6', name: 'Maths Mock 6', date: '2026-08-31', subject: 'Maths',
  // Comma-joined: sat by two batches.
  batch: 'LWS_NDA_2Y_(25-27)_A, LWS_NDA_2Y_(25-27)_B',
  questions: [{ q: 1, question: 'a' }],
  students: [{ name: 'A', responses: { 1: -1 } }],
}
const gat = {
  id: 'g1', name: 'GAT Mock 3', date: '2026-09-01', subject: 'GAT',
  batch: 'LWS_NDA_2Y_(25-27)_A',
  questions: [{ q: 1, question: 'a' }],
  students: [{ name: 'A', responses: { 1: -1 } }],
}
// Written quiz: a total was recorded, there are no per-question rows, so it can
// never contribute a wrong/skipped question.
const written = {
  id: 'w1', name: 'Integration Written Test', date: '2026-09-03', subject: 'Maths',
  batch: 'LWS_NDA_2Y_(25-27)_A', maxMarks: 25, questions: [],
  students: [{ name: 'A', totalMarks: 18 }],
}
const outOfRange = {
  id: 'm5', name: 'Maths Mock 5', date: '2026-06-12', subject: 'Maths',
  batch: 'LWS_NDA_2Y_(25-27)_A',
  questions: [{ q: 1, question: 'a' }],
  students: [{ name: 'A', responses: { 1: -1 } }],
}

const ALL = [mathsRecent, mathsOlder, gat, written, outOfRange]
const base = { exams: ALL, from: '2026-08-01', to: '2026-09-10' }

const ids = rows => rows.map(r => r.id)

describe('defaultErrorSetRange', () => {
  it('spans the last 30 days inclusive of today', () => {
    const { from, to } = defaultErrorSetRange(new Date(2026, 8, 10)) // 10 Sep 2026
    expect(to).toBe('2026-09-10')
    expect(from).toBe('2026-08-11')
  })

  it('crosses a month boundary without producing an invalid date', () => {
    const { from, to } = defaultErrorSetRange(new Date(2026, 0, 5)) // 5 Jan 2026
    expect(to).toBe('2026-01-05')
    expect(from).toBe('2025-12-06')
  })
})

describe('selectErrorSetExams', () => {
  it('keeps only exams inside the range, newest first', () => {
    const rows = selectErrorSetExams(base)
    expect(ids(rows)).toEqual(['m7', 'w1', 'g1', 'm6'])
    expect(ids(rows)).not.toContain('m5')
  })

  it('includes both range endpoints', () => {
    const rows = selectErrorSetExams({ ...base, from: '2026-08-31', to: '2026-09-07' })
    expect(ids(rows)).toContain('m6')
    expect(ids(rows)).toContain('m7')
  })

  it('filters by subject when one is given, and returns all subjects when blank', () => {
    expect(ids(selectErrorSetExams({ ...base, subject: 'Maths' }))).toEqual(['m7', 'w1', 'm6'])
    expect(ids(selectErrorSetExams({ ...base, subject: '' }))).toHaveLength(4)
  })

  it('matches a batch inside a comma-joined tag, exactly', () => {
    const rows = selectErrorSetExams({ ...base, batch: 'LWS_NDA_2Y_(25-27)_B' })
    expect(ids(rows)).toEqual(['m6'])
  })

  it('does not treat a batch name as a prefix of a longer one', () => {
    // `_A` must not match `_A2` — the bug the exact re-check after an ilike
    // prefilter exists to prevent.
    const a2 = { ...mathsRecent, id: 'm8', batch: 'LWS_NDA_2Y_(25-27)_A2' }
    const rows = selectErrorSetExams({
      ...base, exams: [...ALL, a2], batch: 'LWS_NDA_2Y_(25-27)_A',
    })
    expect(ids(rows)).not.toContain('m8')
  })

  it('marks a written exam as ineligible rather than dropping it silently', () => {
    // It has to be visible — a teacher who sees only 3 of the 4 papers they set
    // will assume the picker is broken. Flagged, disabled, never hidden.
    const row = selectErrorSetExams(base).find(r => r.id === 'w1')
    expect(row).toBeTruthy()
    expect(row.eligible).toBe(false)
    expect(row.reason).toMatch(/written|no per-question/i)
  })

  it('reports question and sat counts for the checklist', () => {
    const row = selectErrorSetExams(base).find(r => r.id === 'm7')
    expect(row.questionCount).toBe(2)
    expect(row.satCount).toBe(2)
    expect(row.eligible).toBe(true)
  })

  it('returns an empty array for missing input rather than throwing', () => {
    expect(selectErrorSetExams()).toEqual([])
    expect(selectErrorSetExams({ exams: null, from: '2026-01-01', to: '2026-12-31' })).toEqual([])
  })
})
