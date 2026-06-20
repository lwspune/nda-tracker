import { describe, it, expect } from 'vitest'
import { buildExamIntegrityReport } from '../examIntegrity'

// ── Fixture helpers ───────────────────────────────────────────
// Correct answer for every question is 'A'. A student's "pattern" string is one
// char per question: 'A' = correct, 'B'/'C'/'D' = a wrong option, '-' = skipped.
const KEY = 'A'

function student(name, rollNo, pattern, totalMarks = 0) {
  const choices = {}
  const responses = {}
  for (let i = 0; i < pattern.length; i++) {
    const q = String(i + 1)
    const ch = pattern[i]
    if (ch === '-') { choices[q] = null; responses[q] = 0 }
    else { choices[q] = ch; responses[q] = ch === KEY ? 1 : -1 }
  }
  return { name, rollNo, totalMarks, choices, responses }
}

function questions(n) {
  return Array.from({ length: n }, (_, i) => ({
    q: String(i + 1), chapter: 'Chap', subtopic: 'Sub', answer: KEY,
    question: `Question ${i + 1}?`, optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd',
  }))
}

function makeExam(students, overrides = {}) {
  return {
    id: 'e1', name: 'Mock', date: '2026-06-14',
    questions: questions(20), marking: { correct: 4, wrong: -1 },
    students, ...overrides,
  }
}

const rep20 = (ch) => ch.repeat(20)

describe('buildExamIntegrityReport — availability guards', () => {
  it('returns available:false for an offline exam (no questions)', () => {
    const exam = makeExam([student('A', '1', rep20('A'))], { questions: [] })
    const r = buildExamIntegrityReport(exam)
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/offline/i)
  })

  it('returns available:false when no chosen options were captured', () => {
    // Older upload: responses present but choices all empty.
    const s = { name: 'A', rollNo: '1', totalMarks: 0, responses: { '1': -1 }, choices: {} }
    const r = buildExamIntegrityReport(makeExam([s]))
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/chosen option|choices/i)
  })

  it('counts only students who have captured choices', () => {
    const withChoices = student('Has', '1', rep20('A'))
    const without = { name: 'No', rollNo: '2', totalMarks: 0, responses: {}, choices: {} }
    const r = buildExamIntegrityReport(makeExam([withChoices, without]))
    expect(r.available).toBe(true)
    expect(r.nStudents).toBe(1)
  })
})

describe('buildExamIntegrityReport — identical-paper (Tier A)', () => {
  // Two students: Q1-2 correct (A), Q3-20 the same wrong option (B). Identical.
  const p1 = student('Copy One', '00010', 'AA' + 'B'.repeat(18), 30)
  const p2 = student('Copy Two', '00011', 'AA' + 'B'.repeat(18), 28)
  const filler = student('Filler', '00099', 'A'.repeat(10) + '-'.repeat(10), 40)
  const r = buildExamIntegrityReport(makeExam([p1, p2, filler]))

  it('flags the identical pair as Tier A', () => {
    const pair = r.pairs.find(p => p.a.name === 'Copy One' || p.b.name === 'Copy One')
    expect(pair).toBeTruthy()
    expect(pair.tier).toBe('A')
    expect(pair.sameWrong).toBe(18)
    expect(pair.sameCorrect).toBe(2)
    expect(pair.diff).toBe(0)
    expect(pair.bothAnswered).toBe(20)
  })

  it('exposes shared-wrong questions for the drill-down (same wrong option only)', () => {
    const pair = r.pairs.find(p => p.a.name === 'Copy One')
    expect(pair.sharedWrongQ).toHaveLength(18)
    // None of the two correct answers (Q1, Q2) leak into the wrong list.
    expect(pair.sharedWrongQ.some(x => x.q === '1' || x.q === '2')).toBe(false)
    expect(pair.sharedWrongQ.every(x => x.choice === 'B')).toBe(true)
  })

  it('marks adjacent roll numbers', () => {
    const pair = r.pairs.find(p => p.a.name === 'Copy One')
    expect(pair.rollAdjacent).toBe(true)
  })
})

describe('buildExamIntegrityReport — hub suppression', () => {
  // Hub shares 8 wrong answers with X but disagrees on 12 → Harpp-Hogan < 1.
  // A weak student hitting popular distractors, NOT a copier. Must not be flagged.
  const hub = student('Hub', '00001', 'C'.repeat(20), 10)
  const x = student('Popular', '00050', 'C'.repeat(8) + 'B'.repeat(12), 12)
  const r = buildExamIntegrityReport(makeExam([hub, x]))

  it('does not flag a high-shared-wrong pair when differences dominate (hh < 1)', () => {
    const pair = r.pairs.find(
      p => (p.a.name === 'Hub' && p.b.name === 'Popular') ||
           (p.a.name === 'Popular' && p.b.name === 'Hub')
    )
    expect(pair).toBeUndefined()
  })
})

describe('buildExamIntegrityReport — outlier dyad via z-score (Tier B)', () => {
  // 6 honest students answer everything correctly (no shared wrong answers).
  // One pair shares 13 wrong answers but differs on 7 (diff > 5 so NOT Tier A),
  // with hh ≈ 1.86 — should surface as a Tier B z-score outlier.
  const normals = Array.from({ length: 6 }, (_, i) =>
    student(`Normal${i}`, String(80 + i), rep20('A'), 80))
  const o1 = student('Out One', '00030', 'A'.repeat(7) + 'C'.repeat(7) + 'D'.repeat(6), 20)
  const o2 = student('Out Two', '00031', 'B'.repeat(7) + 'C'.repeat(7) + 'D'.repeat(6), 22)
  const r = buildExamIntegrityReport(makeExam([...normals, o1, o2]))

  it('flags the outlier pair as Tier B with a finite z-score', () => {
    const pair = r.pairs.find(
      p => (p.a.name === 'Out One' || p.b.name === 'Out One'))
    expect(pair).toBeTruthy()
    expect(pair.tier).toBe('B')
    expect(pair.diff).toBe(7)
    expect(pair.sameWrong).toBe(13)
    expect(Number.isFinite(pair.z)).toBe(true)
    expect(pair.z).toBeGreaterThanOrEqual(4)
  })
})

describe('buildExamIntegrityReport — cluster grouping', () => {
  // Three students with identical papers → a 3-member ring, one cluster.
  const c1 = student('Ring A', '00012', 'A' + 'C'.repeat(19), 5)
  const c2 = student('Ring B', '00040', 'A' + 'C'.repeat(19), 6)
  const c3 = student('Ring C', '00077', 'A' + 'C'.repeat(19), 7)
  const r = buildExamIntegrityReport(makeExam([c1, c2, c3]))

  it('groups mutually-matching students into a single cluster', () => {
    const big = r.clusters.find(c => c.members.length >= 3)
    expect(big).toBeTruthy()
    expect(new Set(big.members)).toEqual(new Set(['Ring A', 'Ring B', 'Ring C']))
  })

  it('non-adjacent rolls within the ring are not marked adjacent', () => {
    const pair = r.pairs.find(p =>
      (p.a.name === 'Ring A' && p.b.name === 'Ring B') ||
      (p.a.name === 'Ring B' && p.b.name === 'Ring A'))
    expect(pair.rollAdjacent).toBe(false)
  })
})

describe('buildExamIntegrityReport — minimum common answers', () => {
  it('ignores pairs with too few commonly-answered questions', () => {
    // Both attempt only 4 questions (all the same wrong) — below minBothAnswered.
    const a = student('Sparse A', '1', 'BBBB' + '-'.repeat(16))
    const b = student('Sparse B', '2', 'BBBB' + '-'.repeat(16))
    const r = buildExamIntegrityReport(makeExam([a, b]))
    expect(r.pairs).toHaveLength(0)
  })
})
