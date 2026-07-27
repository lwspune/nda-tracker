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

function renderModal(overrides = {}) {
  mockStoreState = {
    addExam, replaceExam,
    exams: [],
    studentProfiles: PROFILES,
    syllabusBatches: ['B1', 'B2'],
    ...overrides,
  }
  const onClose = vi.fn()
  render(<OfflineExamModal onClose={onClose} />)
  return { onClose }
}

// Fill the always-visible exam meta so only the marks decide save-ability.
async function fillMeta(user, { name = 'Algebra Class Test', max = '100' } = {}) {
  await user.type(screen.getByLabelText(/exam name/i), name)
  await user.clear(screen.getByLabelText(/max marks/i))
  await user.type(screen.getByLabelText(/max marks/i), max)
}

const grid = () => screen.getByRole('table', { name: /marks/i })
const markInput = (name) => screen.getByLabelText(`Marks for ${name}`)
const saveBtn = () => screen.getByRole('button', { name: /save exam|replace exam/i })

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
