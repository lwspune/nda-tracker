// Tests for ReuploadTagsModal — re-upload a tags Excel for an existing exam.
// Flow: Step 1 = upload + validate file → Step 2 = review/edit tags → Save

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

// ── Mock file parsing & validation ────────────────────────────────────────────

const mockParseTagsFile = vi.fn()
const mockValidateTags  = vi.fn()
const mockGetValidChapters = vi.fn()

vi.mock('../../../lib/excel', () => ({
  parseTagsFile: (...args) => mockParseTagsFile(...args),
}))

vi.mock('../../../lib/validateTags', () => ({
  validateTags:     (...args) => mockValidateTags(...args),
  getValidChapters: (...args) => mockGetValidChapters(...args),
}))

import ReuploadTagsModal from '../ReuploadTagsModal'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExam(overrides = {}) {
  return {
    id: 'exam-1',
    name: 'NDA Mock 1',
    date: '2024-03-01',
    subject: 'Maths',
    marking: { correct: 4, wrong: -1 },
    questions: [
      { q: 1, chapter: 'Algebra',      subtopic: 'Equations', question: null, optionA: null, optionB: null, optionC: null, optionD: null, answer: null, solution: null },
      { q: 2, chapter: 'Trigonometry', subtopic: 'Ratios',    question: null, optionA: null, optionB: null, optionC: null, optionD: null, answer: null, solution: null },
    ],
    students: [{ name: 'Alice', totalMarks: 20, correct: 5, incorrect: 0, notAttempted: 0 }],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const VALID_CHAPTERS = ['Algebra', 'Trigonometry', 'Calculus']

function makeFakeFile(name = 'tags.xlsx') {
  return new File(['dummy'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderModal(exam = makeExam(), onClose = vi.fn()) {
  return render(<ReuploadTagsModal exam={exam} onClose={onClose} />)
}

function getFileInput(container) {
  return container.querySelector('input[type="file"]')
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetValidChapters.mockReturnValue(VALID_CHAPTERS)
  mockValidateTags.mockReturnValue({ issues: [] })
  mockParseTagsFile.mockResolvedValue([
    { q: 1, chapter: 'Algebra',      subtopic: 'Equations' },
    { q: 2, chapter: 'Trigonometry', subtopic: 'Ratios'    },
  ])
})

// ── Render & close ────────────────────────────────────────────────────────────

describe('ReuploadTagsModal — render', () => {
  it('shows the exam name in the modal header', () => {
    renderModal()
    expect(screen.getByText(/NDA Mock 1/)).toBeInTheDocument()
  })

  it('shows a DropZone for the tags file on step 1', () => {
    const { container } = renderModal()
    expect(getFileInput(container)).toBeInTheDocument()
  })

  it('shows a cancel/close button on step 1', () => {
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
})

// ── Step 1: file upload & validation ─────────────────────────────────────────

describe('ReuploadTagsModal — step 1 upload', () => {
  it('proceed button is disabled before a file is selected', () => {
    renderModal()
    const proceedBtn = screen.getByRole('button', { name: /review tags/i })
    expect(proceedBtn).toBeDisabled()
  })

  it('calls parseTagsFile when a file is selected', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => expect(mockParseTagsFile).toHaveBeenCalledOnce())
  })

  it('proceed button becomes enabled after a valid file is uploaded', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review tags/i })).not.toBeDisabled()
    })
  })

  it('shows validation issues panel when chapter names are invalid', async () => {
    mockValidateTags.mockReturnValue({
      issues: [{ q: 1, chapter: 'Algbera', suggestion: 'Algebra', type: 'typo' }],
    })
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByText(/chapter name/i)).toBeInTheDocument()
    })
  })

  it('still allows proceed when chapter names are unrecognised (warning, not blocker)', async () => {
    mockValidateTags.mockReturnValue({
      issues: [{ q: 1, chapter: 'Algbera', suggestion: 'Algebra', type: 'unrecognised' }],
    })
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    // The warning panel shows...
    await waitFor(() => {
      expect(screen.getByText(/chapter name/i)).toBeInTheDocument()
    })
    // ...but proceed is NOT blocked — chapter mismatches are warnings now.
    expect(screen.getByRole('button', { name: /review tags/i })).not.toBeDisabled()
  })

  it('shows a success message when all tags are valid', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByText(/validated/i)).toBeInTheDocument()
    })
  })

  it('shows an error message when parsing fails', async () => {
    mockParseTagsFile.mockRejectedValue(new Error('Bad file format'))
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByText(/bad file format/i)).toBeInTheDocument()
    })
  })
})

// ── Step 2: review & save ─────────────────────────────────────────────────────

describe('ReuploadTagsModal — step 2 review', () => {
  async function uploadAndProceed(container, user) {
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /review tags/i })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('button', { name: /review tags/i }))
  }

  it('advances to review step when proceed is clicked', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadAndProceed(container, user)
    expect(screen.getByRole('button', { name: /save tags/i })).toBeInTheDocument()
  })

  it('shows one row per question in the exam', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadAndProceed(container, user)
    // 2 questions → Q1 and Q2 visible
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.getByText('Q2')).toBeInTheDocument()
  })

  it('calls replaceExam with merged tags when saved', async () => {
    const user = userEvent.setup()
    const exam = makeExam()
    const { container } = renderModal(exam)
    await uploadAndProceed(container, user)
    await user.click(screen.getByRole('button', { name: /save tags/i }))
    expect(mockStore.replaceExam).toHaveBeenCalledOnce()
    const [calledId, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledId).toBe('exam-1')
    // questions updated with new tags
    expect(calledExam.questions[0].chapter).toBe('Algebra')
    expect(calledExam.questions[1].chapter).toBe('Trigonometry')
    // students untouched
    expect(calledExam.students).toEqual(exam.students)
  })

  it('calls onClose after saving', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = renderModal(makeExam(), onClose)
    await uploadAndProceed(container, user)
    await user.click(screen.getByRole('button', { name: /save tags/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows a back button on step 2 that returns to step 1', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadAndProceed(container, user)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('button', { name: /review tags/i })).toBeInTheDocument()
  })
})
