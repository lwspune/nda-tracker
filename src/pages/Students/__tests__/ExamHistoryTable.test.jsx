import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExamHistoryTable, { fmtMarks, getIssues } from '../ExamHistoryTable'

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

describe('ExamHistoryTable — click an exam to see the parent-facing report', () => {
  const scores = [{
    name: 'Mock Test 1', date: '2026-05-01', score: 40, max: 100, pct: 0.4,
    correct: 10, wrong: 5, na: 5,
    exam: {
      id: 'exam1', name: 'Mock Test 1', date: '2026-05-01',
      marking: { correct: 4, wrong: -1 },
      questions: [{ q: 1 }, { q: 2 }],
    },
    student: {
      totalMarks: 40, correct: 10, incorrect: 5, notAttempted: 5,
      responses: { 1: 1, 2: -1 }, choices: { 1: 'A', 2: 'B' },
    },
  }]

  it('reveals the parent WhatsApp report (score summary) when the exam name is clicked', () => {
    render(<ExamHistoryTable scores={scores} />)
    // Hidden until clicked
    expect(screen.queryByText(/Your Result/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Mock Test 1/i }))
    expect(screen.getByText(/Your Result/i)).toBeInTheDocument()
  })
})

// An offline exam has no questions[], so correct/wrong/skipped are structurally
// 0 AND the bracketed marks breakdown is 0 — the cell rendered "0 (0)", which
// claims both "nothing right" and "contributed no marks" for a paper the
// student actually scored on. This table is NOT superadmin-gated: it renders in
// the student portal, so parents saw it (2026-07-28).
describe('ExamHistoryTable — offline exams show — not zeros', () => {
  const offlineScores = [{
    name: 'Sets', date: '2026-07-27', score: 5, max: 5, pct: 1,
    correct: 0, wrong: 0, na: 0,
    exam: {
      id: 'exam_offline', name: 'Sets', date: '2026-07-27',
      marking: { correct: 1, wrong: 0 },
      questions: [],
      maxMarks: 5,
    },
    student: {
      totalMarks: 5, correct: 0, incorrect: 0, notAttempted: 0,
      responses: {}, choices: {},
    },
  }]

  const cellsOf = name =>
    [...screen.getByText(name).closest('tr').querySelectorAll('td')].map(td => td.textContent.trim())

  it('renders — in the correct / wrong / skipped columns', () => {
    render(<ExamHistoryTable scores={offlineScores} />)
    const cells = cellsOf('Sets')
    // [exam, date, score, ✅, ❌, ⬜, %, actions]
    expect(cells.slice(3, 6)).toEqual(['—', '—', '—'])
  })

  it('drops the bracketed marks breakdown entirely (not just the leading count)', () => {
    render(<ExamHistoryTable scores={offlineScores} />)
    expect(cellsOf('Sets').join(' ')).not.toContain('(0)')
  })

  it('still shows the score and the percentage, which ARE meaningful', () => {
    render(<ExamHistoryTable scores={offlineScores} />)
    const cells = cellsOf('Sets')
    expect(cells[2]).toBe('5 / 5')
    expect(cells[6]).toBe('100%')
  })

  it('labels the dashes for screen readers', () => {
    render(<ExamHistoryTable scores={offlineScores} />)
    const dashes = screen.getAllByTitle(/marks-only exam/i)
    expect(dashes).toHaveLength(3)
  })

  it('leaves an MCQ exam untouched (counts + bracketed marks still render)', () => {
    const mcqScores = [{
      name: 'Mock Test 1', date: '2026-05-01', score: 40, max: 100, pct: 0.4,
      correct: 10, wrong: 5, na: 5,
      exam: {
        id: 'exam1', name: 'Mock Test 1', date: '2026-05-01',
        marking: { correct: 4, wrong: -1 },
        questions: [{ q: 1 }, { q: 2 }],
      },
      student: {
        totalMarks: 40, correct: 10, incorrect: 5, notAttempted: 5,
        responses: { 1: 1, 2: -1 }, choices: { 1: 'A', 2: 'B' },
      },
    }]
    render(<ExamHistoryTable scores={mcqScores} />)
    const cells = cellsOf('Mock Test 1')
    expect(cells[3]).toContain('10')
    expect(cells[3]).toContain('(+40)')
    expect(cells[5]).toContain('(0)')
  })
})

// The Score column mixes paper sizes — a student's history routinely holds
// 30-question chapter tests (max 75) beside 120-question mocks (max 300). Read
// without a denominator the column's vertical ordering disagrees with actual
// performance: 114.19 (38% of 300) sits above 29.18 (39% of 75), and 70.85
// (24%) above that same 29.18. The raw number is the only value on the row that
// cannot be interpreted on its own (2026-07-28).
describe('ExamHistoryTable — Score carries its denominator', () => {
  function row({ name, score, max, pct, questions = [{ q: 1 }] }) {
    return {
      name, date: '2026-07-15', score, max, pct,
      correct: 3, wrong: 3, na: 24,
      exam: { id: name, name, date: '2026-07-15', marking: { correct: 2.5, wrong: -0.83 }, questions },
      student: { totalMarks: score, correct: 3, incorrect: 3, notAttempted: 24, responses: {}, choices: {} },
    }
  }

  const scoreCellOf = name =>
    screen.getByText(name).closest('tr').querySelectorAll('td')[2].textContent.trim()

  it('shows an MCQ score out of its derived paper max', () => {
    render(<ExamHistoryTable scores={[row({ name: 'Statistics (A)', score: 5.01, max: 75, pct: 0.0668 })]} />)
    expect(scoreCellOf('Statistics (A)')).toBe('5.01 / 75')
  })

  it('distinguishes two papers of different size in the same table', () => {
    render(<ExamHistoryTable scores={[
      row({ name: 'Matrics & Determinant (A)', score: 29.18,  max: 75,  pct: 0.389 }),
      row({ name: 'LWS MATHS MOCK 2 (A)',      score: 114.19, max: 300, pct: 0.3806 }),
    ]} />)
    // The smaller raw number is the better performance — only the denominator says so.
    expect(scoreCellOf('Matrics & Determinant (A)')).toBe('29.18 / 75')
    expect(scoreCellOf('LWS MATHS MOCK 2 (A)')).toBe('114.19 / 300')
  })

  it('shows an offline score out of its explicit max', () => {
    render(<ExamHistoryTable scores={[row({ name: 'Sets', score: 5, max: 5, pct: 1, questions: [] })]} />)
    expect(scoreCellOf('Sets')).toBe('5 / 5')
  })

  it('omits the denominator when the max is not derivable', () => {
    render(<ExamHistoryTable scores={[row({ name: 'Unknown', score: 12, max: 0, pct: 0 })]} />)
    expect(scoreCellOf('Unknown')).toBe('12')
  })
})
