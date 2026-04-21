import { describe, it, expect } from 'vitest'
import { computeStudentChapterStats } from '../analytics'
import { computeWrongAudit, computeSkippedAudit } from '../analytics'

// ── Fixture helpers ───────────────────────────────────────────

function makeGATExam(students) {
  return {
    id: 'gat-1',
    name: 'NDA GAT MOCK 1',
    date: '2026-03-26',
    subject: 'GAT',
    marking: { correct: 4, wrong: -1 },
    questions: [
      { q: 1, subject: 'English',  chapter: 'Error Spotting', subtopic: 'General' },
      { q: 2, subject: 'English',  chapter: 'Error Spotting', subtopic: 'General' },
      { q: 3, subject: 'Physics',  chapter: 'Mechanics',      subtopic: 'General' },
      { q: 4, subject: 'Physics',  chapter: 'Mechanics',      subtopic: 'General' },
      { q: 5, subject: 'Geography', chapter: 'Physical Geography', subtopic: 'General' },
    ],
    students,
  }
}

function makeStudent(responses) {
  return { name: 'Alice', totalMarks: 8, correct: 2, incorrect: 1, notAttempted: 2, responses }
}

// ── computeStudentChapterStats with qSubject ──────────────────

describe('computeStudentChapterStats — qSubject filtering for GAT exams', () => {
  const student = makeStudent({ 1: 1, 2: -1, 3: 1, 4: 0, 5: -1 })
  const exam = makeGATExam([student])

  it('without qSubject: all questions counted across all subjects', () => {
    const stats = computeStudentChapterStats('Alice', [exam])
    expect(stats['Error Spotting']).toBeDefined()      // English
    expect(stats['Mechanics']).toBeDefined()            // Physics
    expect(stats['Physical Geography']).toBeDefined()  // Geography
  })

  it('with qSubject=English: only English questions counted', () => {
    const stats = computeStudentChapterStats('Alice', [exam], 'English')
    expect(stats['Error Spotting']).toBeDefined()
    expect(stats['Mechanics']).toBeUndefined()
    expect(stats['Physical Geography']).toBeUndefined()
  })

  it('with qSubject=Physics: only Physics questions counted', () => {
    const stats = computeStudentChapterStats('Alice', [exam], 'Physics')
    expect(stats['Mechanics']).toBeDefined()
    expect(stats['Error Spotting']).toBeUndefined()
  })

  it('correct/wrong counts match the filtered questions only', () => {
    // Q1=correct, Q2=wrong for English
    const stats = computeStudentChapterStats('Alice', [exam], 'English')
    const sub = stats['Error Spotting']['General']
    expect(sub.correct).toBe(1)
    expect(sub.wrong).toBe(1)
    expect(sub.skipped).toBe(0)
    expect(sub.total).toBe(2)
  })

  it('skipped (resp=0) question counted correctly for Physics filter', () => {
    // Q3=correct, Q4=skipped for Physics
    const stats = computeStudentChapterStats('Alice', [exam], 'Physics')
    const sub = stats['Mechanics']['General']
    expect(sub.correct).toBe(1)
    expect(sub.skipped).toBe(1)
    expect(sub.total).toBe(2)
  })

  it('questions with no q.subject are always included regardless of qSubject', () => {
    // Non-GAT exam: questions have no subject field
    const mathExam = {
      id: 'maths-1',
      name: 'Maths Test',
      date: '2026-01-01',
      subject: 'Maths',
      marking: { correct: 4, wrong: -1 },
      questions: [
        { q: 1, subject: null, chapter: 'Algebra', subtopic: 'General' },
      ],
      students: [makeStudent({ 1: 1 })],
    }
    const stats = computeStudentChapterStats('Alice', [mathExam], 'English')
    // q.subject is null → always included even when qSubject = 'English'
    expect(stats['Algebra']).toBeDefined()
  })
})

// ── computeWrongAudit & computeSkippedAudit pass-through ─────

describe('computeWrongAudit with qSubject', () => {
  const student = makeStudent({ 1: -1, 2: -1, 3: -1, 4: 0, 5: 0 })
  const exam = makeGATExam([student])

  it('without qSubject: returns wrong answers across all subjects', () => {
    const audit = computeWrongAudit('Alice', [exam])
    const chapters = audit.map(a => a.chapter)
    expect(chapters).toContain('Error Spotting')
    expect(chapters).toContain('Mechanics')
  })

  it('with qSubject=English: only English wrong answers returned', () => {
    const audit = computeWrongAudit('Alice', [exam], 'English')
    const chapters = audit.map(a => a.chapter)
    expect(chapters).toContain('Error Spotting')
    expect(chapters).not.toContain('Mechanics')
  })
})

describe('computeSkippedAudit with qSubject', () => {
  const student = makeStudent({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 })
  const exam = makeGATExam([student])

  it('with qSubject=Physics: only Physics skipped questions returned', () => {
    const audit = computeSkippedAudit('Alice', [exam], 'Physics')
    expect(audit.every(a => a.chapter === 'Mechanics')).toBe(true)
    expect(audit.find(a => a.chapter === 'Error Spotting')).toBeUndefined()
  })
})
