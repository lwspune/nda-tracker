// Tests for ReuploadResultsModal — re-upload results Excel for an existing exam.
// Flow: upload results Excel → preview diff (old vs new students) → Replace

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock store ────────────────────────────────────────────────────────────────

const mockStore = {
  replaceExam: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

// ── Mock Excel parser ─────────────────────────────────────────────────────────

const mockParseExcelFull = vi.fn()

vi.mock('../../../lib/excel', () => ({
  parseExcelFull: (...args) => mockParseExcelFull(...args),
}))

import ReuploadResultsModal from '../ReuploadResultsModal'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExam(overrides = {}) {
  return {
    id: 'exam-1',
    name: 'NDA Mock 1',
    date: '2024-03-01',
    subject: 'Maths',
    marking: { correct: 4, wrong: -1 },
    questions: [
      { q: 1, chapter: 'Algebra',      subtopic: 'Equations' },
      { q: 2, chapter: 'Trigonometry', subtopic: 'Ratios'    },
    ],
    students: [
      { name: 'Alice', totalMarks: 20, correct: 5, incorrect: 0, notAttempted: 0 },
      { name: 'Bob',   totalMarks: 16, correct: 4, incorrect: 0, notAttempted: 0 },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeParsedResult(overrides = {}) {
  return {
    examName:    'NDA Mock 1',
    examDate:    '2024-03-01',
    subject:     'Maths',
    markCorrect: 4,
    markWrong:   -1,
    hasNegative: true,
    totalQs:     2,
    students: [
      { name: 'Alice', totalMarks: 24, correct: 6, incorrect: 0, notAttempted: 0 },
      { name: 'Bob',   totalMarks: 20, correct: 5, incorrect: 0, notAttempted: 0 },
      { name: 'Carol', totalMarks: 12, correct: 3, incorrect: 0, notAttempted: 0 },
    ],
    ...overrides,
  }
}

function makeFakeFile(name = 'results.xlsx') {
  return new File(['dummy'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderModal(exam = makeExam(), onClose = vi.fn()) {
  return render(<ReuploadResultsModal exam={exam} onClose={onClose} />)
}

function getFileInput(container) {
  return container.querySelector('input[type="file"]')
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockParseExcelFull.mockResolvedValue(makeParsedResult())
})

// ── Render & close ────────────────────────────────────────────────────────────

describe('ReuploadResultsModal — render', () => {
  it('shows the exam name in the modal header', () => {
    renderModal()
    expect(screen.getByText(/NDA Mock 1/)).toBeInTheDocument()
  })

  it('shows a DropZone for the results file', () => {
    const { container } = renderModal()
    expect(getFileInput(container)).toBeInTheDocument()
  })

  it('shows a cancel button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('calls onClose when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal(makeExam(), onClose)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('save button is disabled before a file is uploaded', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /replace results/i })).toBeDisabled()
  })
})

// ── File upload & diff preview ────────────────────────────────────────────────

describe('ReuploadResultsModal — upload & preview', () => {
  it('calls parseExcelFull when a file is selected', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => expect(mockParseExcelFull).toHaveBeenCalledOnce())
  })

  it('shows old and new student counts after parsing', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      // diff preview shows "Current" and "New file" section labels
      expect(screen.getByText(/current/i)).toBeInTheDocument()
      expect(screen.getByText(/new file/i)).toBeInTheDocument()
    })
    // exam has 2 students → "Current" column; new file has 3 → "New file" column
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
  })

  it('enables Replace Results button after successful parse', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /replace results/i })).not.toBeDisabled()
    })
  })

  it('shows a warning when question count differs from existing exam', async () => {
    // New file has 5 questions but exam has 2
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ totalQs: 5 }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByText(/question count/i)).toBeInTheDocument()
    })
  })

  it('does not show question count warning when counts match', async () => {
    // makeParsedResult defaults to totalQs: 2, exam has 2 questions
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(mockParseExcelFull).toHaveBeenCalledOnce()
    })
    expect(screen.queryByText(/question count/i)).not.toBeInTheDocument()
  })

  it('shows an error message when parsing fails', async () => {
    mockParseExcelFull.mockRejectedValue(new Error('Missing column: Name'))
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByText(/missing column/i)).toBeInTheDocument()
    })
  })
})

// ── Save ──────────────────────────────────────────────────────────────────────

describe('ReuploadResultsModal — save', () => {
  async function uploadAndSave(container, user) {
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /replace results/i })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('button', { name: /replace results/i }))
  }

  it('calls replaceExam with new students and existing questions', async () => {
    const user = userEvent.setup()
    const exam = makeExam()
    const { container } = renderModal(exam)
    await uploadAndSave(container, user)
    expect(mockStore.replaceExam).toHaveBeenCalledOnce()
    const [calledId, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledId).toBe('exam-1')
    // New students from the file (3 students)
    expect(calledExam.students).toHaveLength(3)
    expect(calledExam.students[0].name).toBe('Alice')
    expect(calledExam.students[2].name).toBe('Carol')
    // Questions unchanged
    expect(calledExam.questions).toEqual(exam.questions)
  })

  it('calls onClose after saving', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = renderModal(makeExam(), onClose)
    await uploadAndSave(container, user)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
