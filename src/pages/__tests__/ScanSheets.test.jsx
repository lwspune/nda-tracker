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


// The scanner owns a camera and a canvas, neither of which jsdom has; its own
// tests inject both. Here it is a button that hands the page one read sheet.
vi.mock('../../components/scan/SheetScanner', () => ({
  default: ({ onCapture }) => (
    <div data-testid="sheet-scanner">
      <button onClick={() => onCapture(readSheetImage(), 'auto')}>fake-capture</button>
    </div>
  ),
}))

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

// The viewfinder lands its sheets in the same review list the file input does —
// one place that decides what may be saved, whatever the pixels came from.
describe('Scan page · the camera', () => {
  it('is not offered until an exam is chosen', () => {
    renderPage()
    expect(screen.queryByTestId('sheet-scanner')).not.toBeInTheDocument()
  })

  it('files what the camera read into the same review list', async () => {
    renderPage()
    await pickExam()
    expect(screen.getByTestId('sheet-scanner')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /fake-capture/i }))
    await waitFor(() => expect(screen.getByText('Asha R')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save 1 result/i })).not.toBeDisabled()
  })

  it('names camera sheets so a bad one can be told apart from the files', async () => {
    renderPage()
    await pickExam()
    await userEvent.click(screen.getByRole('button', { name: /fake-capture/i }))
    await waitFor(() => expect(screen.getByText(/camera sheet 1/i)).toBeInTheDocument())
  })
})

// Every refusal the reader makes has to have an answer, or it is a dead end: a
// sheet that cannot be read, or cannot be attributed, blocks the save for the
// WHOLE stack, and the only escape was changing the exam — which discards
// everything scanned so far.
describe('Scan page · sheets that need a human', () => {
  const unidentified = () => okSheet({
    complete: false,
    roll: { digits: '00099', review: false, reason: null },
    student: { lwsId: null, matchedBy: null, review: true,
               reason: 'roll 00099 is not on the roster for this exam', candidates: [] },
  })

  it('lets a human say whose sheet it is, which unblocks the save', async () => {
    readSheetImage.mockReturnValue(unidentified())
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await waitFor(() => expect(screen.getByText(/not on the roster/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /whose sheet/i }), 'LWS-001')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled())
  })

  it('files the assigned student’s marks under their name', async () => {
    readSheetImage.mockReturnValue(unidentified())
    renderPage()
    await pickExam()
    await upload('a.jpg')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /whose sheet/i }), 'LWS-001')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    const [, saved] = mockStore.replaceExam.mock.calls[0]
    expect(saved.students[0].name).toBe('Asha R')
  })

  // The picker is wider than the automatic match on purpose: a misread digit
  // must not land on another cohort's student, but a person reading the sheet in
  // their hand is not misreading anything, and batch membership is CURRENT while
  // the exam is historical.
  it('offers students beyond the exam’s own batch', async () => {
    mockStore.studentList = [
      ...mockStore.studentList,
      { lws_id: 'LWS-777', canonical_name: 'Other Batch Student',
        evalbee_roll_nos: ['00077'], batches: ['NDA_B'] },
    ]
    readSheetImage.mockReturnValue(unidentified())
    renderPage()
    await pickExam()
    await upload('a.jpg')
    const options = [...screen.getByRole('combobox', { name: /whose sheet/i }).options]
      .map(o => o.value)
    expect(options).toContain('LWS-777')
  })

  it('discards a sheet that cannot be read, so the rest can be saved', async () => {
    readSheetImage
      .mockReturnValueOnce(okSheet())
      .mockReturnValueOnce({ ok: false, reason: 'Only 3 registration marks found' })
    renderPage()
    await pickExam()
    await upload('good.jpg', 'blurry.jpg')
    await waitFor(() => expect(screen.getByText(/3 registration marks/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /discard sheet 2/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save 1 result/i })).not.toBeDisabled())
  })
})

// ── Print format ─────────────────────────────────────────────────────────────
//
// The Exams page prints one-up or two-up, and the page used to build only the
// one-up layout — so every two-up stack was refused with "is it the right
// paper?", blaming paper that was correct. The sheet carries no legible format
// marking, so the operator should not have to remember which button they
// printed from: the detected grid answers it for all but 28 question counts.
describe('ScanSheets — print format', () => {
  const qs = n => Array.from({ length: n }, (_, i) => ({ q: i + 1, answer: 'A' }))
  const layoutsFor = () => readSheetImage.mock.calls[0][1].layouts

  it('hands the reader both formats, so a two-up stack reads without being told', async () => {
    mockStore.exams = [mcqExam({ questions: qs(25) })]
    readSheetImage.mockReturnValue(okSheet())
    renderPage()
    await pickExam()
    await upload('a.jpg')
    expect(layoutsFor().map(l => l.perPage)).toEqual([1, 2])
  })

  it('narrows to the format the operator pins, for the papers a photo cannot settle', async () => {
    // 26Q prints 3x7 either way, so the reader refuses to guess; pinning the
    // format is the way out, and it has to actually reach the reader.
    mockStore.exams = [mcqExam({ questions: qs(26) })]
    readSheetImage.mockReturnValue(okSheet())
    renderPage()
    await pickExam()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sheet format/i }), '2')
    await upload('a.jpg')
    expect(layoutsFor().map(l => l.perPage)).toEqual([2])
  })

  it('does not offer a format the paper cannot be printed in', async () => {
    // 200 questions fit one-up (273) but not two-up (188), so two-up is not a
    // choice to offer — and the reader must not be handed a layout that throws.
    mockStore.exams = [mcqExam({ questions: qs(200) })]
    readSheetImage.mockReturnValue(okSheet())
    renderPage()
    await pickExam()
    expect(screen.queryByRole('option', { name: /two per page/i })).toBeNull()
    await upload('a.jpg')
    expect(layoutsFor().map(l => l.perPage)).toEqual([1])
  })

  it('says which format it read, so the operator can spot a wrong stack', async () => {
    mockStore.exams = [mcqExam({ questions: qs(25) })]
    readSheetImage.mockReturnValue(okSheet({ perPage: 2 }))
    renderPage()
    await pickExam()
    await upload('a.jpg')
    // On the sheet row, not the format picker's own option of the same name.
    expect(await screen.findByText(/two per page/i, { selector: 'span' }))
      .toBeInTheDocument()
  })
})

// This page called the shared UI components with prop names they do not take —
// `subtitle`/`message` where they read `sub`, and `tone` where Badge reads
// `variant`. React drops an unknown prop silently, so nothing failed and nothing
// rendered: the page had no subtitle, the empty state no explanation, and every
// sheet badge fell back to Badge's grey default. The badge colour is the
// at-a-glance triage over a scanned stack, which is the whole point of it.
describe('Scan page · what the shared components are actually told', () => {
  const badgeFor = async label => (await screen.findByText(label))

  it('says what the page is for under its title', () => {
    renderPage()
    expect(screen.getByText(/read filled OMR sheets into an exam/i)).toBeInTheDocument()
  })

  it('explains what a scannable exam is when there is none', () => {
    mockStore.exams = [mcqExam({ questions: [] })]   // a written exam
    renderPage()
    expect(screen.getByText(/per-question data/i)).toBeInTheDocument()
  })

  it('marks a cleanly read sheet as read', async () => {
    renderPage()
    await pickExam()
    await upload('a.jpg')
    expect((await badgeFor('Sheet 1')).className).toMatch(/green/)
  })

  it('marks a sheet still holding a question for a human as unfinished', async () => {
    readSheetImage.mockReturnValue(okSheet({
      complete: false, reviewCount: 1,
      needsReview: [{ q: 1, state: 'unclear', scores: [0.4, 0.35, 0, 0] }],
    }))
    renderPage()
    await pickExam()
    await upload('a.jpg')
    expect((await badgeFor('Sheet 1')).className).toMatch(/yellow/)
  })

  it('marks a sheet it could not read at all as a failure', async () => {
    readSheetImage.mockReturnValue({ ok: false, reason: 'Only 3 registration marks found' })
    renderPage()
    await pickExam()
    await upload('a.jpg')
    expect((await badgeFor('Sheet 1')).className).toMatch(/red/)
  })
})

// The scan link is shown to the phone that already followed it.
//
// Measured at 390x844, that card is 200px of the 742px standing between the top
// of the page and the viewfinder, and on a 360x640 Android it is what puts the
// start button itself below the fold. It is worth keeping on the desk screen,
// which is where somebody sends the link FROM; on the phone it is 200px of a
// URL its reader is already at.
describe('Scan page · the scan link on a phone', () => {
  beforeEach(() => { mockStore.scanExamId = 'e1' })

  it('still offers the link on a screen with room for it', () => {
    renderPage()
    expect(screen.getByText(/\/scan\?exam=e1/)).toBeInTheDocument()
  })

  it('keeps it off the phone it was sent to', () => {
    renderPage()
    const card = screen.getByText(/\/scan\?exam=e1/).closest('.card')
    expect(card.parentElement.className).toMatch(/max-md:hidden/)
  })
})
