import { describe, it, expect } from 'vitest'
import { fmtMarks, getIssues } from '../ExamHistoryTable'

describe('fmtMarks — bracketed marks suffix', () => {
  it('prefixes positive totals with +', () => {
    expect(fmtMarks(72)).toBe('+72')   // 18 correct × +4
    expect(fmtMarks(4)).toBe('+4')
  })

  it('keeps the sign on negative totals', () => {
    expect(fmtMarks(-2)).toBe('-2')    // 2 wrong × -1
    expect(fmtMarks(-53)).toBe('-53')
  })

  it('renders zero as "0" (no sign, no -0)', () => {
    expect(fmtMarks(0)).toBe('0')      // unattempted, or no-negative-marking wrong
    expect(fmtMarks(-0)).toBe('0')
  })

  it('strips float noise from non-integer marking schemes', () => {
    expect(fmtMarks(18 * 2.5)).toBe('+45')
    expect(fmtMarks(3 * -0.33)).toBe('-0.99')
  })
})

describe('getIssues — wrong/skipped vs all questions', () => {
  const exam = { questions: [{ q: 1 }, { q: 2 }, { q: 3 }, { q: 4 }] }
  // 1 correct, 2 wrong, 3 skipped, 4 has no response entry
  const student = { responses: { 1: 1, 2: -1, 3: 0 } }

  it('default returns only wrong (-1) and skipped (0) questions', () => {
    const issues = getIssues(exam, student)
    expect(issues.map(i => i.q.q)).toEqual([2, 3])
  })

  it('excludes correct answers from the default (issues-only) view', () => {
    expect(getIssues(exam, student).some(i => i.result === 1)).toBe(false)
  })

  it('includeAll returns every question, including correct ones', () => {
    const all = getIssues(exam, student, true)
    expect(all.map(i => i.q.q)).toEqual([1, 2, 3, 4])
    expect(all.find(i => i.q.q === 1).result).toBe(1)
  })

  it('attaches the chosen option from student.choices (null for skipped / absent)', () => {
    const st = { responses: { 1: 1, 2: -1, 3: 0 }, choices: { 1: 'A', 2: 'C', 3: null } }
    const all = getIssues(exam, st, true)
    expect(all.find(i => i.q.q === 1).studentAnswer).toBe('A')   // correct pick
    expect(all.find(i => i.q.q === 2).studentAnswer).toBe('C')   // wrong pick
    expect(all.find(i => i.q.q === 3).studentAnswer).toBeNull()  // skipped
    expect(all.find(i => i.q.q === 4).studentAnswer).toBeNull()  // no choice entry
  })

  it('studentAnswer is null when the exam predates choice capture (no choices map)', () => {
    expect(getIssues(exam, student).every(i => i.studentAnswer === null)).toBe(true)
  })
})
