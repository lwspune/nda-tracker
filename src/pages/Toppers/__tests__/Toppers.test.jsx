// Verifies the batch filter is student-centric (current members), not exam-roster.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Freq covers the chapters the fixtures use so each attendee projects well above
// the page's default projected-marks floor — isolates the batch/subject filtering
// under test from the threshold gate.
const mockStore = {
  exams: [],
  ndaFreqBySubject: {
    Maths: [{ chapter: 'Algebra', pct: 100 }],
    GAT:   [{ chapter: 'GK',      pct: 100 }],
  },
  ndaMarksBySubject: { Maths: 300, GAT: 300 },
  studentProfiles: {},
  setActiveStudent: vi.fn(),
}
vi.mock('../../../store/useStore', () => ({ default: (selector) => selector(mockStore) }))
vi.mock('../../../context/ModeContext', () => ({ useMode: () => 'admin' }))

import ToppersPage from '../index'

// A combined exam sat by a BATCH_A member (Alice) and a BATCH_B member (Bob) —
// the cross-cohort case that used to leak Bob into the BATCH_A filter.
const PROFILES = {
  Alice: { lwsId: 'L1', name: 'Alice', branch: 'LWS Pune', batches: ['BATCH_A'], nameVariants: [], regDate: '2023-01-01', accountStatus: 'Active' },
  Bob:   { lwsId: 'L2', name: 'Bob',   branch: 'APJ',      batches: ['BATCH_B'], nameVariants: [], regDate: '2023-01-01', accountStatus: 'Active' },
  Carol: { lwsId: 'L3', name: 'Carol', branch: 'LWS Pune', batches: ['BATCH_A'], nameVariants: [], regDate: '2023-01-01', accountStatus: 'Active' },
}
const GAT_EXAM = {
  id: 'g1', name: 'GAT Mock', date: '2024-01-02', subject: 'GAT', batch: 'BATCH_A',
  marking: { correct: 4, wrong: 0 },
  questions: [{ q: 1, chapter: 'GK', subtopic: 'X' }],
  students: [{ name: 'Carol', totalMarks: 4, correct: 1, incorrect: 0, notAttempted: 0, responses: { 1: 1 } }],
  createdAt: '2024-01-02T00:00:00.000Z',
}
const COMBINED_EXAM = {
  id: 'e1', name: 'Combined Mock', date: '2024-01-01', subject: 'Maths', batch: 'BATCH_A, BATCH_B',
  marking: { correct: 4, wrong: 0 },
  questions: [{ q: 1, chapter: 'Algebra', subtopic: 'Eq' }],
  students: [
    { name: 'Alice', totalMarks: 4, correct: 1, incorrect: 0, notAttempted: 0, responses: { 1: 1 } },
    { name: 'Bob',   totalMarks: 4, correct: 1, incorrect: 0, notAttempted: 0, responses: { 1: 1 } },
  ],
  createdAt: '2024-01-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.exams = [COMBINED_EXAM]
  mockStore.studentProfiles = PROFILES
})

describe('ToppersPage — batch filter = current members', () => {
  it('lists both attendees when no batch is selected', () => {
    render(<ToppersPage />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows only current members of the selected batch (excludes the cross-cohort co-attendee)', async () => {
    const user = userEvent.setup()
    render(<ToppersPage />)
    const batchSelect = screen.getByRole('option', { name: 'BATCH_A' }).closest('select')
    await user.selectOptions(batchSelect, 'BATCH_A')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()  // Bob is BATCH_B — gone
  })
})

describe('ToppersPage — defaults to Maths', () => {
  it('opens on Maths, so GAT-only students are not shown until the subject is changed', () => {
    mockStore.exams = [COMBINED_EXAM, GAT_EXAM]
    render(<ToppersPage />)
    // subject dropdown defaults to Maths
    expect(screen.getByRole('option', { name: 'Maths' }).selected).toBe(true)
    // Maths attendees show; the GAT-only student (Carol) does not
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Carol')).not.toBeInTheDocument()
  })

  it('switching to GAT surfaces the GAT student', async () => {
    mockStore.exams = [COMBINED_EXAM, GAT_EXAM]
    const user = userEvent.setup()
    render(<ToppersPage />)
    const subjectSelect = screen.getByRole('option', { name: 'GAT' }).closest('select')
    await user.selectOptions(subjectSelect, 'GAT')
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })
})
