import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import QuestionCard from '../QuestionCard'

// QuestionCard pulls updateQuestion from the store, the mode, and renders KaTeX —
// stub all three so we can unit-test the choice-highlighting logic in isolation.
vi.mock('../../../store/useStore', () => ({ default: sel => sel({ updateQuestion: vi.fn() }) }))
vi.mock('../../../context/ModeContext', () => ({ useMode: () => 'student' }))
vi.mock('../Math', () => ({ Math: ({ children }) => <span>{children}</span> }))

const Q = {
  q: 5, chapter: 'Algebra', subtopic: 'Quadratics', question: 'What is x?',
  optionA: 'one', optionB: 'two', optionC: 'three', optionD: 'four', answer: 'C',
}

describe('QuestionCard — student choice highlighting', () => {
  it('shows the "Marked vs Correct" banner when a wrong choice is captured', () => {
    render(<QuestionCard q={Q} examId="e1" studentAnswer="B" studentResult={-1} />)
    expect(screen.getByText('Marked:')).toBeInTheDocument()
    expect(screen.getByText('Correct:')).toBeInTheDocument()
  })

  it('omits the banner when no choice was captured (older upload → null)', () => {
    render(<QuestionCard q={Q} examId="e1" studentAnswer={null} studentResult={-1} />)
    expect(screen.queryByText('Marked:')).not.toBeInTheDocument()
  })

  it('does not show the banner for a correct answer (only flags wrong picks)', () => {
    render(<QuestionCard q={Q} examId="e1" studentAnswer="C" studentResult={1} />)
    expect(screen.queryByText('Marked:')).not.toBeInTheDocument()
  })
})

describe('QuestionCard — remediation links', () => {
  it('renders Learn this / Practice when showRemediation is set', () => {
    render(<QuestionCard q={Q} examId="e1" studentAnswer="B" studentResult={-1} showRemediation />)
    expect(screen.getByText(/Learn this/)).toBeInTheDocument()
    expect(screen.getByText(/Practice/)).toBeInTheDocument()
  })

  it('hides them by default (showRemediation off)', () => {
    render(<QuestionCard q={Q} examId="e1" studentAnswer="B" studentResult={-1} />)
    expect(screen.queryByText(/Learn this/)).not.toBeInTheDocument()
  })
})

// A card can be rendered for a QUESTION rather than for one student's attempt —
// the teacher cohort panel already did (studentResult={null}), and Question
// Stats does. The pill defaulted to "Unknown", which is not a result, it is the
// absence of one.
describe('QuestionCard — no student attached', () => {
  const q = {
    q: 1, chapter: 'Vectors', subtopic: 'Dot', question: 'find a dot b',
    optionA: 'p', optionB: 'q', optionC: 'r', optionD: 's', answer: 'B',
    solution: 'because',
  }

  it('shows no result pill when no student result is given', () => {
    render(<QuestionCard q={q} />)
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    expect(screen.queryByText('Correct')).not.toBeInTheDocument()
  })

  it('shows no result pill for an explicit null', () => {
    render(<QuestionCard q={q} studentResult={null} />)
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('still shows the pill when a real result is given', () => {
    render(<QuestionCard q={q} studentResult={1} />)
    expect(screen.getByText('Correct')).toBeInTheDocument()
  })

  it('still shows the options and the key', () => {
    render(<QuestionCard q={q} />)
    expect(screen.getByText('p')).toBeInTheDocument()
    expect(screen.getByText('q')).toBeInTheDocument()
  })
})
