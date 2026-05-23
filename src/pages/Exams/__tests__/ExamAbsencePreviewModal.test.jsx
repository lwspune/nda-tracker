// Tests for ExamAbsencePreviewModal — pre-send modal for the "exam absence" WhatsApp
// flow. Mirrors LateNotificationPreviewModal but sends to parents only (template body
// reads "Your ward was absent…").

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBulkUpdate = vi.fn()
let mockStudentProfiles = {}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({
    studentProfiles: mockStudentProfiles,
    bulkUpdateStudentContacts: mockBulkUpdate,
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
  students: [{ name: 'Bina Patil' }], // only Bina attended
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStudentProfiles = {
    'Aarav Sharma': makeProfile(),
    'Bina Patil':   makeProfile({ lwsId: 'LWS-002', name: 'Bina Patil', parentMobiles: ['9000000201'] }),
    'Carl Kumar':   makeProfile({ lwsId: 'LWS-003', name: 'Carl Kumar', parentMobiles: ['9000000301'] }),
  }
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

describe('ExamAbsencePreviewModal — render & cohort', () => {
  it('renders one card per auto-detected absentee', () => {
    renderModal()
    // Aarav + Carl are in APJ_NDA_2Y_(26-28) but not in exam.students; Bina attended
    expect(screen.getByText('Aarav Sharma')).toBeInTheDocument()
    expect(screen.getByText('Carl Kumar')).toBeInTheDocument()
    expect(screen.queryByText('Bina Patil')).not.toBeInTheDocument()
  })

  it('shows the exam name in the header', () => {
    renderModal()
    expect(screen.getByText('Mock #5')).toBeInTheDocument()
  })

  it('does NOT render a student-mobile field (parents-only flow)', () => {
    renderModal()
    expect(screen.queryByText(/^Mobile$/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Parent mobiles/i).length).toBeGreaterThan(0)
  })

  it('pre-fills parent_mobiles editable field with comma-joined value', () => {
    renderModal()
    const parentInput = screen.getAllByLabelText(/Parent mobiles/i)[0]
    expect(parentInput.value).toBe('9000000100, 9000000200')
  })

  it('shows empty state when no absentees and disables confirm', () => {
    const exam = {
      ...baseExam,
      students: [{ name: 'Aarav Sharma' }, { name: 'Bina Patil' }, { name: 'Carl Kumar' }],
    }
    renderModal({ exam })
    expect(screen.getByText(/No absentees/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('shows empty state when exam has no batches tagged', () => {
    const exam = { ...baseExam, batch: '', students: [] }
    renderModal({ exam })
    expect(screen.getByText(/No absentees/i)).toBeInTheDocument()
  })
})

describe('ExamAbsencePreviewModal — confirm flow', () => {
  it('Confirm calls onConfirm with cleaned rows (parentMobiles digits only) and the exam', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const [rows, redirectTo] = onConfirm.mock.calls[0]
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Aarav Sharma')
    expect(rows[0].parentMobiles).toEqual(['9000000100', '9000000200'])
    expect(redirectTo).toBe('')
  })

  it('Confirm persists edits via bulkUpdateStudentContacts before send', async () => {
    const user = userEvent.setup()
    renderModal()
    const parentInput = screen.getAllByLabelText(/Parent mobiles/i)[0]
    await user.clear(parentInput)
    await user.type(parentInput, '9888888888')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(mockBulkUpdate).toHaveBeenCalled()
    const persistedRows = mockBulkUpdate.mock.calls[0][0]
    const arav = persistedRows.find(r => r.name === 'Aarav Sharma')
    expect(arav.parentMobiles).toEqual(['9888888888'])
  })

  it('Confirm passes redirectTo string to onConfirm when provided', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()
    await user.type(screen.getByLabelText(/Redirect all to/i), '7777777777')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    const [, redirectTo] = onConfirm.mock.calls[0]
    expect(redirectTo).toBe('7777777777')
  })

  it('Cancel calls onClose without sending', async () => {
    const user = userEvent.setup()
    const { onConfirm, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('ExamAbsencePreviewModal — resend scope toggle', () => {
  it('shows the scope toggle only when failedNames is non-null', () => {
    renderModal({ failedNames: null })
    expect(screen.queryByText(/Resend to:/i)).not.toBeInTheDocument()
  })

  it('defaults to failed-only scope when failedNames provided', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal({ failedNames: ['Aarav Sharma'] })
    expect(screen.getByText(/Resend to:/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    const [rows] = onConfirm.mock.calls[0]
    expect(rows.map(r => r.name)).toEqual(['Aarav Sharma'])
  })

  it('switching to "All students" scope sends to everyone in the absentee cohort', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal({ failedNames: ['Aarav Sharma'] })
    await user.click(screen.getByLabelText(/All students/i))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    const [rows] = onConfirm.mock.calls[0]
    expect(rows.map(r => r.name).sort()).toEqual(['Aarav Sharma', 'Carl Kumar'])
  })
})
