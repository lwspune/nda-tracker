import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  getQuizAttempts: vi.fn(),
  studentProfiles: {},
}
vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import QuizResults from '../QuizResults'

const QUIZ = {
  id: 'qz1',
  title: 'Vectors Quiz',
  status: 'published',
  closesAt: '2999-01-01T00:00:00Z',
  marking: { correct: 1, wrong: 0 },
  questions: [
    { q: 1, chapter: 'Vectors', question: 'Q one?', optionA: 'a1', optionB: 'b1', optionC: 'c1', optionD: 'd1', answer: 'A' },
    { q: 2, chapter: 'Vectors', question: 'Q two?', optionA: 'a2', optionB: 'b2', optionC: 'c2', optionD: 'd2', answer: 'B' },
  ],
}

const ATTEMPTS = [
  { lwsId: 'L1', studentName: 'Tejas Jadhav', correct: 2, score: 2, submittedAt: '2026-06-07T15:00:00Z', answers: { 1: 'A', 2: 'B' } },
  { lwsId: 'L2', studentName: 'Rudra Pandey', correct: 1, score: 1, submittedAt: '2026-06-07T15:05:00Z', answers: { 1: 'A', 2: 'C' } },
]

const PROFILES = {
  'Tejas Jadhav': { name: 'Tejas Jadhav', lwsId: 'L1', branch: 'APJ', batches: ['APJ_NDA_12th_(26-27)'], accountStatus: 'Active' },
  'Rudra Pandey': { name: 'Rudra Pandey', lwsId: 'L2', branch: 'LWS Pune', batches: ['LWS_NDA_2Y_(26-28)_A'], accountStatus: 'Active' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.getQuizAttempts.mockResolvedValue(ATTEMPTS)
})

describe('QuizResults', () => {
  it('shows branch and batch columns for attempted students', async () => {
    render(<QuizResults quiz={QUIZ} onBack={vi.fn()} />)
    expect(await screen.findByText('Tejas Jadhav')).toBeInTheDocument()
    expect(screen.getByText('APJ')).toBeInTheDocument()
    expect(screen.getByText('APJ_NDA_12th_(26-27)')).toBeInTheDocument()
    expect(screen.getByText('LWS Pune')).toBeInTheDocument()
    expect(screen.getByText('LWS_NDA_2Y_(26-28)_A')).toBeInTheDocument()
  })

  it('expands a question to reveal options, the correct one, and the pick distribution', async () => {
    render(<QuizResults quiz={QUIZ} onBack={vi.fn()} />)
    const row = await screen.findByText(/Q1 · Vectors/)
    fireEvent.click(row)
    // Option text now visible
    expect(await screen.findByText('a1')).toBeInTheDocument()
    expect(screen.getByText('b1')).toBeInTheDocument()
    // Correct option flagged
    expect(screen.getByText('CORRECT')).toBeInTheDocument()
    // Both attempts chose A on Q1 → 100% (2)
    expect(screen.getByText(/100% \(2\)/)).toBeInTheDocument()
  })

  it('collapses other rows — only one question open at a time', async () => {
    render(<QuizResults quiz={QUIZ} onBack={vi.fn()} />)
    fireEvent.click(await screen.findByText(/Q1 · Vectors/))
    expect(await screen.findByText('a1')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Q2 · Vectors/))
    // Q1's options gone, Q2's shown
    expect(screen.queryByText('a1')).not.toBeInTheDocument()
    expect(screen.getByText('a2')).toBeInTheDocument()
  })
})
