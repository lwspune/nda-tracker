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
