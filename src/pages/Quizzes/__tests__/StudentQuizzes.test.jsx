import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The review screen is not under test here — only that the list comes back
// where the student left it.
vi.mock('../quizTaking', () => ({
  QuizTaker: () => null,
  QuizReview: ({ title, onBack }) => (
    <div>
      <div>Reviewing {title}</div>
      <button onClick={onBack}>← Back</button>
    </div>
  ),
}))

import StudentQuizzes from '../StudentQuizzes'

function doneQuiz(i, correct = 10) {
  return {
    id: `d${i}`, title: `Done ${i}`, subject: 'Maths', state: 'done',
    questions: Array.from({ length: 10 }, () => ({})),
    myAnswers: {},
    result: {
      score: correct, correct, incorrect: 10 - correct, notAttempted: 0,
      submittedAt: `2026-06-${String(i).padStart(2, '0')}T10:00:00+00:00`,
    },
  }
}

function openQuiz(i) {
  return {
    id: `o${i}`, title: `Open ${i}`, subject: 'Maths', state: 'open',
    questions: Array.from({ length: 5 }, () => ({})), closesAt: null,
  }
}

// The API returns quizzes in database order, not by date — shuffle so the
// tests prove the component sorts rather than trusting arrival order.
function shuffled(list) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function serve(quizzes) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ quizzes }),
  }))
}

const toggle = () => screen.getByRole('button', { name: /completed/i })
const doneTitles = () => screen.queryAllByTestId('done-quiz').map(c => c.querySelector('[data-title]').textContent)

async function renderWith(quizzes) {
  serve(quizzes)
  const utils = render(<StudentQuizzes mobile="9999999999" />)
  await waitFor(() => expect(screen.getByText(/daily quiz/i)).toBeInTheDocument())
  return utils
}

const doneSet = n => shuffled(Array.from({ length: n }, (_, i) => doneQuiz(i + 1)))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('StudentQuizzes', () => {
  it('shows open quizzes without any click', async () => {
    await renderWith([openQuiz(1), openQuiz(2), ...doneSet(3)])
    expect(screen.getByText('Open 1')).toBeInTheDocument()
    expect(screen.getByText('Open 2')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(2)
  })

  it('starts with completed quizzes collapsed, count and average in the header', async () => {
    await renderWith([openQuiz(1), ...doneSet(7)])
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveTextContent('(7)')
    expect(toggle()).toHaveTextContent(/avg 100% correct/i)
    expect(screen.queryAllByTestId('done-quiz')).toHaveLength(0)
  })

  it('expanding shows the five most recently submitted, newest first', async () => {
    await renderWith(doneSet(7))
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(doneTitles()).toEqual(['Done 7', 'Done 6', 'Done 5', 'Done 4', 'Done 3'])
  })

  it('collapsing again hides the completed quizzes', async () => {
    await renderWith(doneSet(3))
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId('done-quiz')).toHaveLength(0)
  })

  it('pages through completed quizzes with Prev / Next', async () => {
    await renderWith(doneSet(12))
    fireEvent.click(toggle())
    const prev = screen.getByRole('button', { name: /prev/i })
    const next = screen.getByRole('button', { name: /next/i })
    expect(prev).toBeDisabled()
    expect(screen.getByText('Showing 1–5 of 12')).toBeInTheDocument()

    fireEvent.click(next)
    expect(doneTitles()).toEqual(['Done 7', 'Done 6', 'Done 5', 'Done 4', 'Done 3'])

    fireEvent.click(next)
    expect(doneTitles()).toEqual(['Done 2', 'Done 1'])
    expect(screen.getByText('Showing 11–12 of 12')).toBeInTheDocument()
    expect(next).toBeDisabled()

    fireEvent.click(prev)
    expect(screen.getByText('Showing 6–10 of 12')).toBeInTheDocument()
  })

  it('shows no pager when every completed quiz fits on one page', async () => {
    await renderWith(doneSet(5))
    fireEvent.click(toggle())
    expect(doneTitles()).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
  })

  it('averages over every completed quiz, not just the visible page', async () => {
    // 1-6 scored 0/10, 7-12 scored 10/10. Page 1 alone would read 100%.
    const quizzes = Array.from({ length: 12 }, (_, i) => doneQuiz(i + 1, i + 1 > 6 ? 10 : 0))
    await renderWith(shuffled(quizzes))
    expect(toggle()).toHaveTextContent(/avg 50% correct/i)
  })

  it('returns to the same page, still expanded, after a review', async () => {
    await renderWith(doneSet(12))
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(doneTitles()[0]).toBe('Done 7')

    fireEvent.click(screen.getByRole('button', { name: 'Review Done 7' }))
    expect(screen.getByText('Reviewing Done 7')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Showing 6–10 of 12')).toBeInTheDocument()
  })

  it('has no completed toggle when nothing has been submitted', async () => {
    await renderWith([openQuiz(1)])
    expect(screen.queryByRole('button', { name: /completed/i })).toBeNull()
  })
})
