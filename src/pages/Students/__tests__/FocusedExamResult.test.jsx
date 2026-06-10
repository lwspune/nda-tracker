import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// Stub the heavy QuestionCard (store + KaTeX) — its own rendering is tested via
// QuestionCard.test / ExamHistoryTable. Here we only verify FocusedExamResult's
// own logic (matching + summary) and the simple per-question table it renders.
// Mocking QuestionCard also keeps `getIssues` (imported from ExamHistoryTable,
// which imports QuestionCard) free of heavy deps.
vi.mock('../../../components/ui/QuestionCard', () => ({
  default: ({ q, studentAnswer, studentResult }) => (
    <div data-testid="qcard">qcard:{q.q}:{String(studentAnswer)}:{String(studentResult)}</div>
  ),
}))

import FocusedExamResult from '../FocusedExamResult'

// Q1 correct (chose B), Q2 wrong (chose A, correct C), Q3 skipped (correct D).
const EXAM = {
  id:       'exam1',
  name:     'Maths Mock 3',
  date:     '2026-06-06',
  marking:  { correct: 4, wrong: -1 },
  questions: [
    { q: 1, question: '1+1?', optionA: '1', optionB: '2', answer: 'B' },
    { q: 2, question: '2+2?', answer: 'C' },
    { q: 3, question: '3+3?', answer: 'D' },
  ],
  students: [{
    name: 'Arjun', totalMarks: 8, correct: 1, incorrect: 1, notAttempted: 1,
    responses: { 1: 1, 2: -1, 3: 0 },
    choices:   { 1: 'B', 2: 'A', 3: null },
  }],
}

const rowOf = qLabel => screen.getByText(qLabel).closest('tr')

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
    expect(screen.getByText(/8/)).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument() // 8 / (3×4) = 67%
  })

  it('shows the correct / incorrect / skipped breakdown', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    expect(screen.getByText(/1 correct/)).toBeInTheDocument()
    expect(screen.getByText(/1 wrong/)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument()
  })

  it('defaults to ALL questions, in sequence (Q1, Q2, Q3)', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.getByText('Q3')).toBeInTheDocument()
    // Default view is "all"; toggle offers the narrowed view.
    expect(screen.getByRole('button', { name: /show only wrong & skipped/i })).toBeInTheDocument()
  })

  it('shows the chosen letter and correct letter per row', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    // Q2: chose A, correct C
    const q2 = rowOf('Q2')
    expect(within(q2).getByText('A')).toBeInTheDocument()
    expect(within(q2).getByText('C')).toBeInTheDocument()
  })

  it('shows — for a skipped question (no chosen letter)', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    const q3 = rowOf('Q3')
    expect(within(q3).getByText('—')).toBeInTheDocument() // your answer
    expect(within(q3).getByText('D')).toBeInTheDocument()  // correct answer
  })

  it('degrades to — when the exam has no captured choices (older exams)', () => {
    const noChoices = {
      ...EXAM,
      students: [{ ...EXAM.students[0], choices: undefined }],
    }
    render(<FocusedExamResult examId="exam1" exams={[noChoices]} />)
    // Every "Your answer" cell falls back to — (3 rows), no crash.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('narrows to wrong + skipped only when toggled (Q1 correct drops out)', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    fireEvent.click(screen.getByRole('button', { name: /show only wrong & skipped/i }))
    expect(screen.queryByText('Q1')).not.toBeInTheDocument()
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.getByText('Q3')).toBeInTheDocument()
    // Label flips back
    expect(screen.getByRole('button', { name: /show all questions/i })).toBeInTheDocument()
  })

  it('expands the full QuestionCard when "Show question" is clicked', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    const q2 = rowOf('Q2')
    fireEvent.click(within(q2).getByRole('button', { name: /show question 2/i }))
    const card = screen.getByTestId('qcard')
    expect(card).toHaveTextContent('qcard:2:A:-1') // q, chosen letter, result threaded through
  })

  it('single-open: opening one question collapses the previous', () => {
    render(<FocusedExamResult examId="exam1" exams={[EXAM]} />)
    fireEvent.click(within(rowOf('Q1')).getByRole('button', { name: /show question 1/i }))
    expect(screen.getByTestId('qcard')).toHaveTextContent('qcard:1')
    fireEvent.click(within(rowOf('Q2')).getByRole('button', { name: /show question 2/i }))
    const cards = screen.getAllByTestId('qcard')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('qcard:2')
  })

  it('disables the show-question button when the question has no text/options', () => {
    const bare = {
      ...EXAM,
      questions: [{ q: 1, answer: 'B' }], // no question text, no options
      students: [{ ...EXAM.students[0], responses: { 1: -1 }, choices: { 1: 'A' } }],
    }
    render(<FocusedExamResult examId="exam1" exams={[bare]} />)
    expect(screen.getByRole('button', { name: /show question 1/i })).toBeDisabled()
  })

  it('shows a graceful notice for an offline exam (no questions)', () => {
    const offline = {
      ...EXAM,
      questions: [],
      students: [{ ...EXAM.students[0], responses: {}, choices: {} }],
    }
    render(<FocusedExamResult examId="exam1" exams={[offline]} />)
    expect(screen.getByText(/per-question breakdown isn't available/i)).toBeInTheDocument()
  })
})
