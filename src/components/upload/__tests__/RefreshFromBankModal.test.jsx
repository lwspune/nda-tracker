import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = { replaceExam: vi.fn() }
vi.mock('../../../store/useStore', () => ({ default: (selector) => selector(mockStore) }))

const mockFetchBank = vi.fn()
vi.mock('../../../lib/bankFetch', async (orig) => ({
  ...(await orig()),
  fetchBankQuestions: (...a) => mockFetchBank(...a),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } } }) } },
}))

import RefreshFromBankModal from '../RefreshFromBankModal'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

function makeExam(over = {}) {
  return {
    id: 'exam-1', name: 'NDA Mock 7', date: '2026-09-01', subject: 'Maths',
    questions: [
      { q: 1, questionId: ID1, chapter: 'Vectors', question: 'stem 1', answer: 'B' },
      { q: 2, questionId: ID2, chapter: 'Vectors', question: 'stem 2', answer: 'C' },
    ],
    students: [{ name: 'A', totalMarks: 4 }],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchBank.mockResolvedValue({ byId: {}, missing: [] })
})

describe('RefreshFromBankModal — filling gaps', () => {
  it('reports what it filled and saves it', async () => {
    mockFetchBank.mockResolvedValue({
      byId: { [ID1]: { questionId: ID1, imageUrl: 'https://bank/d.png' } }, missing: [],
    })
    const user = userEvent.setup()
    render(<RefreshFromBankModal exam={makeExam()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/1 field/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /apply/i }))

    const [, saved] = mockStore.replaceExam.mock.calls[0]
    expect(saved.questions[0].imageUrl).toBe('https://bank/d.png')
    expect(saved.students).toEqual(makeExam().students)   // results untouched
  })
})

describe('RefreshFromBankModal — the count must never stand alone', () => {
  // A bare "236 fields to fill" is what let 236 empty containers pass for a
  // find. Naming the fields makes that impossible to miss again.
  it('names which fields it would fill, not just how many', async () => {
    mockFetchBank.mockResolvedValue({
      byId: {
        [ID1]: { questionId: ID1, imageUrl: 'https://bank/a.png' },
        [ID2]: { questionId: ID2, imageUrl: 'https://bank/b.png', solution: 'worked' },
      },
      missing: [],
    })
    render(<RefreshFromBankModal exam={makeExam()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/3 fields/i)).toBeInTheDocument())
    expect(screen.getByText(/imageUrl/)).toBeInTheDocument()
    expect(screen.getByText(/solution/)).toBeInTheDocument()
  })
})

describe('RefreshFromBankModal — what it refuses to do quietly', () => {
  it('applies the fill but NOT the differing stem, in the same pass', async () => {
    // both at once, so this proves selectivity rather than mere inaction
    mockFetchBank.mockResolvedValue({
      byId: { [ID1]: { questionId: ID1, question: 'REPAIRED STEM', imageUrl: 'https://bank/d.png' } },
      missing: [],
    })
    const user = userEvent.setup()
    render(<RefreshFromBankModal exam={makeExam()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/differs/i)).toBeInTheDocument())
    expect(screen.getByText(/REPAIRED STEM/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /apply/i }))
    const [, saved] = mockStore.replaceExam.mock.calls[0]
    expect(saved.questions[0].imageUrl).toBe('https://bank/d.png')  // gap filled
    expect(saved.questions[0].question).toBe('stem 1')              // what the student sat
  })

  it('disables Apply when there is nothing to fill', async () => {
    mockFetchBank.mockResolvedValue({
      byId: { [ID1]: { questionId: ID1, question: 'REPAIRED STEM' } }, missing: [],
    })
    render(<RefreshFromBankModal exam={makeExam()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/differs/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
  })

  it('never says a missing question was REPAIRED — two causes, indistinguishable', async () => {
    mockFetchBank.mockResolvedValue({ byId: {}, missing: [ID1, ID2] })
    render(<RefreshFromBankModal exam={makeExam()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/not available from the bank/i)).toBeInTheDocument())
    expect(screen.queryByText(/repaired/i)).not.toBeInTheDocument()
  })

  it('surfaces an unreachable bank as an error, not as "nothing to update"', async () => {
    mockFetchBank.mockRejectedValue(new Error('PYQ Vault returned 401'))
    render(<RefreshFromBankModal exam={makeExam()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/PYQ Vault returned 401/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument()
  })

  it('says so plainly when the exam has no bank ids at all', async () => {
    render(<RefreshFromBankModal exam={makeExam({ questions: [{ q: 1 }] })} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/no bank ids/i)).toBeInTheDocument())
    expect(mockFetchBank).not.toHaveBeenCalled()
  })
})
