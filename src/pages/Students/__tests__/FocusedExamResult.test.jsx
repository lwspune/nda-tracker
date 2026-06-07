import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Stub the heavy per-question panel — its own rendering (QuestionCard + store +
// KaTeX) is tested via ExamHistoryTable; here we only verify FocusedExamResult's
// own logic (matching + summary + that it hands the matched exam to the panel).
vi.mock('../ExamHistoryTable', () => ({
  ExamIssuesPanel: ({ exam }) => <div data-testid="issues-panel">issues:{exam.id}</div>,
}))

import FocusedExamResult from '../FocusedExamResult'

const EXAM = {
  id:       'exam1',
  name:     'Maths Mock 3',
  date:     '2026-06-06',
  marking:  { correct: 4, wrong: -1 },
  questions: [{ q: 1 }, { q: 2 }, { q: 3 }],
  students: [{ name: 'Arjun', totalMarks: 8, correct: 2, incorrect: 1, notAttempted: 0, responses: {} }],
}

describe('FocusedExamResult', () => {
  it('renders nothing when examId is missing', () => {
    const { container } = render(<FocusedExamResult examId={null} exams={[EXAM]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when no exam matches the id', () => {
    const { container } = render(<FocusedExamResult examId="nope" exams={[EXAM]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the matched exam has no student row', () => {
    const { container } = render(
      <FocusedExamResult examId="exam1" exams={[{ ...EXAM, students: [] }]} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the exam name, score, and percentage for a matching exam', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    expect(screen.getByText('Maths Mock 3')).toBeInTheDocument()
    expect(screen.getByText('2026-06-06')).toBeInTheDocument()
    // 8 out of 3×4 = 12 → 67%
    expect(screen.getByText(/8/)).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
  })

  it('shows the correct / incorrect / skipped breakdown', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    expect(screen.getByText(/2 correct/)).toBeInTheDocument()
    expect(screen.getByText(/1 wrong/)).toBeInTheDocument()
    expect(screen.getByText(/0 skipped/)).toBeInTheDocument()
  })

  it('renders the per-exam issues panel for the matched exam', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    const panel = screen.getByTestId('issues-panel')
    expect(panel).toHaveTextContent('issues:exam1')
  })
})
