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
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import HostelTab from '../HostelTab'

const PROFILES = {
  'Aarav Nair':   { name: 'Aarav Nair',   lwsId: 'APJ-1', branch: 'APJ', accountStatus: 'Active' },
  'Bhavya Rao':   { name: 'Bhavya Rao',   lwsId: 'APJ-2', branch: 'APJ', accountStatus: 'Active' },
  'Chirag Set':   { name: 'Chirag Set',   lwsId: 'APJ-3', branch: 'APJ', accountStatus: 'Active' },
  'Day Scholar':  { name: 'Day Scholar',  lwsId: 'LWS-9', branch: 'LWS Pune', accountStatus: 'Active' }, // wrong branch
  'Quit Boarder': { name: 'Quit Boarder', lwsId: 'APJ-9', branch: 'APJ', accountStatus: 'Quit' },        // inactive
  'Variant Sp':   { name: 'Aarav Nair',   lwsId: 'APJ-1', branch: 'APJ', accountStatus: 'Active' },       // variant key
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.getCheckpointExceptionsForDate.mockResolvedValue([])
  mockStore.fetchDailyAttendance.mockResolvedValue({ date: null, rows: [] })
  mockStore.getConfirmationsForDate.mockResolvedValue([])
  mockStore.getActiveLeaves.mockResolvedValue([])
  mockStore.setCheckpointExceptions.mockResolvedValue(true)
  mockStore.confirmRoll.mockResolvedValue(true)
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

describe('HostelTab — chain view', () => {
  it('reports all-accounted-for when there are no exceptions', async () => {
    render(<HostelTab />)
    await screen.findByText('Aarav Nair')
    fireEvent.click(screen.getByRole('button', { name: /^Chain/ }))
    expect(await screen.findByText(/every boarder is accounted for/i)).toBeInTheDocument()
  })
})
