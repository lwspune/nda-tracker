import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  exams: [],
  studentList: [],
  scanExamId: null,
  replaceExam: vi.fn(),
}
vi.mock('../../store/useStore', () => ({ default: selector => selector(mockStore) }))
vi.mock('../../config', () => ({ IS_READ_ONLY: false }))

// The reading itself is covered by readSheetImage's own tests against rendered
// sheets. Here it is stubbed so the page's job — choosing, showing, refusing to
// save — can be tested without pixels.
const readSheetImage = vi.fn()
vi.mock('../../lib/omr/readSheetImage', () => ({ readSheetImage: (...a) => readSheetImage(...a) }))

import ScanSheetsPage from '../ScanSheets'

const mcqExam = (o = {}) => ({
  id: 'e1', name: 'Mock 1', date: '2026-01-01', subject: 'Maths',
  batch: 'NDA_A', marking: { correct: 4, wrong: -1 },
  questions: [{ q: 1, answer: 'A' }, { q: 2, answer: 'B' }],
  students: [], ...o,
})
const okSheet = (o = {}) => ({
  ok: true, answers: { 1: 'A', 2: 'B' },
  decisions: [
    { q: 1, state: 'single', choice: 'A', review: false, scores: [0.9, 0, 0, 0] },
    { q: 2, state: 'single', choice: 'B', review: false, scores: [0, 0.9, 0, 0] },
  ],
  needsReview: [], reviewCount: 0, complete: true,
  roll: { digits: '00001', review: false, reason: null },
  student: { lwsId: 'LWS-001', matchedBy: 'evalbee', review: false, reason: null, candidates: [] },
  ...o,
})

const decodeImage = vi.fn(async () => ({ width: 10, height: 10, data: new Uint8ClampedArray(400) }))
const renderPage = () => render(<ScanSheetsPage decodeImage={decodeImage} />)
const file = name => new File(['x'], name, { type: 'image/jpeg' })
const pickExam = async () =>
  userEvent.selectOptions(screen.getByRole('combobox', { name: /exam/i }), 'e1')
const upload = async (...names) =>
  userEvent.upload(screen.getByLabelText(/choose sheet photographs/i), names.map(file))

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.exams = [mcqExam()]
  mockStore.scanExamId = null
  mockStore.studentList = [
    { lws_id: 'LWS-001', canonical_name: 'Asha R', evalbee_roll_nos: ['00001'], batches: ['NDA_A'] },
  ]
  readSheetImage.mockReturnValue(okSheet())
})

describe('Scan page', () => {
  it('says so when there is nothing scannable', () => {
    mockStore.exams = [mcqExam({ questions: [] })]   // a written exam
    renderPage()
    expect(screen.getByText(/no exam to scan into/i)).toBeInTheDocument()
  })

  it('reads a chosen sheet and names the student', async () => {
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText('Asha R')).toBeInTheDocument())
  })

  it('scopes identity to the exam’s own batch', async () => {
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(readSheetImage).toHaveBeenCalled())
    const roster = readSheetImage.mock.calls[0][1].roster
    expect(roster.map(r => r.lwsId)).toEqual(['LWS-001'])
  })

  it('warns rather than saving when a sheet cannot be read', async () => {
    readSheetImage.mockReturnValue({ ok: false, reason: 'Only 3 registration marks found' })
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText(/3 registration marks/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('will not save while a question is still unresolved', async () => {
    readSheetImage.mockReturnValue(okSheet({
      complete: false, reviewCount: 1,
      decisions: [{ q: 1, state: 'review', choice: null, review: true, scores: [0.1, 0.45, 0.1, 0.1] }],
      needsReview: [{ q: 1, state: 'review', choice: null, review: true, scores: [0.1, 0.45, 0.1, 0.1] }],
      answers: { 1: null },
    }))
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText(/unclear mark/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('lets a human resolve a flagged question, which unblocks the save', async () => {
    const flagged = {
      q: 1, state: 'review', choice: null, review: true, scores: [0.1, 0.45, 0.1, 0.1],
    }
    readSheetImage.mockReturnValue(okSheet({
      complete: false, reviewCount: 1, decisions: [flagged], needsReview: [flagged], answers: { 1: null },
    }))
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText(/unclear mark/i)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled())
  })

  it('refuses to save two sheets claiming the same student', async () => {
    renderPage()
    await pickExam()
    await upload('a.jpg', 'b.jpg')
    await waitFor(() => expect(screen.getByText(/same student/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('saves graded results and records that WE graded them', async () => {
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText('Asha R')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(mockStore.replaceExam).toHaveBeenCalledTimes(1)
    const [id, saved] = mockStore.replaceExam.mock.calls[0]
    expect(id).toBe('e1')
    expect(saved.gradedBy).toBe('scanner')
    expect(saved.students).toHaveLength(1)
    const row = saved.students[0]
    expect(row.name).toBe('Asha R')
    expect(row.rollNo).toBe('00001')
    // Q1 keyed A answered A, Q2 keyed B answered B
    expect(row.responses).toEqual({ 1: 1, 2: 1 })
    expect(row.choices).toEqual({ 1: 'A', 2: 'B' })
    expect(row.totalMarks).toBe(8)
  })
})

// A stack is not scanned in one sitting. Saving used to write only the sheets
// from THIS session, which deleted every result filed before them.
describe('Scan page · adding to results already filed', () => {
  const prior = {
    name: 'Bhavesh Patil', rollNo: '00002', totalMarks: 12,
    correct: 3, incorrect: 0, notAttempted: 0, responses: {}, choices: {},
  }

  it('keeps the results the exam already holds', async () => {
    mockStore.exams = [mcqExam({ gradedBy: 'scanner', students: [prior] })]
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText('Asha R')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    const [, saved] = mockStore.replaceExam.mock.calls[0]
    expect(saved.students.map(s => s.name)).toEqual(['Bhavesh Patil', 'Asha R'])
  })

  it('says what saving will do to the results already there', async () => {
    mockStore.exams = [mcqExam({ gradedBy: 'scanner', students: [prior] })]
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText(/1 kept/i)).toBeInTheDocument())
  })

  // `responses` on an Evalbee row is the machine's verdict; relabelling the whole
  // exam 'scanner' is what would let a later key correction rewrite those marks.
  it('will not mix scanned marks into a vendor-graded exam unasked', async () => {
    mockStore.exams = [mcqExam({ gradedBy: 'evalbee', students: [prior] })]
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText(/graded by evalbee/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: /mix scanned marks/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    const [, saved] = mockStore.replaceExam.mock.calls[0]
    expect(saved.students).toHaveLength(2)
    // The surviving Evalbee row still says who graded it.
    expect(saved.gradedBy).toBe('evalbee')
  })

  it('needs no such tick for an exam with no results yet', async () => {
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText('Asha R')).toBeInTheDocument())
    expect(screen.queryByText(/graded by evalbee/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })
})

// Opening the scanner FROM an exam card. The picker offers every MCQ exam the
// school has ever run, so on a phone, over a stack of paper, finding today's
// paper in it is the slowest part of the job.
describe('Scan page · opened on one exam', () => {
  const other = () => mcqExam({ id: 'e2', name: 'Mock 2', date: '2026-03-03' })

  beforeEach(() => {
    mockStore.exams = [mcqExam(), other()]
    mockStore.scanExamId = 'e2'
  })

  it('opens on that exam without anything to choose', async () => {
    renderPage()
    expect(screen.getByText(/Mock 2/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /exam/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/choose sheet photographs/i)).not.toBeDisabled()
  })

  it('still lets you change your mind', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /change/i }))
    expect(screen.getByRole('combobox', { name: /exam/i })).toBeInTheDocument()
  })

  // The link is the point of the deep link: it is opened on the phone that will
  // shoot the sheets, not on the screen that shows it.
  it('offers the link for the phone that will do the scanning', () => {
    renderPage()
    expect(screen.getByText(/\/scan\?exam=e2/)).toBeInTheDocument()
  })

  it('falls back to the picker when the named exam is not there', () => {
    mockStore.scanExamId = 'no_such_exam'
    renderPage()
    expect(screen.getByRole('combobox', { name: /exam/i })).toBeInTheDocument()
  })
})

describe('Scan page · the picker itself', () => {
  it('offers the most recent exam first, not the oldest', () => {
    mockStore.exams = [
      mcqExam({ id: 'old', name: 'Old paper', date: '2025-01-01' }),
      mcqExam({ id: 'new', name: 'New paper', date: '2026-09-01' }),
      mcqExam({ id: 'mid', name: 'Mid paper', date: '2026-02-01' }),
    ]
    renderPage()
    const options = [...screen.getByRole('combobox', { name: /exam/i }).options]
      .map(o => o.value).filter(Boolean)
    expect(options).toEqual(['new', 'mid', 'old'])
  })
})
