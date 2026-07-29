// Tests for the in-app marks grid on the offline-exam modal.
//
// Offline exams used to REQUIRE a hand-built xlsx: faculty retyped the whole
// roster into Excel every time, then uploaded it back to an app that already
// knew the roster. The grid derives the roster from the selected batches so only
// the marks are typed. The file path stays as a second source.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const addExam = vi.fn()
const replaceExam = vi.fn()

let mockStoreState
vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStoreState),
}))

import OfflineExamModal from '../OfflineExamModal'

const PROFILES = {
  Alice: { lwsId: 'L1', name: 'Alice', batches: ['B1'], branch: 'LWS Pune', accountStatus: 'Active' },
  Bob:   { lwsId: 'L2', name: 'Bob',   batches: ['B1'], branch: 'LWS Pune', accountStatus: 'Active' },
  Carol: { lwsId: 'L3', name: 'Carol', batches: ['B2'], branch: 'LWS Pune', accountStatus: 'Active' },
}

function renderModal(overrides = {}, props = {}) {
  mockStoreState = {
    addExam, replaceExam,
    exams: [],
    studentProfiles: PROFILES,
    syllabusBatches: ['B1', 'B2'],
    ...overrides,
  }
  const onClose = vi.fn()
  render(<OfflineExamModal onClose={onClose} {...props} />)
  return { onClose }
}

// An existing written exam, as stored: totals only, no questions[].
function makeWrittenExam(overrides = {}) {
  return {
    id: 'wq_1',
    name: 'Sets',
    date: '2026-07-27',
    subject: 'Maths',
    batch: 'B1',
    branch: 'LWS Pune',
    marking: { correct: 1, wrong: 0 },
    questions: [],
    maxMarks: 5,
    source: 'teacher',
    createdBy: 'teacher@lws.test',
    students: [
      { name: 'Alice', rollNo: '', totalMarks: 4, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
    ],
    ...overrides,
  }
}

// Fill the always-visible exam meta so only the marks decide save-ability.
async function fillMeta(user, { name = 'Algebra Class Test', max = '100' } = {}) {
  await user.type(screen.getByLabelText(/exam name/i), name)
  await user.clear(screen.getByLabelText(/max marks/i))
  await user.type(screen.getByLabelText(/max marks/i), max)
}

const grid = () => screen.getByRole('table', { name: /marks/i })
const markInput = (name) => screen.getByLabelText(`Marks for ${name}`)
const saveBtn = () => screen.getByRole('button', { name: /save exam|replace exam|save changes/i })

beforeEach(() => { vi.clearAllMocks() })

describe('OfflineExamModal — roster grid', () => {
  it('asks for a batch before any roster exists', () => {
    renderModal()
    expect(screen.queryByRole('table', { name: /marks/i })).not.toBeInTheDocument()
    expect(screen.getByText(/select .*batch/i)).toBeInTheDocument()
  })

  it('loads the selected batch roster as one row per student', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))

    expect(within(grid()).getByText('Alice')).toBeInTheDocument()
    expect(within(grid()).getByText('Bob')).toBeInTheDocument()
    expect(within(grid()).queryByText('Carol')).not.toBeInTheDocument()
  })

  it('unions rosters when a second batch is selected', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await user.click(screen.getByLabelText('B2'))
    expect(within(grid()).getByText('Carol')).toBeInTheDocument()
  })

  it('shows an entered-count so faculty can see what is left', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    expect(screen.getByText(/0 of 2/i)).toBeInTheDocument()
    await user.type(markInput('Alice'), '72')
    expect(screen.getByText(/1 of 2/i)).toBeInTheDocument()
  })

  it('saves typed marks as a totals-only exam with no questions', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await fillMeta(user)
    await user.type(markInput('Alice'), '72')
    await user.type(markInput('Bob'), '55')
    await user.click(saveBtn())

    expect(addExam).toHaveBeenCalledTimes(1)
    const exam = addExam.mock.calls[0][0]
    expect(exam.name).toBe('Algebra Class Test')
    expect(exam.maxMarks).toBe(100)
    expect(exam.batch).toBe('B1')
    expect(exam.questions).toEqual([])
    expect(exam.students.map(s => s.name)).toEqual(['Alice', 'Bob'])
    expect(exam.students.map(s => s.totalMarks)).toEqual([72, 55])
    expect(exam.students[0].responses).toEqual({})
  })

  it('omits students left blank — a blank means they did not appear', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await fillMeta(user)
    await user.type(markInput('Alice'), '72')
    await user.click(saveBtn())

    expect(addExam.mock.calls[0][0].students.map(s => s.name)).toEqual(['Alice'])
  })

  it('keeps an explicit 0 as a real mark', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await fillMeta(user)
    await user.type(markInput('Alice'), '0')
    await user.click(saveBtn())

    expect(addExam.mock.calls[0][0].students).toEqual([
      expect.objectContaining({ name: 'Alice', totalMarks: 0 }),
    ])
  })

  it('blocks save until a name, a max and at least one mark are present', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    expect(saveBtn()).toBeDisabled()

    await fillMeta(user)
    expect(saveBtn()).toBeDisabled()      // meta only, no marks yet

    await user.type(markInput('Alice'), '72')
    expect(saveBtn()).toBeEnabled()
  })

  it('warns and blocks save when a typed mark exceeds max marks', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await fillMeta(user, { max: '50' })
    await user.type(markInput('Alice'), '72')

    expect(screen.getByText(/above the max/i)).toBeInTheDocument()
    expect(saveBtn()).toBeDisabled()
  })
})

describe('OfflineExamModal — paste a column', () => {
  it('fills the grid top-down in roster order', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await user.click(screen.getByRole('button', { name: /paste/i }))
    await user.type(screen.getByLabelText(/paste marks/i), '72\n55')
    await user.click(screen.getByRole('button', { name: /apply/i }))

    expect(markInput('Alice')).toHaveValue(72)
    expect(markInput('Bob')).toHaveValue(55)
  })

  it('leaves a student blank when the pasted row is blank', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await user.click(screen.getByRole('button', { name: /paste/i }))
    await user.type(screen.getByLabelText(/paste marks/i), '\n55')
    await user.click(screen.getByRole('button', { name: /apply/i }))

    expect(markInput('Alice')).toHaveValue(null)
    expect(markInput('Bob')).toHaveValue(55)
  })
})

// ── Edit mode ────────────────────────────────────────────────────────────────
//
// Written exams have no Evalbee sheet to re-upload, so the grid IS their
// correction path. Before this, fixing one typo'd mark meant deleting the exam
// and re-entering the whole class.

describe('OfflineExamModal — editing an existing exam', () => {
  it('seeds the exam meta from the exam being edited', () => {
    renderModal({}, { exam: makeWrittenExam() })
    expect(screen.getByLabelText(/exam name/i)).toHaveValue('Sets')
    expect(screen.getByLabelText(/date/i)).toHaveValue('2026-07-27')
    expect(screen.getByLabelText(/max marks/i)).toHaveValue(5)
    expect(screen.getByLabelText(/subject/i)).toHaveValue('Maths')
    expect(screen.getByLabelText(/branch/i)).toHaveValue('LWS Pune')
    expect(screen.getByLabelText('B1')).toBeChecked()
  })

  it('pre-fills the grid with the marks already recorded', () => {
    renderModal({}, { exam: makeWrittenExam() })
    expect(markInput('Alice')).toHaveValue(4)
    expect(markInput('Bob')).toHaveValue(null)   // no result stored = did not appear
  })

  it('replaces the same exam rather than adding a new one', async () => {
    const user = userEvent.setup()
    renderModal({}, { exam: makeWrittenExam() })
    await user.clear(markInput('Alice'))
    await user.type(markInput('Alice'), '5')
    await user.click(saveBtn())

    expect(addExam).not.toHaveBeenCalled()
    expect(replaceExam).toHaveBeenCalledTimes(1)
    const [id, saved] = replaceExam.mock.calls[0]
    expect(id).toBe('wq_1')
    expect(saved.id).toBe('wq_1')
    expect(saved.students).toEqual([
      expect.objectContaining({ name: 'Alice', totalMarks: 5 }),
    ])
  })

  it('does not sync absences unless faculty opts in', async () => {
    const user = userEvent.setup()
    renderModal({}, { exam: makeWrittenExam() })
    await user.click(saveBtn())
    expect(replaceExam.mock.calls[0][2]).toEqual({ syncAbsences: false })
  })

  it('syncs absences when faculty ticks the box', async () => {
    const user = userEvent.setup()
    renderModal({}, { exam: makeWrittenExam() })
    await user.click(screen.getByRole('checkbox', { name: /flag absentees/i }))
    await user.click(saveBtn())
    expect(replaceExam.mock.calls[0][2]).toEqual({ syncAbsences: true })
  })

  it('keeps source and createdBy so the Written Quiz badge and author survive', async () => {
    const user = userEvent.setup()
    renderModal({}, { exam: makeWrittenExam() })
    await user.click(saveBtn())
    const saved = replaceExam.mock.calls[0][1]
    expect(saved.source).toBe('teacher')
    expect(saved.createdBy).toBe('teacher@lws.test')
  })

  it('keeps a student who has since left the batch, with their mark', async () => {
    const user = userEvent.setup()
    // Carol sat the exam but is now in B2 only — deriving the roster from the
    // batch alone would drop her row, and saving would erase her result.
    const exam = makeWrittenExam({
      students: [
        { name: 'Alice', rollNo: '', totalMarks: 4, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
        { name: 'Carol', rollNo: '', totalMarks: 3, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
      ],
    })
    renderModal({}, { exam })

    expect(within(grid()).getByText('Carol')).toBeInTheDocument()
    expect(markInput('Carol')).toHaveValue(3)

    await user.click(saveBtn())
    const saved = replaceExam.mock.calls[0][1]
    expect(saved.students.map(s => s.name).sort()).toEqual(['Alice', 'Carol'])
    expect(saved.students.find(s => s.name === 'Carol').totalMarks).toBe(3)
  })

  it('does not warn that it will replace an exam when that exam is itself', () => {
    const exam = makeWrittenExam()
    renderModal({ exams: [exam] }, { exam })
    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument()
  })

  it('still warns when a different exam shares the name and date', () => {
    const exam = makeWrittenExam()
    const clash = makeWrittenExam({ id: 'other', name: 'Sets', date: '2026-07-27' })
    renderModal({ exams: [exam, clash] }, { exam })
    expect(screen.getByText(/already exists/i)).toBeInTheDocument()
  })

  it('titles itself as an edit, not an add', () => {
    renderModal({}, { exam: makeWrittenExam() })
    expect(screen.getByRole('heading', { name: /edit marks/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /add offline exam/i })).not.toBeInTheDocument()
  })
})

describe('OfflineExamModal — file upload still available', () => {
  it('switches to the file drop zone and hides the grid', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByLabelText('B1'))
    await user.click(screen.getByRole('tab', { name: /upload/i }))

    expect(screen.queryByRole('table', { name: /marks/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Name · Marks/i)).toBeInTheDocument()
  })

  it('defaults to the grid, not the file upload', () => {
    renderModal()
    expect(screen.getByRole('tab', { name: /enter marks/i })).toHaveAttribute('aria-selected', 'true')
  })
})
