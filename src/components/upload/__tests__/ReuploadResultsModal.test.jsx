// Tests for ReuploadResultsModal — re-upload results Excel for an existing exam.
// Flow: upload results Excel → preview diff (old vs new students) → Replace

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock store ────────────────────────────────────────────────────────────────

const mockStore = {
  replaceExam: vi.fn(),
  // The Exam-details block reads these: batch chips, branch options, batch detection.
  studentProfiles: {},
  syllabusBatches: [],
  archivedBatches: [],
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
      { q: 1, chapter: 'Algebra',      subtopic: 'Equations', answer: null },
      { q: 2, chapter: 'Trigonometry', subtopic: 'Ratios',    answer: null },
    ],
    students: [
      { name: 'Alice', totalMarks: 20, correct: 5, incorrect: 0, notAttempted: 0 },
      { name: 'Bob',   totalMarks: 16, correct: 4, incorrect: 0, notAttempted: 0 },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// Defaults deliberately AGREE with makeExam() — same date, same +4/−1 scheme — so
// the baseline case produces no diff rows and the pre-existing tests are unaffected.
function makeParsedResult(overrides = {}) {
  return {
    examName:    'NDA Mock 1',
    examDate:    '2024-03-01',
    examDateFromFile: '2024-03-01',
    markValues:  [-1, 0, 4],
    totalsReconcile: { checked: 3, ok: 3, failed: [] },
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
    answerKeys:  {},
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

  it('calls replaceExam with new students and questions preserved when no answer keys', async () => {
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
    // Questions preserved when answerKeys is empty
    expect(calledExam.questions).toEqual(exam.questions)
  })

  it('overwrites question.answer with results-Excel answerKeys (results > tags precedence)', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ answerKeys: { 1: 'B', 2: 'D' } }))
    const user = userEvent.setup()
    // Existing exam already has hand-set answers from a previous tags upload
    const exam = makeExam({
      questions: [
        { q: 1, chapter: 'Algebra',      subtopic: 'Equations', answer: 'A' },
        { q: 2, chapter: 'Trigonometry', subtopic: 'Ratios',    answer: 'C' },
      ],
    })
    const { container } = renderModal(exam)
    await uploadAndSave(container, user)
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.questions[0].answer).toBe('B')   // overwritten
    expect(calledExam.questions[1].answer).toBe('D')   // overwritten
    // Other fields untouched
    expect(calledExam.questions[0].chapter).toBe('Algebra')
    expect(calledExam.questions[1].subtopic).toBe('Ratios')
  })

  it('leaves question.answer alone when answerKeys lacks an entry for that q', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ answerKeys: { 1: 'B' } }))   // Q2 omitted
    const user = userEvent.setup()
    const exam = makeExam({
      questions: [
        { q: 1, chapter: 'Algebra',      subtopic: 'Equations', answer: null },
        { q: 2, chapter: 'Trigonometry', subtopic: 'Ratios',    answer: 'C'  },
      ],
    })
    const { container } = renderModal(exam)
    await uploadAndSave(container, user)
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.questions[0].answer).toBe('B')   // filled from key
    expect(calledExam.questions[1].answer).toBe('C')   // tags-file value preserved (no key for Q2)
  })

  it('shows the destructive-warning banner when answerKeys are present', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ answerKeys: { 1: 'B', 2: 'D' } }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(screen.getByText(/answer key/i)).toBeInTheDocument()
    })
  })

  it('does NOT show the destructive-warning banner when answerKeys is empty', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await user.upload(getFileInput(container), makeFakeFile())
    await waitFor(() => {
      expect(mockParseExcelFull).toHaveBeenCalledOnce()
    })
    expect(screen.queryByText(/answer key/i)).not.toBeInTheDocument()
  })

  it('calls onClose after saving', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = renderModal(makeExam(), onClose)
    await uploadAndSave(container, user)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ── Exam details: date, marking, batch, branch, subject ───────────────────────
//
// An Evalbee sheet carries facts no other surface can supply for an exam that
// already exists — above all for a paper PUSHED from PYQ Vault, which is created
// with today's date, a placeholder +4/-1 and no batch, and which nothing else in
// the app can correct. See RESULTS_REUPLOAD.md.

async function uploadFile(container, user, file = makeFakeFile()) {
  await user.upload(getFileInput(container), file)
  await waitFor(() => expect(mockParseExcelFull).toHaveBeenCalled())
}

const saveBtn = () => screen.getByRole('button', { name: /replace results/i })

describe('ReuploadResultsModal — date', () => {
  it('prefills the date from the filename', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ examDateFromFile: '2026-02-05' }))
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ date: '2026-09-12' }))
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/^date$/i)).toHaveValue('2026-02-05'))
  })

  // The parser's `examDate` still falls back to today. Using it here would stamp
  // today's date on a historical exam and look exactly like a real answer.
  it('falls back to the exam stored date — never today — when the filename has none', async () => {
    const today = new Date().toISOString().split('T')[0]
    // The exam's own date must NOT be today, or the assertion cannot distinguish
    // "held the stored date" from "stamped today".
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ examDateFromFile: null, examDate: today }))
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ date: '2024-03-01' }))
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/^date$/i)).toHaveValue('2024-03-01'))
    expect(screen.getByLabelText(/^date$/i)).not.toHaveValue(today)
  })

  it('says so when the file carries no date, rather than silently holding the old one', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ examDateFromFile: null }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByText(/name carries no date/i)).toBeInTheDocument())
  })

  it('lists a changed date in the changes summary', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ examDateFromFile: '2026-02-05' }))
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ date: '2026-09-12' }))
    await uploadFile(container, user)
    await waitFor(() => {
      const changes = screen.getByTestId('exam-changes')
      expect(changes).toHaveTextContent('2026-09-12')
      expect(changes).toHaveTextContent('2026-02-05')
    })
  })
})

describe('ReuploadResultsModal — marking', () => {
  it('prefills the marking scheme read off the sheet', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({
      markValues: [-0.83, 0, 4],
      totalsReconcile: { checked: 3, ok: 3, failed: [] },
    }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/marks — correct/i)).toHaveValue(4))
    expect(screen.getByLabelText(/marks — wrong/i)).toHaveValue(-0.83)
  })

  it('shows the verification line naming how many students confirm the scheme', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({
      markValues: [0, 4], totalsReconcile: { checked: 26, ok: 26, failed: [] },
    }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByText(/26 of 26 students/i)).toBeInTheDocument())
  })

  it('disables Save when the scheme cannot be expressed as one correct/wrong pair', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ markValues: [0, 2, 4] }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(saveBtn()).toBeDisabled())
    expect(screen.getByText(/positive mark values/i)).toBeInTheDocument()
  })

  it('disables Save when no student marks add up to their total', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({
      markValues: [0, 4],
      totalsReconcile: { checked: 17, ok: 0, failed: [{ name: 'Z', sheetTotal: 99, sumOfMarks: 8 }] },
    }))
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(saveBtn()).toBeDisabled())
  })

  it('leaves the stored marking in the fields when the sheet is refused — never a guess', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({ markValues: [0, 2, 4] }))
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ marking: { correct: 4, wrong: -1 } }))
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/marks — correct/i)).toHaveValue(4))
    expect(screen.getByLabelText(/marks — wrong/i)).toHaveValue(-1)
  })
})

describe('ReuploadResultsModal — the marking acknowledgement', () => {
  const differing = () => makeParsedResult({
    markValues: [-0.83, 0, 4], totalsReconcile: { checked: 3, ok: 3, failed: [] },
  })

  it('blocks Save until the consequence is acknowledged, when the exam already has results', async () => {
    mockParseExcelFull.mockResolvedValue(differing())
    const user = userEvent.setup()
    const { container } = renderModal(makeExam())           // 2 existing students
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/every percentage/i)).toBeInTheDocument())
    expect(saveBtn()).toBeDisabled()
    await user.click(screen.getByLabelText(/every percentage/i))
    expect(saveBtn()).not.toBeDisabled()
  })

  // A pushed draft has no results, so nothing moves and the tick would be noise.
  it('never asks on an exam with no results yet', async () => {
    mockParseExcelFull.mockResolvedValue(differing())
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ students: [] }))
    await uploadFile(container, user)
    await waitFor(() => expect(saveBtn()).not.toBeDisabled())
    expect(screen.queryByLabelText(/every percentage/i)).not.toBeInTheDocument()
  })

  it('never asks when the marking is unchanged', async () => {
    const user = userEvent.setup()
    const { container } = renderModal(makeExam())
    await uploadFile(container, user)
    await waitFor(() => expect(saveBtn()).not.toBeDisabled())
    expect(screen.queryByLabelText(/every percentage/i)).not.toBeInTheDocument()
  })
})

describe('ReuploadResultsModal — answer-key conflicts', () => {
  const conflicting = () => makeParsedResult({ answerKeys: { 1: 'A' } })
  const examWithKey = () => makeExam({
    questions: [
      { q: 1, chapter: 'Atmosphere', answer: 'B', questionId: 'vault-1' },
      { q: 2, chapter: 'Atmosphere', answer: 'C', questionId: 'vault-2' },
    ],
  })

  it('surfaces the disagreement instead of silently overwriting', async () => {
    mockParseExcelFull.mockResolvedValue(conflicting())
    const user = userEvent.setup()
    const { container } = renderModal(examWithKey())
    await uploadFile(container, user)
    // Specific: the panel also carries an sr-only legend mentioning "answer-key mismatches".
    await waitFor(() =>
      expect(screen.getByText(/answer-key mismatch between/i)).toBeInTheDocument())
  })

  it('labels the stored side Bank when the exam carries PYQ Vault ids', async () => {
    mockParseExcelFull.mockResolvedValue(conflicting())
    const user = userEvent.setup()
    const { container } = renderModal(examWithKey())
    await uploadFile(container, user)
    await waitFor(() =>
      expect(screen.getByLabelText('Use Bank answer B for question 1')).toBeInTheDocument())
  })

  it('labels it Stored when no question carries a bank id', async () => {
    mockParseExcelFull.mockResolvedValue(conflicting())
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({
      questions: [{ q: 1, chapter: 'Algebra', answer: 'B' }, { q: 2, chapter: 'Algebra', answer: 'C' }],
    }))
    await uploadFile(container, user)
    await waitFor(() =>
      expect(screen.getByLabelText('Use Stored answer B for question 1')).toBeInTheDocument())
  })

  it('preselects the Evalbee key, matching the upload wizard', async () => {
    mockParseExcelFull.mockResolvedValue(conflicting())
    const user = userEvent.setup()
    const { container } = renderModal(examWithKey())
    await uploadFile(container, user)
    await waitFor(() =>
      expect(screen.getByLabelText('Use Results answer A for question 1')).toBeChecked())
  })

  it('keeps the stored letter when the stored key is chosen', async () => {
    mockParseExcelFull.mockResolvedValue(conflicting())
    const user = userEvent.setup()
    const { container } = renderModal(examWithKey())
    await uploadFile(container, user)
    await waitFor(() => screen.getByLabelText('Use Bank answer B for question 1'))
    await user.click(screen.getByLabelText('Use Bank answer B for question 1'))
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.questions[0].answer).toBe('B')
  })

  it('warns that choosing the stored key does not re-grade the marks', async () => {
    mockParseExcelFull.mockResolvedValue(conflicting())
    const user = userEvent.setup()
    const { container } = renderModal(examWithKey())
    await uploadFile(container, user)
    await waitFor(() => screen.getByLabelText('Use Bank answer B for question 1'))
    await user.click(screen.getByLabelText('Use Bank answer B for question 1'))
    expect(screen.getByText(/not corrected/i)).toBeInTheDocument()
  })
})

describe('ReuploadResultsModal — subject, batch, branch', () => {
  it('saves the edited subject', async () => {
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ subject: 'English' }))
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/^subject$/i)).toHaveValue('English'))
    await user.selectOptions(screen.getByLabelText(/^subject$/i), 'GAT')
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.subject).toBe('GAT')
  })

  // A <select> cannot display a value absent from its options — it renders the
  // first one, so a wrong value reads as correct and gets saved.
  it('shows a subject outside the canonical list rather than silently swapping it', async () => {
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ subject: 'Astrophysics' }))
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/^subject$/i)).toHaveValue('Astrophysics'))
  })

  it('offers the central batches and saves the picked set', async () => {
    mockStore.syllabusBatches = ['LWS 25-27', 'APJ 11th A']
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ batch: null }))
    await uploadFile(container, user)
    await waitFor(() => screen.getByRole('checkbox', { name: 'LWS 25-27' }))
    await user.click(screen.getByRole('checkbox', { name: 'LWS 25-27' }))
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.batch).toBe('LWS 25-27')
    mockStore.syllabusBatches = []
  })

  // Historical exams carry batch tags that predate the central namespace — dev
  // data has "LWS_NDA_2Y_ (26-28)" against a list holding "LWS_NDA_2Y_(26-28)_A".
  // A picker that cannot show that value destroys it the moment any chip is
  // toggled, because the tag is rebuilt from the central list alone.
  it('shows a batch that is not in the central list, rather than dropping it', async () => {
    mockStore.syllabusBatches = ['LWS 25-27']
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ batch: 'Legacy Batch X' }))
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Legacy Batch X/ })).toBeChecked())
    mockStore.syllabusBatches = []
  })

  it('keeps an off-list batch when another batch is toggled', async () => {
    mockStore.syllabusBatches = ['LWS 25-27']
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ batch: 'Legacy Batch X' }))
    await uploadFile(container, user)
    await waitFor(() => screen.getByRole('checkbox', { name: 'LWS 25-27' }))
    await user.click(screen.getByRole('checkbox', { name: 'LWS 25-27' }))
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.batch).toContain('Legacy Batch X')
    expect(calledExam.batch).toContain('LWS 25-27')
    mockStore.syllabusBatches = []
  })

  it('can deselect an off-list batch, since it is visible', async () => {
    mockStore.syllabusBatches = ['LWS 25-27']
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ batch: 'Legacy Batch X' }))
    await uploadFile(container, user)
    await waitFor(() => screen.getByRole('checkbox', { name: /Legacy Batch X/ }))
    await user.click(screen.getByRole('checkbox', { name: /Legacy Batch X/ }))
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.batch).toBeNull()
    mockStore.syllabusBatches = []
  })

  it('warns that absence rows filed under the previous batch are not removed', async () => {
    mockStore.syllabusBatches = ['LWS 25-27', 'APJ 11th A']
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ batch: 'APJ 11th A' }))
    await uploadFile(container, user)
    await waitFor(() => screen.getByRole('checkbox', { name: 'LWS 25-27' }))
    await user.click(screen.getByRole('checkbox', { name: 'LWS 25-27' }))
    expect(screen.getByText(/not removed/i)).toBeInTheDocument()
    mockStore.syllabusBatches = []
  })
})

describe('ReuploadResultsModal — absence sync', () => {
  it('is on by default, preserving the previous unconditional behaviour', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(screen.getByLabelText(/flag absentees/i)).toBeChecked())
    await user.click(saveBtn())
    const [, , opts] = mockStore.replaceExam.mock.calls[0]
    expect(opts).toEqual({ syncAbsences: true })
  })

  it('passes syncAbsences false when unticked', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => screen.getByLabelText(/flag absentees/i))
    await user.click(screen.getByLabelText(/flag absentees/i))
    await user.click(saveBtn())
    const [, , opts] = mockStore.replaceExam.mock.calls[0]
    expect(opts).toEqual({ syncAbsences: false })
  })
})

describe('ReuploadResultsModal — round-trip safety', () => {
  it('preserves fields this modal does not edit, so a badge or author cannot be stripped', async () => {
    const user = userEvent.setup()
    const exam = makeExam({ source: 'teacher', createdBy: 'someone@lws', maxMarks: 80 })
    const { container } = renderModal(exam)
    await uploadFile(container, user)
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.source).toBe('teacher')
    expect(calledExam.createdBy).toBe('someone@lws')
    expect(calledExam.maxMarks).toBe(80)
  })

  it('writes date, marking, batch, branch and subject through to replaceExam', async () => {
    mockParseExcelFull.mockResolvedValue(makeParsedResult({
      examDateFromFile: '2026-02-05',
      markValues: [0, 4], totalsReconcile: { checked: 3, ok: 3, failed: [] },
    }))
    const user = userEvent.setup()
    const { container } = renderModal(makeExam({ date: '2026-09-12', students: [], branch: 'APJ' }))
    await uploadFile(container, user)
    await waitFor(() => expect(saveBtn()).not.toBeDisabled())
    await user.click(saveBtn())
    const [, calledExam] = mockStore.replaceExam.mock.calls[0]
    expect(calledExam.date).toBe('2026-02-05')
    expect(calledExam.marking).toEqual({ correct: 4, wrong: 0 })
    expect(calledExam.branch).toBe('APJ')
    expect(calledExam.subject).toBe('Maths')
  })

  it('shows no changes summary when nothing differs', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    await uploadFile(container, user)
    await waitFor(() => expect(saveBtn()).not.toBeDisabled())
    expect(screen.queryByTestId('exam-changes')).not.toBeInTheDocument()
  })
})
