import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import QuizLinkPage from '../QuizLinkPage'
import { SESSION_KEY } from '../../../config'

const OPEN_QUIZ = {
  id: 'q-a', state: 'open', title: 'Daily 1', subject: 'Maths',
  marking: { correct: 1, wrong: 0 }, closesAt: null,
  questions: [{ q: 1, question: 'A?', optionA: '1', optionB: '2', optionC: '3', optionD: '4' }],
}

function mockFetch(payload, ok = true) {
  const fn = vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(payload) })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('QuizLinkPage', () => {
  it('shows the mobile entry when no number is remembered', () => {
    render(<QuizLinkPage quizId="q-a" />)
    expect(screen.getByText(/Enter your mobile to start/i)).toBeInTheDocument()
  })

  it('loads the quiz and shows the taker after entering a mobile', async () => {
    mockFetch({ name: 'Arjun', quizzes: [OPEN_QUIZ] })
    render(<QuizLinkPage quizId="q-a" />)
    fireEvent.change(screen.getByPlaceholderText(/10-digit mobile/i), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByText('Start'))
    await waitFor(() => expect(screen.getByText('Daily 1')).toBeInTheDocument())
    expect(screen.getByText(/Submit quiz/i)).toBeInTheDocument()
    expect(localStorage.getItem('nda_quiz_mobile')).toBe('9876543210')
  })

  it('auto-loads using a remembered mobile from the student session', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mobile: '9876543210', expiry: Date.now() + 1e7 }))
    mockFetch({ name: 'Arjun', quizzes: [OPEN_QUIZ] })
    render(<QuizLinkPage quizId="q-a" />)
    await waitFor(() => expect(screen.getByText(/Submit quiz/i)).toBeInTheDocument())
  })

  it('shows "not available" when the quiz is not in the student list', async () => {
    mockFetch({ name: 'Arjun', quizzes: [] })
    render(<QuizLinkPage quizId="q-a" />)
    fireEvent.change(screen.getByPlaceholderText(/10-digit mobile/i), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByText('Start'))
    await waitFor(() => expect(screen.getByText(/isn't available/i)).toBeInTheDocument())
  })

  it('renders review directly for an already-submitted quiz', async () => {
    const done = {
      ...OPEN_QUIZ, state: 'done',
      questions: [{ q: 1, question: 'A?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', answer: 'A' }],
      myAnswers: { 1: 'A' },
      result: { score: 1, correct: 1, incorrect: 0, notAttempted: 0 },
    }
    mockFetch({ name: 'Arjun', quizzes: [done] })
    render(<QuizLinkPage quizId="q-a" />)
    fireEvent.change(screen.getByPlaceholderText(/10-digit mobile/i), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByText('Start'))
    await waitFor(() => expect(screen.getByText(/Open my full dashboard/i)).toBeInTheDocument())
    expect(screen.getByText('CORRECT')).toBeInTheDocument()
  })

  it('shows an error and keeps the mobile entry on an unknown number', async () => {
    mockFetch({ error: 'Mobile number not found.' }, false)
    render(<QuizLinkPage quizId="q-a" />)
    fireEvent.change(screen.getByPlaceholderText(/10-digit mobile/i), { target: { value: '9999999999' } })
    fireEvent.click(screen.getByText('Start'))
    await waitFor(() => expect(screen.getByText(/Mobile number not found/i)).toBeInTheDocument())
    expect(screen.getByText(/Enter your mobile to start/i)).toBeInTheDocument()
  })

  it('validates the mobile length before calling the API', () => {
    const fn = mockFetch({ quizzes: [] })
    render(<QuizLinkPage quizId="q-a" />)
    fireEvent.change(screen.getByPlaceholderText(/10-digit mobile/i), { target: { value: '12345' } })
    fireEvent.click(screen.getByText('Start'))
    expect(screen.getByText(/valid 10-digit mobile/i)).toBeInTheDocument()
    expect(fn).not.toHaveBeenCalled()
  })
})
