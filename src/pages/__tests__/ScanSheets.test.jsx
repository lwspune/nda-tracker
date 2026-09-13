import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  exams: [],
  studentList: [],
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
