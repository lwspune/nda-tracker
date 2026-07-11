import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
  setActiveStudent: vi.fn(),
  setCheckpointExceptions: vi.fn(),
  getCheckpointExceptionsForDate: vi.fn(),
  confirmRoll: vi.fn(),
  getConfirmationsForDate: vi.fn(),
  fetchDailyAttendance: vi.fn(),
  getActiveLeaves: vi.fn(),
  endLeave: vi.fn(),
  addLeave: vi.fn(),
  hostelAlertMobiles: [],
  setHostelAlertMobiles: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}))

import { supabase } from '../../../lib/supabase'
import HostelTab from '../HostelTab'

const PROFILES = {
  'Aarav Nair':   { name: 'Aarav Nair',   lwsId: 'APJ-1', branch: 'APJ', accountStatus: 'Active', gender: 'Male',   batches: ['APJ_NDA_11th'] },
  'Bhavya Rao':   { name: 'Bhavya Rao',   lwsId: 'APJ-2', branch: 'APJ', accountStatus: 'Active', gender: 'Female', batches: ['APJ_NDA_11th'] },
  'Chirag Set':   { name: 'Chirag Set',   lwsId: 'APJ-3', branch: 'APJ', accountStatus: 'Active', gender: 'Male',   batches: ['APJ_NDA_12th'] },
  'Day Scholar':  { name: 'Day Scholar',  lwsId: 'LWS-9', branch: 'LWS Pune', accountStatus: 'Active' }, // wrong branch
  'Quit Boarder': { name: 'Quit Boarder', lwsId: 'APJ-9', branch: 'APJ', accountStatus: 'Quit' },        // inactive
  'Variant Sp':   { name: 'Aarav Nair',   lwsId: 'APJ-1', branch: 'APJ', accountStatus: 'Active' },       // variant key
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.hostelAlertMobiles = []
  mockStore.getCheckpointExceptionsForDate.mockResolvedValue([])
  mockStore.fetchDailyAttendance.mockResolvedValue({ date: null, rows: [] })
  mockStore.getConfirmationsForDate.mockResolvedValue([])
  mockStore.getActiveLeaves.mockResolvedValue([])
  mockStore.endLeave.mockResolvedValue(true)
  mockStore.addLeave.mockResolvedValue(true)
  mockStore.setCheckpointExceptions.mockResolvedValue(true)
  mockStore.confirmRoll.mockResolvedValue(true)
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } } })
})

describe('HostelTab — roster scoping', () => {
  it('shows only Active APJ boarders (excludes other branch, inactive, variant keys)', async () => {
    render(<HostelTab />)
    await waitFor(() => expect(screen.getByText('Aarav Nair')).toBeInTheDocument())
    expect(screen.getByText('Bhavya Rao')).toBeInTheDocument()
    expect(screen.getByText('Chirag Set')).toBeInTheDocument()
    expect(screen.queryByText('Day Scholar')).not.toBeInTheDocument()
    expect(screen.queryByText('Quit Boarder')).not.toBeInTheDocument()
    // Roster reflects 3 boarders — Aarav appears once despite the variant key
    // (no duplicate status button for him).
    expect(screen.getAllByLabelText(/Aarav Nair:/)).toHaveLength(1)
  })

  it('excludes APJ day-scholars (residential:false) from the boarder roster', async () => {
    mockStore.studentProfiles = {
      'Boarder One':   { name: 'Boarder One',   lwsId: 'APJ-1', branch: 'APJ', accountStatus: 'Active', residential: true },
      'Day Scholar X': { name: 'Day Scholar X', lwsId: 'APJ-2', branch: 'APJ', accountStatus: 'Active', residential: false },
    }
    render(<HostelTab />)
    await waitFor(() => expect(screen.getByText('Boarder One')).toBeInTheDocument())
    expect(screen.queryByText('Day Scholar X')).not.toBeInTheDocument()
  })
})

describe('HostelTab — marking-list filters', () => {
  it('boys/girls filter narrows the list but not the roster tally', async () => {
    render(<HostelTab />)
    await screen.findByLabelText(/Aarav Nair: Present/)
    fireEvent.click(screen.getByRole('button', { name: 'Girls' }))
    // Only the girl remains in the list…
    expect(screen.getByLabelText(/Bhavya Rao:/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Aarav Nair:/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Chirag Set:/)).not.toBeInTheDocument()
    // …but the whole-hostel Roster/Expected tally is unchanged (3).
    const gate = screen.getByText(/Reconciliation gate/i).closest('.card')
    expect(gate).toHaveTextContent(/3 roster/)
    expect(screen.getByText(/Showing/)).toHaveTextContent(/Showing 1 of 3/)
  })

  it('batch filter narrows the list to that batch', async () => {
    render(<HostelTab />)
    await screen.findByLabelText(/Aarav Nair: Present/)
    fireEvent.change(screen.getByLabelText(/Filter by batch/), { target: { value: 'APJ_NDA_12th' } })
    expect(screen.getByLabelText(/Chirag Set:/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Aarav Nair:/)).not.toBeInTheDocument()
  })

  it('hides the branch filter while APJ is the only hostel branch', async () => {
    render(<HostelTab />)
    await screen.findByLabelText(/Aarav Nair: Present/)
    expect(screen.queryByLabelText(/Filter by branch/)).not.toBeInTheDocument()
  })
})

describe('HostelTab — exception marking + reconciliation', () => {
  it('cycles a boarder present→absent and updates the away/expected tally', async () => {
    render(<HostelTab />)
    const statusBtn = await screen.findByLabelText(/Aarav Nair: Present/)
    // Night Roll is the default checkpoint → reconciliation gate is visible.
    const gate = screen.getByText(/Reconciliation gate/i).closest('.card')
    // Expected-in-dorm starts at the full roster (3), 0 away.
    expect(gate).toHaveTextContent(/3 roster/)
    expect(gate).toHaveTextContent(/0 away/)
    expect(gate).toHaveTextContent(/= 3\./)

    fireEvent.click(statusBtn)
    expect(await screen.findByLabelText(/Aarav Nair: Absent/)).toBeInTheDocument()
    // One away → expected in dorm drops to 2.
    await waitFor(() => expect(gate).toHaveTextContent(/1 away/))
    expect(gate).toHaveTextContent(/= 2\./)
  })

  it('saves the marked exception set via the slice', async () => {
    render(<HostelTab />)
    const statusBtn = await screen.findByLabelText(/Bhavya Rao: Present/)
    fireEvent.click(statusBtn) // → absent
    fireEvent.click(screen.getByRole('button', { name: /Save Night Roll/i }))
    await waitFor(() => expect(mockStore.setCheckpointExceptions).toHaveBeenCalledWith(
      expect.any(String), 'hostel_pm', [{ lwsId: 'APJ-2', status: 'absent' }],
    ))
  })
})

describe('HostelTab — on-leave panel', () => {
  it('lists an open-ended leave (stale) and marks it returned via endLeave', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'lv-1', lws_id: 'APJ-1', from_ts: '2020-01-01T00:00:00.000Z', to_ts: null, type: 'leave' },
    ])
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /On Leave/ }))

    // The open-ended, long-running leave is surfaced and flagged stale.
    expect(await screen.findByText(/open-ended/)).toBeInTheDocument()
    expect(screen.getByText(/⚠ stale/)).toBeInTheDocument()

    // Mark returned closes the leave (stamps to_ts) rather than deleting it.
    fireEvent.click(screen.getByRole('button', { name: /Mark Aarav Nair returned/ }))
    await waitFor(() => expect(mockStore.endLeave).toHaveBeenCalledWith('lv-1', expect.any(String)))
  })

  it('shows an empty state when no boarder is on leave', async () => {
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /On Leave/ }))
    expect(await screen.findByText(/No boarders on leave/)).toBeInTheDocument()
  })

  it('puts a selected boarder on an open-ended leave via addLeave (2099 sentinel)', async () => {
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /On Leave/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Put students on leave/ }))
    fireEvent.click(await screen.findByLabelText('Aarav Nair'))          // pick a boarder
    fireEvent.click(screen.getByRole('button', { name: /Put 1 on leave/ }))
    await waitFor(() => expect(mockStore.addLeave).toHaveBeenCalledWith(
      expect.objectContaining({ lwsId: 'APJ-1', toTs: '2099-12-31T23:59:59+05:30' }),
    ))
  })

  it('excludes already-on-leave boarders from the put-on-leave picker', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'lv1', lws_id: 'APJ-1', from_ts: '2026-07-09T00:00:00+05:30', to_ts: null },
    ])
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /On Leave/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Put students on leave/ }))
    // Aarav (APJ-1) is already on leave → not offered in the picker; Bhavya is.
    expect(screen.queryByLabelText('Aarav Nair')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bhavya Rao')).toBeInTheDocument()
  })
})

describe('HostelTab — chain view', () => {
  it('reports all-accounted-for when there are no exceptions', async () => {
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /^Chain/ }))
    expect(await screen.findByText(/every boarder is accounted for/i)).toBeInTheDocument()
  })

  it('disables the warden alert when there are no anomalies', async () => {
    mockStore.hostelAlertMobiles = ['9021869427']
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /^Chain/ }))
    expect(await screen.findByRole('button', { name: /Alert warden/ })).toBeDisabled()
  })

  it('fires the alert endpoint for the current date when an anomaly + warden number exist', async () => {
    mockStore.hostelAlertMobiles = ['9021869427']
    mockStore.getCheckpointExceptionsForDate.mockResolvedValue([
      { lws_id: 'APJ-1', checkpoint: 'dinner', status: 'absent' },
    ])
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, sent: 1, count: 1 }) })
    vi.stubGlobal('fetch', fetchSpy)

    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /^Chain/ }))
    const alertBtn = await screen.findByRole('button', { name: /Alert warden \(1\)/ })
    expect(alertBtn).toBeEnabled()
    fireEvent.click(alertBtn)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/api/send-attendance-alerts',
      expect.objectContaining({ method: 'POST' }),
    ))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.kind).toBe('hostel')
    expect(body.date).toMatch(/^\d{2}-\d{2}-\d{4}$/)
    expect(await screen.findByText(/Warden alerted/i)).toBeInTheDocument()
  })
})
