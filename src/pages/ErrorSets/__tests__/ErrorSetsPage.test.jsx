import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockZipDownload = vi.fn(() => Promise.resolve('sets.zip'))
vi.mock('../../../lib/errorSetZip', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadErrorSetsZip: (...args) => mockZipDownload(...args),
}))

const mockOneDownload = vi.fn(() => Promise.resolve(new Blob()))
vi.mock('../../../lib/gatErrorSetDocx', async (importOriginal) => ({
  ...(await importOriginal()),
  buildGatErrorSetDocx: (...args) => mockOneDownload(...args),
}))

let mockState = {}
vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockState),
}))

import ErrorSetsPage from '../index'

const BATCH = 'LWS_NDA_2Y_(26-28)_A'

function student(name, lwsId) {
  return {
    lwsId, name, accountStatus: 'Active', batches: [BATCH],
    regDate: '2025-11-01', branch: 'LWS Pune', nameVariants: [name],
  }
}

// Two MCQ mocks plus a written paper, all inside the default 30-day window
// relative to the frozen clock below.
const q = (n, chapter, subtopic, question) => ({
  q: n, subject: 'Maths', chapter, subtopic, question,
  optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd',
  answer: 'C', solution: `Worked answer for ${question}.`,
})

const mock7 = {
  id: 'm7', name: 'Maths Mock 7', date: '2026-09-07', subject: 'Maths', batch: BATCH,
  questions: [
    q(1, 'Vectors', 'Dot Product and Angle', 'Angle between vectors'),
    q(2, 'Circles', 'Circle Equation', 'Radius of the circle'),
    q(3, 'Vectors', 'Cross Product', 'Area of the parallelogram'),
    q(4, 'Statistics', 'Central Tendency', 'Median of the series'),
    q(5, 'Circles', 'Tangents', 'Length of the tangent'),
  ],
  students: [
    // Alice: 2 wrong + 2 skipped + 1 right.
    { name: 'Alice', responses: { 1: -1, 2: 0, 3: -1, 4: 0, 5: 1 } },
    // Bob is strong — nothing wrong here at all.
    { name: 'Bob', responses: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } },
  ],
}
const mock6 = {
  id: 'm6', name: 'Maths Mock 6', date: '2026-08-31', subject: 'Maths', batch: BATCH,
  questions: [
    { q: 1, subject: 'Maths', chapter: 'Statistics', subtopic: 'Dispersion',
      question: 'Standard deviation of the set', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', answer: 'B', solution: 'Root of variance.' },
  ],
  students: [{ name: 'Alice', responses: { 1: -1 } }, { name: 'Bob', responses: { 1: -1 } }],
}
const writtenPaper = {
  id: 'w1', name: 'Integration Written Test', date: '2026-09-03', subject: 'Maths',
  batch: BATCH, maxMarks: 25, questions: [], students: [{ name: 'Alice', totalMarks: 18 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 8, 10))   // 10 Sep 2026
  mockState = {
    exams: [mock7, mock6, writtenPaper],
    studentProfiles: { Alice: student('Alice', 'LWS-001'), Bob: student('Bob', 'LWS-002') },
    syllabusBatches: [BATCH],
    syllabusBatchBranches: { [BATCH]: 'LWS Pune' },
    branches: ['LWS Pune'],
  }
})

async function selectBatch(user) {
  const batchSelect = screen.getByLabelText(/batch/i)
  await user.selectOptions(batchSelect, BATCH)
}

describe('ErrorSetsPage — exam checklist', () => {
  it('lists the exams in range newest first', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    const rows = screen.getAllByTestId('errorset-exam')
    expect(rows.map(r => within(r).getByTestId('exam-name').textContent))
      .toEqual(['Maths Mock 7', 'Integration Written Test', 'Maths Mock 6'])
  })

  it('shows a written exam but disables it, with the reason', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    const row = screen.getAllByTestId('errorset-exam')
      .find(r => within(r).getByTestId('exam-name').textContent === 'Integration Written Test')
    expect(within(row).getByRole('checkbox')).toBeDisabled()
    expect(row.textContent).toMatch(/no per-question data/i)
  })
})

describe('ErrorSetsPage — generate', () => {
  it('builds one row per active student with their question count', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    await user.click(screen.getByRole('button', { name: /generate/i }))
    const rows = await screen.findAllByTestId('errorset-student')
    expect(rows).toHaveLength(2)
    const alice = rows.find(r => r.textContent.includes('Alice'))
    // Mock 7: 2 wrong + 2 skipped. Mock 6: 1 wrong.
    expect(within(alice).getByTestId('q-count').textContent).toBe('5')
    const bob = rows.find(r => r.textContent.includes('Bob'))
    expect(within(bob).getByTestId('q-count').textContent).toBe('1')
  })

  it('drops an exam from the totals when it is unticked', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    const mock6Row = screen.getAllByTestId('errorset-exam')
      .find(r => within(r).getByTestId('exam-name').textContent === 'Maths Mock 6')
    await user.click(within(mock6Row).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /generate/i }))
    const rows = await screen.findAllByTestId('errorset-student')
    const alice = rows.find(r => r.textContent.includes('Alice'))
    expect(within(alice).getByTestId('q-count').textContent).toBe('4')
  })

  it('applies the cap and says what was left out', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    const cap = screen.getByLabelText(/cap/i)
    await user.clear(cap)
    await user.type(cap, '1')
    await user.click(screen.getByRole('button', { name: /generate/i }))
    const rows = await screen.findAllByTestId('errorset-student')
    const alice = rows.find(r => r.textContent.includes('Alice'))
    expect(within(alice).getByTestId('q-count').textContent).toBe('1')
    expect(alice.textContent).toMatch(/of 5/)
  })

  it('flags a student whose set is too thin to be worth handing out', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    await user.click(screen.getByRole('button', { name: /generate/i }))
    const rows = await screen.findAllByTestId('errorset-student')
    const bob = rows.find(r => r.textContent.includes('Bob'))
    expect(within(bob).getByRole('checkbox')).not.toBeChecked()
  })
})

describe('ErrorSetsPage — bulk ZIP', () => {
  it('sends one item per included student, with the batch-named archive', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    await user.click(screen.getByRole('button', { name: /generate/i }))
    await screen.findAllByTestId('errorset-student')
    await user.click(screen.getByRole('button', { name: /download zip/i }))
    await waitFor(() => expect(mockZipDownload).toHaveBeenCalled())
    const [items, zipName, opts] = mockZipDownload.mock.calls.at(-1)
    // Bob is auto-excluded (1 question), so only Alice ships.
    expect(items).toHaveLength(1)
    expect(items[0].studentName).toBe('Alice')
    expect(zipName).toMatch(/ErrorSets\.zip$/)
    expect(opts.includeSolutions).toBe(false)
  })

  it('passes includeSolutions once the box is ticked', async () => {
    const user = userEvent.setup()
    render(<ErrorSetsPage />)
    await selectBatch(user)
    await user.click(screen.getByLabelText(/include solutions/i))
    await user.click(screen.getByRole('button', { name: /generate/i }))
    await screen.findAllByTestId('errorset-student')
    await user.click(screen.getByRole('button', { name: /download zip/i }))
    await waitFor(() => expect(mockZipDownload).toHaveBeenCalled())
    expect(mockZipDownload.mock.calls.at(-1)[2].includeSolutions).toBe(true)
  })
})
