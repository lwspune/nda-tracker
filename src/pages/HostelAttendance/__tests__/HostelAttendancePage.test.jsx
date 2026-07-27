import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
  timetableTeachers: [],
  setCheckpointExceptions: vi.fn(),
  getCheckpointExceptionsForDate: vi.fn(),
  confirmRoll: vi.fn(),
  getConfirmationsForDate: vi.fn(),
  getActiveLeaves: vi.fn(),
  endLeave: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import HostelAttendancePage from '../index'

const DMY = '13-07-2026'

const STAFF = [
  { id: 't1', name: 'Warden Sir',      email: 'warden@lwspune.com', hostelAccess: true },
  { id: 't2', name: 'Maths Teacher',   email: 'maths@lwspune.com' },
]

const PROFILES = {
  'Aarav Nair':  { name: 'Aarav Nair',  lwsId: 'APJ-1', branch: 'APJ',      accountStatus: 'Active' },
  'Bhavya Rao':  { name: 'Bhavya Rao',  lwsId: 'APJ-2', branch: 'APJ',      accountStatus: 'Active' },
  'Lws Student': { name: 'Lws Student', lwsId: 'LWS-1', branch: 'LWS Pune', accountStatus: 'Active' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.timetableTeachers = STAFF
  mockStore.getCheckpointExceptionsForDate.mockResolvedValue([])
  mockStore.getConfirmationsForDate.mockResolvedValue([])
  mockStore.getActiveLeaves.mockResolvedValue([])
  mockStore.setCheckpointExceptions.mockResolvedValue(true)
  mockStore.confirmRoll.mockResolvedValue(true)
})

describe('HostelAttendancePage — access gate', () => {
  it('shows the marking list to flagged staff', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    expect(await screen.findByText('Aarav Nair')).toBeInTheDocument()
  })

  // Access is a flag on the teacher record; a teacher without it must see
  // nothing, not a read-only view. Falls closed on unknown emails too.
  it('refuses a teacher without the flag, and an unknown email', async () => {
    const { unmount } = render(<HostelAttendancePage email="maths@lwspune.com" initialDate={DMY} />)
    expect(await screen.findByText(/don't have access/i)).toBeInTheDocument()
    expect(screen.queryByText('Aarav Nair')).not.toBeInTheDocument()
    unmount()

    render(<HostelAttendancePage email="stranger@lwspune.com" initialDate={DMY} />)
    expect(await screen.findByText(/don't have access/i)).toBeInTheDocument()
  })

  it('names the signed-in person and offers a way out (shared device)', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    expect(await screen.findByText(/Warden Sir/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not you/i })).toBeInTheDocument()
  })

  it('lists only boarders — LWS Pune has none', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')
    expect(screen.queryByText('Lws Student')).not.toBeInTheDocument()
  })
})

describe('HostelAttendancePage — marking', () => {
  it('saves exceptions for the selected checkpoint using the DD-MM-YYYY date', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /mark Aarav Nair/i }))   // present → absent
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalled())
    const [date, checkpoint, exceptions] = mockStore.setCheckpointExceptions.mock.calls[0]
    // The hostel subsystem stores DD-MM-YYYY; only student_attendance is ISO.
    expect(date).toBe(DMY)
    expect(checkpoint).toBe('breakfast')
    expect(exceptions).toEqual([{ lwsId: 'APJ-1', status: 'absent' }])
  })

  // Exception capture: nobody tapped means everybody present, and that still
  // has to be saved (an empty array CLEARS the checkpoint).
  it('saves an empty exception set when everyone is present', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalled())
    expect(mockStore.setCheckpointExceptions.mock.calls[0][2]).toEqual([])
  })

  // Semantics confirmed 2026-07-27: a leave EXPLAINS the absence. The boarder
  // is shown as on-leave, locked, and never written as an exception row.
  it('locks an on-leave boarder and never writes them as an exception', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'lv1', lws_id: 'APJ-1', from_ts: '2026-07-01T00:00:00+05:30', to_ts: null },
    ])
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    const row = await screen.findByRole('button', { name: /mark Aarav Nair/i })
    expect(row).toBeDisabled()
    fireEvent.click(row)
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalled())
    expect(mockStore.setCheckpointExceptions.mock.calls[0][2]).toEqual([])
  })

  it('seeds the grid from already-saved exceptions for that checkpoint only', async () => {
    mockStore.getCheckpointExceptionsForDate.mockResolvedValue([
      { lws_id: 'APJ-1', checkpoint: 'breakfast', status: 'sick' },
      { lws_id: 'APJ-2', checkpoint: 'dinner',    status: 'absent' },
    ])
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /mark Aarav Nair/i })).toHaveTextContent(/sick/i))
    expect(screen.getByRole('button', { name: /mark Bhavya Rao/i })).toHaveTextContent(/present/i)
  })
})

describe('HostelAttendancePage — roll reconciliation', () => {
  it('asks for a headcount on a roll checkpoint but not on a meal', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    expect(screen.queryByLabelText(/headcount/i)).not.toBeInTheDocument()   // breakfast

    fireEvent.click(screen.getByRole('button', { name: /night roll/i }))
    expect(await screen.findByLabelText(/headcount/i)).toBeInTheDocument()
  })

  it('reconciles the roll against the exceptions on file', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /night roll/i }))

    fireEvent.click(await screen.findByRole('button', { name: /mark Aarav Nair/i }))  // 1 away
    fireEvent.change(screen.getByLabelText(/headcount/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm roll/i }))

    await waitFor(() => expect(mockStore.confirmRoll).toHaveBeenCalled())
    const [date, checkpoint, counts] = mockStore.confirmRoll.mock.calls[0]
    expect(date).toBe(DMY)
    expect(checkpoint).toBe('hostel_pm')
    expect(counts).toMatchObject({ expectedCount: 2, exceptionCount: 1, confirmedPresent: 1 })
  })
})
