import { describe, it, expect } from 'vitest'
import { buildGatErrorSet, GAT_BUCKETS } from '../gatErrorSet'

// Two GAT papers. The second re-uses one stem from the first (PYQs repeat
// across mocks) and adds a Directions block shared by two questions.
const mock1 = {
  id: 'g1', name: 'GAT Mock 1', date: '2026-06-06',
  questions: [
    { q: 1, subject: 'English', chapter: 'Grammar', subtopic: 'Articles',
      question: 'Not ___ metal is solid.', optionA: 'each', optionB: 'every',
      optionC: 'all', optionD: 'any', answer: 'B', solution: 'Not every.', difficulty: 'Moderate' },
    { q: 2, subject: 'English', chapter: 'Grammar', subtopic: 'Articles',
      question: 'He is ___ honest man.', optionA: 'a', optionB: 'an',
      optionC: 'the', optionD: 'no', answer: 'B', solution: 'Vowel sound.' },
    { q: 3, subject: 'English', chapter: 'Vocabulary', subtopic: 'Synonyms',
      question: 'Synonym of ABATE', optionA: 'rise', optionB: 'lessen',
      optionC: 'hold', optionD: 'stir', answer: 'B' },
    { q: 4, subject: 'Geography', chapter: 'Climatology', subtopic: 'Winds',
      question: 'Trade winds blow from', optionA: 'E', optionB: 'W',
      optionC: 'N', optionD: 'S', answer: 'A' },
    { q: 5, subject: 'Physics', chapter: 'Optics', subtopic: 'Mirrors',
      question: 'Focal length of a plane mirror is', optionA: '0', optionB: '\\(\\infty\\)',
      optionC: '1', optionD: '-1', answer: 'B' },
  ],
  students: [
    // right, wrong, skipped, wrong, right
    { name: 'Jagannath Rout', responses: { 1: 1, 2: -1, 3: 0, 4: -1, 5: 1 } },
    { name: 'Someone Else', responses: { 1: -1, 2: -1, 3: -1, 4: -1, 5: -1 } },
  ],
}

const mock2 = {
  id: 'g2', name: 'GAT Mock 2', date: '2026-06-13',
  questions: [
    // A repeat of mock1 q3, differently spaced — still the same question.
    { q: 1, subject: 'English', chapter: 'Vocabulary', subtopic: 'Synonyms',
      question: 'Synonym  of   ABATE', optionA: 'rise', optionB: 'lessen',
      optionC: 'hold', optionD: 'stir', answer: 'B' },
    { q: 2, subject: 'English', chapter: 'Reading Comprehension', subtopic: 'Inference',
      context: 'Read the passage and answer.', question: 'The author implies that',
      optionA: 'x', optionB: 'y', optionC: 'z', optionD: 'w', answer: 'C' },
    { q: 3, subject: 'English', chapter: 'Reading Comprehension', subtopic: 'Inference',
      context: 'Read the passage and answer.', question: 'The tone of the passage is',
      optionA: 'x', optionB: 'y', optionC: 'z', optionD: 'w', answer: 'A' },
    // Blank stem — cannot be printed at a student.
    { q: 4, subject: 'History', chapter: 'Modern India', subtopic: 'Revolt',
      question: '', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', answer: 'A' },
  ],
  students: [{ name: 'Jaggannath Rout', responses: { 1: -1, 2: 0, 3: -1, 4: 0 } }],
}

const base = { exams: [mock1, mock2], names: ['Jagannath Rout', 'Jaggannath Rout'] }

describe('buildGatErrorSet', () => {
  it('keeps only wrong and skipped, never right', () => {
    const { subjects, totals } = buildGatErrorSet(base)
    const all = subjects.flatMap(s => s.chapters.flatMap(c => c.questions))
    expect(all.every(q => GAT_BUCKETS.includes(q.bucket))).toBe(true)
    // mock1: q2 wrong, q3 skipped, q4 wrong. mock2: q1 repeat, q2 skipped,
    // q3 wrong, q4 dropped (blank stem).
    expect(totals.counts).toEqual({ wrong: 3, skipped: 2, absent: 0 })
    expect(totals.questions).toBe(5)
  })

  it('buckets from the Evalbee verdict, not from the answer key', () => {
    // q1 is answered B and IS B, but the verdict says -1. The verdict wins.
    const exam = {
      ...mock1,
      students: [{ name: 'Jagannath Rout', responses: { 1: -1 }, choices: { 1: 'B' } }],
    }
    const { subjects } = buildGatErrorSet({ exams: [exam], names: ['Jagannath Rout'] })
    const q = subjects[0].chapters[0].questions[0]
    expect(q.bucket).toBe('wrong')
  })

  it('matches every name spelling the results are filed under', () => {
    const one = buildGatErrorSet({ exams: [mock2], names: ['Jagannath Rout'] })
    expect(one.totals.questions).toBe(0)
    const both = buildGatErrorSet({ exams: [mock2], names: ['Jagannath Rout', 'Jaggannath Rout'] })
    expect(both.totals.questions).toBe(3)
  })

  it('ignores exams the student has no result row in', () => {
    const notMine = { ...mock1, students: [{ name: 'Someone Else', responses: { 1: -1, 2: -1 } }] }
    const { totals } = buildGatErrorSet({ exams: [notMine], names: ['Jagannath Rout'] })
    expect(totals.questions).toBe(0)
  })

  it('drops a blank stem and counts it rather than printing an empty question', () => {
    const { totals } = buildGatErrorSet(base)
    expect(totals.droppedNoText).toBe(1)
  })

  it('de-duplicates a repeated stem and records the repeat on the kept question', () => {
    const { subjects } = buildGatErrorSet(base)
    const vocab = subjects.find(s => s.subject === 'English')
      .chapters.find(c => c.chapter === 'Vocabulary')
    expect(vocab.questions).toHaveLength(1)
    const [q] = vocab.questions
    // Earliest sitting is kept; the later one is recorded, not printed.
    expect(q.examName).toBe('GAT Mock 1')
    expect(q.bucket).toBe('skipped')
    expect(q.repeats).toEqual([
      { examName: 'GAT Mock 2', examDate: '2026-06-13', bucket: 'wrong' },
    ])
  })

  it('orders subjects and chapters by how much is wrong or skipped', () => {
    const { subjects } = buildGatErrorSet(base)
    expect(subjects.map(s => s.subject)).toEqual(['English', 'Geography'])
    expect(subjects[0].chapters.map(c => c.chapter))
      .toEqual(['Reading Comprehension', 'Grammar', 'Vocabulary'])
  })

  it('keeps questions sharing a Directions block adjacent and prints it once', () => {
    const { subjects } = buildGatErrorSet(base)
    const rc = subjects.find(s => s.subject === 'English')
      .chapters.find(c => c.chapter === 'Reading Comprehension')
    expect(rc.questions.map(q => q.showContext)).toEqual([true, false])
    expect(rc.questions[0].context).toBe('Read the passage and answer.')
    // Within a context group, wrong comes before skipped.
    expect(rc.questions.map(q => q.bucket)).toEqual(['wrong', 'skipped'])
  })

  it('numbers sequentially across the whole document so the key can reference it', () => {
    const { subjects } = buildGatErrorSet(base)
    const ns = subjects.flatMap(s => s.chapters.flatMap(c => c.questions)).map(q => q.n)
    expect(ns).toEqual([1, 2, 3, 4, 5])
  })

  it('reports how many questions have no solution to print', () => {
    const { totals } = buildGatErrorSet(base)
    // mock1 q3 (kept vocab), q4 and mock2 q2, q3 carry no solution.
    expect(totals.missingSolution).toBe(4)
  })
})

// ── Error Sets page options: absent bucket, subject filter, cap ─────────────
// These are additive — every default below must leave the behaviour above
// untouched, which the "unchanged by default" tests pin.

// A paper the student's batch sat but they have no result row in.
const missed = {
  id: 'g3', name: 'GAT Mock 3', date: '2026-06-20',
  questions: [
    { q: 1, subject: 'Polity', chapter: 'Constitution', subtopic: 'Preamble',
      question: 'The Preamble declares India to be', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', answer: 'A' },
    { q: 2, subject: 'Polity', chapter: 'Constitution', subtopic: 'Rights',
      question: 'Right to equality is Article', optionA: '12', optionB: '14',
      optionC: '19', optionD: '21', answer: 'B' },
  ],
  students: [{ name: 'Someone Else', responses: { 1: 1, 2: 1 } }],
}

describe('buildGatErrorSet — absent bucket', () => {
  it('adds every question of a missed exam when absentExams is given', () => {
    const { subjects, totals } = buildGatErrorSet({ ...base, absentExams: [missed] })
    const polity = subjects.find(s => s.subject === 'Polity')
    expect(polity.chapters[0].questions.map(q => q.bucket)).toEqual(['absent', 'absent'])
    expect(totals.counts.absent).toBe(2)
  })

  it('is off by default — an unattempted paper is not a mistake', () => {
    const { totals } = buildGatErrorSet(base)
    expect(totals.counts.absent ?? 0).toBe(0)
    expect(totals.questions).toBe(5)
  })

  it('still numbers contiguously once absent questions join', () => {
    const { subjects } = buildGatErrorSet({ ...base, absentExams: [missed] })
    const ns = subjects.flatMap(s => s.chapters.flatMap(c => c.questions)).map(q => q.n)
    expect(ns).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('buildGatErrorSet — qSubject filter', () => {
  it('keeps only the named question subject on a combined paper', () => {
    const { subjects, totals } = buildGatErrorSet({ ...base, qSubject: 'English' })
    expect(subjects.map(s => s.subject)).toEqual(['English'])
    // mock1 q2 (wrong) + q3 (skipped), mock2 q2 (skipped) + q3 (wrong).
    expect(totals.questions).toBe(4)
  })

  it('returns nothing for a subject with no errors, rather than everything', () => {
    const { subjects, totals } = buildGatErrorSet({ ...base, qSubject: 'Chemistry' })
    expect(subjects).toEqual([])
    expect(totals.questions).toBe(0)
  })
})

describe('buildGatErrorSet — cap', () => {
  it('limits the set to the cap, keeping the most recent sittings', () => {
    const { subjects, totals } = buildGatErrorSet({ ...base, cap: 2 })
    expect(totals.questions).toBe(2)
    const kept = subjects.flatMap(s => s.chapters.flatMap(c => c.questions))
    // mock2 (13 Jun) is newer than mock1 (06 Jun), so its two errors survive.
    expect(kept.every(q => q.examDate === '2026-06-13')).toBe(true)
  })

  it('renumbers from 1 after capping so the solutions key still lines up', () => {
    const { subjects } = buildGatErrorSet({ ...base, cap: 3 })
    const ns = subjects.flatMap(s => s.chapters.flatMap(c => c.questions)).map(q => q.n)
    expect(ns).toEqual([1, 2, 3])
  })

  it('reports the pre-cap total so the page can say what was left out', () => {
    const { totals } = buildGatErrorSet({ ...base, cap: 2 })
    expect(totals.available).toBe(5)
    expect(totals.questions).toBe(2)
  })

  it('is a no-op when the cap exceeds what is available', () => {
    const { totals } = buildGatErrorSet({ ...base, cap: 500 })
    expect(totals.questions).toBe(5)
    expect(totals.available).toBe(5)
  })

  it('treats a blank or zero cap as no cap', () => {
    expect(buildGatErrorSet({ ...base, cap: 0 }).totals.questions).toBe(5)
    expect(buildGatErrorSet({ ...base, cap: null }).totals.questions).toBe(5)
  })
})
