import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  addLeave: vi.fn(),
  markCheckpointFiled: vi.fn(),
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
  mockStore.endLeave.mockResolvedValue(true)
  mockStore.addLeave.mockResolvedValue(true)
  mockStore.markCheckpointFiled.mockResolvedValue(true)
})

// The IST day bounds for DMY, spelled out so the expectations below are
// obviously right rather than mirroring the implementation's arithmetic.
const DAY_START_ISO = '2026-07-13T00:00:00+05:30'
const PREV_DAY_END_UTC = '2026-07-12T18:29:59.999Z'   // DAY_START_ISO minus 1ms

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

// The warden physically sees a boarder leave and return, but until now could
// only READ leaves here — opening or closing one meant phoning the office,
// which is the centralisation failure this page exists to remove. RLS on
// `leaves` is `authenticated`, so this was always a UI gap, never a DB one.
describe('HostelAttendancePage — leave lifecycle', () => {
  const OPEN_LEAVE = [{ id: 'leave-1', lws_id: 'APJ-1', from_ts: '2026-07-10T00:00:00+05:30', to_ts: null }]

  it('offers "returned?" on an on-leave boarder and closes the leave at the end of the previous day', async () => {
    // End of the PREVIOUS day, so the selected date itself unlocks for marking —
    // the boarder was seen today. Same semantics as HostelTab / MarkAbsenteesModal.
    mockStore.getActiveLeaves.mockResolvedValue(OPEN_LEAVE)
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)

    const returned = await screen.findByRole('button', { name: /Aarav Nair returned/i })
    fireEvent.click(returned)
    await waitFor(() => expect(mockStore.endLeave).toHaveBeenCalledWith('leave-1', PREV_DAY_END_UTC))
  })

  it('reloads leaves after a return so the row unlocks', async () => {
    mockStore.getActiveLeaves.mockResolvedValue(OPEN_LEAVE)
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByRole('button', { name: /Aarav Nair returned/i })
    const before = mockStore.getActiveLeaves.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /Aarav Nair returned/i }))
    await waitFor(() => expect(mockStore.getActiveLeaves.mock.calls.length).toBeGreaterThan(before))
  })

  it('puts a boarder on an OPEN-ENDED leave from the selected day', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /Put Aarav Nair on leave/i }))
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: 'Sister wedding' } })
    fireEvent.click(screen.getByRole('button', { name: /^Put on leave$/i }))

    await waitFor(() => expect(mockStore.addLeave).toHaveBeenCalledWith({
      lwsId: 'APJ-1',
      fromTs: DAY_START_ISO,
      toTs: '2099-12-31T23:59:59+05:30',   // the open-ended sentinel, not NULL
      reason: 'Sister wedding',
    }))
  })

  it('treats a blank reason as null rather than an empty string', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /Put Aarav Nair on leave/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Put on leave$/i }))

    await waitFor(() => expect(mockStore.addLeave).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null })
    ))
  })

  it('does not offer the leave action to someone already on leave', async () => {
    mockStore.getActiveLeaves.mockResolvedValue(OPEN_LEAVE)
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByRole('button', { name: /Aarav Nair returned/i })

    expect(screen.queryByRole('button', { name: /Put Aarav Nair on leave/i })).not.toBeInTheDocument()
    // Bhavya is not on leave, so she still gets it.
    expect(screen.getByRole('button', { name: /Put Bhavya Rao on leave/i })).toBeInTheDocument()
  })

  it('never writes an on-leave boarder as an exception — a leave explains every checkpoint', async () => {
    mockStore.getActiveLeaves.mockResolvedValue(OPEN_LEAVE)
    mockStore.getCheckpointExceptionsForDate.mockResolvedValue([
      { lws_id: 'APJ-1', checkpoint: 'breakfast', status: 'absent' },
    ])
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByRole('button', { name: /Aarav Nair returned/i })

    fireEvent.click(screen.getByRole('button', { name: /^Save/i }))
    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalled())
    const [, , exceptions] = mockStore.setCheckpointExceptions.mock.calls[0]
    expect(exceptions.find(e => e.lwsId === 'APJ-1')).toBeUndefined()
  })

  it('can be cancelled without writing anything', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /Put Aarav Nair on leave/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument())
    expect(mockStore.addLeave).not.toHaveBeenCalled()
  })
})

// The warden can now open leaves, so they need the review that stops an
// open-ended one silently masking a boarder forever. Giving one person the
// open/close power and another the stale review is how that guard gets missed.
describe('HostelAttendancePage — open-leave review', () => {
  it('lists who is out, how long, and flags the stale ones', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'l1', lws_id: 'APJ-1', from_ts: '2026-07-09T00:00:00+05:30', to_ts: null }, // 4 days
      { id: 'l2', lws_id: 'APJ-2', from_ts: '2026-07-12T00:00:00+05:30', to_ts: null }, // 1 day
    ])
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)

    const panel = within(await screen.findByTestId('open-leave-review'))
    expect(panel.getByText(/Aarav Nair/)).toBeInTheDocument()
    expect(panel.getByText(/4 days/)).toBeInTheDocument()
    expect(panel.getByText(/1 day\b/)).toBeInTheDocument()
    expect(screen.getByText(/1 out 3\+ days/i)).toBeInTheDocument()
  })

  it('closes a leave from the review panel too', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'l1', lws_id: 'APJ-1', from_ts: '2026-07-09T00:00:00+05:30', to_ts: null },
    ])
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    const panel = within(await screen.findByTestId('open-leave-review'))

    // Distinct accessible name from the roster row's "returned?" so the two
    // controls stay individually addressable.
    fireEvent.click(panel.getByRole('button', { name: /Close leave for Aarav Nair/i }))
    await waitFor(() => expect(mockStore.endLeave).toHaveBeenCalledWith('l1', PREV_DAY_END_UTC))
  })

  it('renders nothing when nobody is on leave', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')
    expect(screen.queryByTestId('open-leave-review')).not.toBeInTheDocument()
  })
})

// An unmarked breakfast and a breakfast where everyone turned up are both zero
// checkpoint_absences rows. The confirmation row is the only thing separating
// them — the same gap lecture_submissions closed for lectures.
describe('HostelAttendancePage — meal filed-vs-silent record', () => {
  it('records a meal as filed even when nobody was missing', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await waitFor(() => expect(mockStore.markCheckpointFiled).toHaveBeenCalledWith(DMY, 'breakfast'))
  })

  it('does not record a filing if the exception write failed', async () => {
    // Same ordering rule as submitLecture: a filing over a failed write would
    // claim the checkpoint was accounted for when nothing was saved.
    mockStore.setCheckpointExceptions.mockResolvedValue(false)
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')

    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalled())
    expect(mockStore.markCheckpointFiled).not.toHaveBeenCalled()
  })

  it('leaves rolls to confirmRoll — their filing carries a headcount', async () => {
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /night roll/i }))

    fireEvent.click(await screen.findByRole('button', { name: /^save/i }))
    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalled())
    expect(mockStore.markCheckpointFiled).not.toHaveBeenCalled()
  })

  it('ticks the checkpoints already on record', async () => {
    mockStore.getConfirmationsForDate.mockResolvedValue([
      { date: DMY, checkpoint: 'breakfast', kind: 'meal' },
    ])
    render(<HostelAttendancePage email="warden@lwspune.com" initialDate={DMY} />)
    expect(await screen.findByRole('button', { name: /breakfast \(done\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /lunch \(not filed yet\)/i })).toBeInTheDocument()
  })
})
