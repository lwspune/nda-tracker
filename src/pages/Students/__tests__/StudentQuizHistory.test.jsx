import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  getQuizAttemptsForStudent: vi.fn(),
  quizzes: [],
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import StudentQuizHistory from '../StudentQuizHistory'

// n attempts, one per quiz, submitted on consecutive days. Quiz i is "Quiz i";
// the highest i is the newest. Each quiz has 10 questions.
function seed(n, correctFor = () => 10) {
  mockStore.quizzes = Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    title: `Quiz ${i + 1}`,
    questions: Array.from({ length: 10 }, () => ({})),
  }))
  const attempts = Array.from({ length: n }, (_, i) => ({
    quizId: `q${i + 1}`,
    score: correctFor(i + 1),
    correct: correctFor(i + 1),
    submittedAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00+00:00`,
  }))
  mockStore.getQuizAttemptsForStudent.mockResolvedValue(attempts)
}

const toggle = () => screen.getByRole('button', { name: /daily quiz history/i })
const rowTitles = () => screen.queryAllByTestId('quiz-row').map(r => r.querySelector('[data-title]').textContent)

async function renderExpanded(n, props = {}) {
  seed(n)
  const utils = render(<StudentQuizHistory lwsId="LWS-001" {...props} />)
  await waitFor(() => toggle())
  fireEvent.click(toggle())
  return utils
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.quizzes = []
})

describe('StudentQuizHistory', () => {
  it('renders nothing when the student has no attempts', async () => {
    mockStore.getQuizAttemptsForStudent.mockResolvedValue([])
    const { container } = render(<StudentQuizHistory lwsId="LWS-001" />)
    await waitFor(() => expect(mockStore.getQuizAttemptsForStudent).toHaveBeenCalledWith('LWS-001'))
    expect(container.firstChild).toBeNull()
  })

  it('starts collapsed, with the count and average still in the header', async () => {
    seed(7)
    render(<StudentQuizHistory lwsId="LWS-001" />)
    await waitFor(() => toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveTextContent('(7)')
    expect(screen.getByText(/avg 100% correct/i)).toBeInTheDocument()
    expect(screen.queryAllByTestId('quiz-row')).toHaveLength(0)
  })

  it('expanding shows the five newest attempts, newest first', async () => {
    await renderExpanded(7)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(rowTitles()).toEqual(['Quiz 7', 'Quiz 6', 'Quiz 5', 'Quiz 4', 'Quiz 3'])
  })

  it('collapsing again hides the rows', async () => {
    await renderExpanded(3)
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId('quiz-row')).toHaveLength(0)
  })

  it('pages through the attempts with Prev / Next', async () => {
    await renderExpanded(12)
    const prev = screen.getByRole('button', { name: /prev/i })
    const next = screen.getByRole('button', { name: /next/i })
    expect(prev).toBeDisabled()
    expect(screen.getByText('Showing 1–5 of 12')).toBeInTheDocument()

    fireEvent.click(next)
    expect(rowTitles()).toEqual(['Quiz 7', 'Quiz 6', 'Quiz 5', 'Quiz 4', 'Quiz 3'])
    expect(screen.getByText('Showing 6–10 of 12')).toBeInTheDocument()

    fireEvent.click(next)
    expect(rowTitles()).toEqual(['Quiz 2', 'Quiz 1'])
    expect(screen.getByText('Showing 11–12 of 12')).toBeInTheDocument()
    expect(next).toBeDisabled()

    fireEvent.click(prev)
    expect(screen.getByText('Showing 6–10 of 12')).toBeInTheDocument()
  })

  it('shows no pager when every attempt fits on one page', async () => {
    await renderExpanded(5)
    expect(rowTitles()).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /prev/i })).toBeNull()
  })

  it('averages over every attempt, not just the visible page', async () => {
    // Quizzes 1-6 scored 0/10; 7-12 scored 10/10. Page 1 alone would read 100%.
    seed(12, i => (i > 6 ? 10 : 0))
    render(<StudentQuizHistory lwsId="LWS-001" />)
    await waitFor(() => toggle())
    fireEvent.click(toggle())
    expect(screen.getByText(/avg 50% correct/i)).toBeInTheDocument()
  })

  it('dates each attempt in IST, so the order is legible', async () => {
    mockStore.quizzes = [{ id: 'q1', title: 'Quiz 1', questions: [{}] }]
    // 20:00 UTC on the 12th is 01:30 IST on the 13th — the day the student sat it.
    mockStore.getQuizAttemptsForStudent.mockResolvedValue([
      { quizId: 'q1', score: 1, correct: 1, submittedAt: '2026-06-12T20:00:00+00:00' },
    ])
    render(<StudentQuizHistory lwsId="LWS-001" />)
    await waitFor(() => toggle())
    fireEvent.click(toggle())
    expect(screen.getByTestId('quiz-row')).toHaveTextContent('13 Jun 2026')
  })

  it('returns to the first page when a different student is shown', async () => {
    const { rerender } = await renderExpanded(12)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Showing 11–12 of 12')).toBeInTheDocument()

    seed(8)
    rerender(<StudentQuizHistory lwsId="LWS-002" />)
    await waitFor(() => expect(screen.getByText('Showing 1–5 of 8')).toBeInTheDocument())
    expect(rowTitles()).toEqual(['Quiz 8', 'Quiz 7', 'Quiz 6', 'Quiz 5', 'Quiz 4'])
  })
})
