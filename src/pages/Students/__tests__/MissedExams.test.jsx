// Tests for MissedExams — surfaces persistent exam_absences rows on the
// student profile (admin / teacher fetch from slice; student portal supplies
// the rows via prop-bypass because the portal has no Supabase session).

import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockExamAbsenceRows = []
const mockGetExamAbsencesForStudent = vi.fn(async () => mockExamAbsenceRows)

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({
    getExamAbsencesForStudent: mockGetExamAbsencesForStudent,
  }),
}))

import userEvent from '@testing-library/user-event'
import { ModeContext } from '../../../context/ModeContext'
import MissedExams from '../MissedExams'

const exams = [
  { id: 'e1', name: 'Mock #1', date: '2026-05-10', batch: 'APJ_NDA_2Y_(26-28)' },
  { id: 'e2', name: 'Mock #2', date: '2026-05-17', batch: 'APJ_NDA_2Y_(26-28)' },
  { id: 'e3', name: 'Mock #3', date: '2026-05-22', batch: 'APJ_NDA_2Y_(26-28)' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockExamAbsenceRows = []
  mockGetExamAbsencesForStudent.mockImplementation(async () => mockExamAbsenceRows)
})

describe('MissedExams — admin / teacher (slice fetch)', () => {
  it('fetches absences for the student on mount', async () => {
    mockExamAbsenceRows = [
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
    ]
    render(<MissedExams lwsId="LWS-001" exams={exams} />)
    await waitFor(() => expect(mockGetExamAbsencesForStudent).toHaveBeenCalledWith('LWS-001'))
  })

  it('renders one row per missed exam with name and date', async () => {
    mockExamAbsenceRows = [
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
      { exam_id: 'e2', lws_id: 'LWS-001', marked_at: '2026-05-17T10:00Z', notified_at: '2026-05-17T11:00Z' },
    ]
    render(<MissedExams lwsId="LWS-001" exams={exams} />)
    expect(await screen.findByText('Mock #1')).toBeInTheDocument()
    expect(screen.getByText('Mock #2')).toBeInTheDocument()
    expect(screen.queryByText('Mock #3')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no absences (no card rendered)', async () => {
    mockExamAbsenceRows = []
    const { container } = render(<MissedExams lwsId="LWS-001" exams={exams} />)
    await waitFor(() => expect(mockGetExamAbsencesForStudent).toHaveBeenCalled())
    // Component returns null when empty — no card, no header
    expect(container.querySelector('h3, h2')).toBeNull()
    expect(screen.queryByText(/Missed Exams/i)).not.toBeInTheDocument()
  })

  it('shows a Notified badge on rows whose notified_at is set', async () => {
    mockExamAbsenceRows = [
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
      { exam_id: 'e2', lws_id: 'LWS-001', marked_at: '2026-05-17T10:00Z', notified_at: '2026-05-17T11:00Z' },
    ]
    render(<MissedExams lwsId="LWS-001" exams={exams} />)
    await screen.findByText('Mock #1')
    // Badge text is "Notified"; column header also says "Notified". Filter
    // to the cells inside the tbody to isolate the row badges.
    const tbody = document.querySelector('tbody')
    const badges = tbody.querySelectorAll('[class*="badge"], [class*="Badge"], .text-success')
    // Each row either has a Notified badge or a "—" cell. Two rows, one notified.
    const notifiedCells = Array.from(tbody.querySelectorAll('td'))
      .filter(td => /Notified/i.test(td.textContent))
    expect(notifiedCells.length).toBe(1)
    // Sanity: nothing got dropped — the second row should have the em-dash placeholder.
    const dashCells = Array.from(tbody.querySelectorAll('td'))
      .filter(td => td.textContent.trim() === '—')
    expect(dashCells.length).toBe(1)
    badges  // silence unused-var
  })

  it('drops absence rows whose exam_id is unknown (e.g. deleted exam)', async () => {
    mockExamAbsenceRows = [
      { exam_id: 'e1',        lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
      { exam_id: 'deleted-x', lws_id: 'LWS-001', marked_at: '2026-05-11T10:00Z', notified_at: null },
    ]
    render(<MissedExams lwsId="LWS-001" exams={exams} />)
    expect(await screen.findByText('Mock #1')).toBeInTheDocument()
    expect(screen.queryByText('deleted-x')).not.toBeInTheDocument()
  })
})

describe('MissedExams — prop bypass (student portal)', () => {
  it('uses examAbsencesProp directly without calling the slice', async () => {
    const rows = [
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
    ]
    render(<MissedExams lwsId="LWS-001" exams={exams} examAbsencesProp={rows} />)
    expect(await screen.findByText('Mock #1')).toBeInTheDocument()
    expect(mockGetExamAbsencesForStudent).not.toHaveBeenCalled()
  })

  it('renders empty (null) when examAbsencesProp is an empty array', async () => {
    const { container } = render(<MissedExams lwsId="LWS-001" exams={exams} examAbsencesProp={[]} />)
    expect(container.querySelector('h3, h2')).toBeNull()
    expect(mockGetExamAbsencesForStudent).not.toHaveBeenCalled()
  })
})

describe('MissedExams — exam name resolution', () => {
  it('uses exam_name + exam_date directly off the row when present (student portal post-fix)', async () => {
    render(
      <MissedExams
        lwsId="LWS-001"
        exams={[]}                                       // student portal exams[] may not include absent exams
        examAbsencesProp={[
          { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null,
            exam_name: 'Mock #42', exam_date: '2026-05-10', exam_batch: 'B1' },
        ]}
      />
    )
    expect(await screen.findByText('Mock #42')).toBeInTheDocument()
  })

  it('falls back to exams[] lookup when row carries only exam_id (admin/teacher path)', async () => {
    mockExamAbsenceRows = [
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
    ]
    render(<MissedExams lwsId="LWS-001" exams={[{ id: 'e1', name: 'Mock #1', date: '2026-05-10' }]} />)
    expect(await screen.findByText('Mock #1')).toBeInTheDocument()
  })

  it('drops rows that are unresolvable from BOTH paths (exam not in exams[] AND no exam_name on row)', async () => {
    const { container } = render(
      <MissedExams
        lwsId="LWS-001"
        exams={[]}
        examAbsencesProp={[
          { exam_id: 'gone', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
        ]}
      />
    )
    // No card rendered when zero resolvable rows
    expect(container.querySelector('h3, h2')).toBeNull()
  })
})

describe('MissedExams — sort order', () => {
  it('renders most recently missed exam first (by exam date)', async () => {
    mockExamAbsenceRows = [
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
      { exam_id: 'e3', lws_id: 'LWS-001', marked_at: '2026-05-22T10:00Z', notified_at: null },
      { exam_id: 'e2', lws_id: 'LWS-001', marked_at: '2026-05-17T10:00Z', notified_at: null },
    ]
    render(<MissedExams lwsId="LWS-001" exams={exams} />)
    await screen.findByText('Mock #3')
    const names = screen.getAllByTestId('missed-exam-name').map(n => n.textContent)
    expect(names).toEqual(['Mock #3', 'Mock #2', 'Mock #1'])
  })
})

describe('MissedExams — readable dates', () => {
  it('shows the exam date as "10 May 2026", never the stored ISO string', async () => {
    render(<MissedExams lwsId="LWS-001" exams={exams} examAbsencesProp={[
      { exam_id: 'e1', lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: null },
    ]} />)
    expect(await screen.findByText('10 May 2026')).toBeInTheDocument()
    expect(screen.queryByText('2026-05-10')).toBeNull()
  })
})

// Students read a plain list: which test, when. Batch codes wrapped to four
// lines a row on a phone, and "Notified" is faculty bookkeeping about whether we
// messaged the parent (2026-11-05). Faculty keep the table.
describe('MissedExams — student portal', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    exam_id: `x${i}`, lws_id: 'LWS-001', marked_at: '2026-05-10T10:00Z', notified_at: i === 0 ? '2026-05-10T11:00Z' : null,
    exam_name: `Mock ${i + 1}`, exam_date: `2026-05-${String(10 + i).padStart(2, '0')}`, exam_batch: 'LWS_NDA_2Y_(25-27)_B',
  }))
  const renderStudent = rows => render(
    <ModeContext.Provider value="student"><MissedExams lwsId="LWS-001" exams={[]} examAbsencesProp={rows} /></ModeContext.Provider>,
  )

  it('shows name and date only — no batch codes, no "Notified"', () => {
    renderStudent(many.slice(0, 2))
    expect(screen.getByText('Mock 1')).toBeInTheDocument()
    expect(screen.getByText('10 May 2026')).toBeInTheDocument()
    expect(screen.queryByText(/LWS_NDA_2Y/)).toBeNull()
    expect(screen.queryByText(/notified/i)).toBeNull()
    expect(screen.queryByText(/batch/i)).toBeNull()
  })

  it('shows the latest five, then offers the rest', async () => {
    renderStudent(many)
    expect(screen.getByText('Mock 7')).toBeInTheDocument()     // newest first
    expect(screen.queryByText('Mock 2')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /show all 7/i }))
    expect(screen.getByText('Mock 1')).toBeInTheDocument()
  })

  it('keeps the full table for faculty', () => {
    render(<MissedExams lwsId="LWS-001" exams={[]} examAbsencesProp={many.slice(0, 2)} />)
    expect(screen.getAllByText('LWS_NDA_2Y_(25-27)_B').length).toBe(2)
    expect(screen.getByRole('columnheader', { name: 'Notified' })).toBeInTheDocument()
  })
})
