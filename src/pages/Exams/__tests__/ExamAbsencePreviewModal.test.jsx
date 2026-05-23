// Tests for ExamAbsencePreviewModal — pre-send modal for the exam-absence WhatsApp
// flow. The modal reads the absentee list from the persistent `exam_absences` slice
// (populated automatically when an exam is uploaded). Joining with `studentProfiles`
// supplies the contact info; rows show a "Notified" badge when `notified_at` is set.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBulkUpdate = vi.fn()
let mockStudentProfiles = {}
let mockAbsenceRows = []

const mockGetExamAbsencesForExam = vi.fn(async () => mockAbsenceRows)
const mockSyncExamAbsences       = vi.fn(async () => ({ added: 0, removed: 0, kept: 0 }))

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({
    studentProfiles:            mockStudentProfiles,
    bulkUpdateStudentContacts:  mockBulkUpdate,
    getExamAbsencesForExam:     mockGetExamAbsencesForExam,
    syncExamAbsences:           mockSyncExamAbsences,
  }),
}))

import ExamAbsencePreviewModal from '../ExamAbsencePreviewModal'

function makeProfile(over = {}) {
  return {
    lwsId: 'LWS-001', name: 'Aarav Sharma', mobile: '9000000001',
    parentMobiles: ['9000000100', '9000000200'], batches: ['APJ_NDA_2Y_(26-28)'],
    nameVariants: [], ...over,
  }
}

const baseExam = {
  id: 'exam-1',
  name: 'Mock #5',
  batch: 'APJ_NDA_2Y_(26-28)',
  students: [{ name: 'Bina Patil' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStudentProfiles = {
    'Aarav Sharma': makeProfile(),
    'Bina Patil':   makeProfile({ lwsId: 'LWS-002', name: 'Bina Patil', parentMobiles: ['9000000201'] }),
    'Carl Kumar':   makeProfile({ lwsId: 'LWS-003', name: 'Carl Kumar', parentMobiles: ['9000000301'] }),
  }
  // Default: two absentees (Aarav + Carl) — the auto-synced state for baseExam.
  mockAbsenceRows = [
    { exam_id: 'exam-1', lws_id: 'LWS-001', notified_at: null,                marked_at: '2026-05-23T10:00Z' },
    { exam_id: 'exam-1', lws_id: 'LWS-003', notified_at: null,                marked_at: '2026-05-23T10:00Z' },
  ]
  // Reset implementations after clearAllMocks
  mockGetExamAbsencesForExam.mockImplementation(async () => mockAbsenceRows)
  mockSyncExamAbsences.mockImplementation(async () => ({ added: 0, removed: 0, kept: 0 }))
})

function renderModal(over = {}) {
  const onConfirm = vi.fn()
  const onClose   = vi.fn()
  render(
    <ExamAbsencePreviewModal
      exam={baseExam}
      onConfirm={onConfirm}
      onClose={onClose}
      failedNames={null}
      {...over}
    />
  )
  return { onConfirm, onClose }
}

// ── Render & cohort ──────────────────────────────────────────────────────────

describe('ExamAbsencePreviewModal — render & cohort', () => {
  it('renders one card per absentee row from the slice', async () => {
    renderModal()
    expect(await screen.findByText('Aarav Sharma')).toBeInTheDocument()
    expect(screen.getByText('Carl Kumar')).toBeInTheDocument()
    expect(screen.queryByText('Bina Patil')).not.toBeInTheDocument()
  })

  it('queries the slice with the exam id on mount', async () => {
    renderModal()
    await waitFor(() => expect(mockGetExamAbsencesForExam).toHaveBeenCalledWith('exam-1'))
  })

  it('triggers syncExamAbsences once when the table starts empty (self-heal for legacy exams)', async () => {
    // First call returns [] (cold table); after sync, second call returns rows.
    let callCount = 0
    mockGetExamAbsencesForExam.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return []
      return [{ exam_id: 'exam-1', lws_id: 'LWS-001', notified_at: null, marked_at: '2026-05-23T10:00Z' }]
    })
    renderModal()
    await waitFor(() => expect(mockSyncExamAbsences).toHaveBeenCalledWith('exam-1'))
    expect(await screen.findByText('Aarav Sharma')).toBeInTheDocument()
  })

  it('does NOT re-call sync after the initial self-heal attempt (avoid loops)', async () => {
    mockGetExamAbsencesForExam.mockImplementation(async () => [])  // stays empty
    renderModal()
    await waitFor(() => expect(mockSyncExamAbsences).toHaveBeenCalledTimes(1))
    // Wait a moment; sync count must not climb
    await new Promise(r => setTimeout(r, 30))
    expect(mockSyncExamAbsences).toHaveBeenCalledTimes(1)
  })

  it('shows the exam name in the header', async () => {
    renderModal()
    expect(await screen.findByText('Mock #5')).toBeInTheDocument()
  })

  it('renders student + parent mobile fields per row', async () => {
    renderModal()
    expect(await screen.findByText('Aarav Sharma')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^Mobile$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(/Parent mobiles/i).length).toBeGreaterThan(0)
  })

  it('pre-fills the student mobile field from the matched profile', async () => {
    renderModal()
    await screen.findByText('Aarav Sharma')
    expect(screen.getAllByLabelText(/^Mobile$/i)[0].value).toBe('9000000001')
  })

  it('pre-fills parent_mobiles editable field with comma-joined value', async () => {
    renderModal()
    await screen.findByText('Aarav Sharma')
    expect(screen.getAllByLabelText(/Parent mobiles/i)[0].value).toBe('9000000100, 9000000200')
  })

  it('shows empty state and disables confirm when no absent rows exist (after self-heal)', async () => {
    mockGetExamAbsencesForExam.mockImplementation(async () => [])
    renderModal()
    expect(await screen.findByText(/No absentees/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('shows a Notified badge on rows whose notified_at is set', async () => {
    mockAbsenceRows = [
      { exam_id: 'exam-1', lws_id: 'LWS-001', notified_at: '2026-05-23T11:00Z', marked_at: '2026-05-23T10:00Z' },
      { exam_id: 'exam-1', lws_id: 'LWS-003', notified_at: null,                 marked_at: '2026-05-23T10:00Z' },
    ]
    renderModal()
    await screen.findByText('Aarav Sharma')
    // Notified label should appear once (Aarav), not twice
    const notifiedLabels = screen.queryAllByText(/Notified/i)
    expect(notifiedLabels.length).toBe(1)
  })
})

// ── Confirm flow ─────────────────────────────────────────────────────────────

describe('ExamAbsencePreviewModal — confirm flow', () => {
  it('Confirm calls onConfirm with cleaned rows (mobile + parentMobiles digits only)', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()
    await screen.findByText('Aarav Sharma')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const [rows, redirectTo] = onConfirm.mock.calls[0]
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Aarav Sharma')
    expect(rows[0].mobile).toBe('9000000001')
    expect(rows[0].parentMobiles).toEqual(['9000000100', '9000000200'])
    expect(redirectTo).toBe('')
  })

  it('Confirm persists mobile + parent edits via bulkUpdateStudentContacts', async () => {
    const user = userEvent.setup()
    renderModal()
    await screen.findByText('Aarav Sharma')
    const studentInput = screen.getAllByLabelText(/^Mobile$/i)[0]
    const parentInput  = screen.getAllByLabelText(/Parent mobiles/i)[0]
    await user.clear(studentInput); await user.type(studentInput, '9111111111')
    await user.clear(parentInput);  await user.type(parentInput,  '9888888888')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(mockBulkUpdate).toHaveBeenCalled()
    const persisted = mockBulkUpdate.mock.calls[0][0]
    const arav = persisted.find(r => r.name === 'Aarav Sharma')
    expect(arav.mobile).toBe('9111111111')
    expect(arav.parentMobiles).toEqual(['9888888888'])
  })

  it('Confirm passes redirectTo string to onConfirm when provided', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()
    await screen.findByText('Aarav Sharma')
    await user.type(screen.getByLabelText(/Redirect all to/i), '7777777777')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    const [, redirectTo] = onConfirm.mock.calls[0]
    expect(redirectTo).toBe('7777777777')
  })

  it('Cancel calls onClose without sending', async () => {
    const user = userEvent.setup()
    const { onConfirm, onClose } = renderModal()
    await screen.findByText('Aarav Sharma')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

// ── Resend scope toggle ──────────────────────────────────────────────────────

describe('ExamAbsencePreviewModal — resend scope toggle', () => {
  it('shows the scope toggle only when failedNames is non-null', async () => {
    renderModal({ failedNames: null })
    await screen.findByText('Aarav Sharma')
    expect(screen.queryByText(/Resend to:/i)).not.toBeInTheDocument()
  })

  it('defaults to failed-only scope when failedNames provided', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal({ failedNames: ['Aarav Sharma'] })
    await screen.findByText(/Resend to:/i)
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    const [rows] = onConfirm.mock.calls[0]
    expect(rows.map(r => r.name)).toEqual(['Aarav Sharma'])
  })

  it('switching to "All students" scope sends to everyone in the absentee cohort', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal({ failedNames: ['Aarav Sharma'] })
    await screen.findByText(/Resend to:/i)
    await user.click(screen.getByLabelText(/All students/i))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    const [rows] = onConfirm.mock.calls[0]
    expect(rows.map(r => r.name).sort()).toEqual(['Aarav Sharma', 'Carl Kumar'])
  })
})
