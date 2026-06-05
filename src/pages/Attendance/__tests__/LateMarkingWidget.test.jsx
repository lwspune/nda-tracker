import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
  markLate: vi.fn(),
  unmarkLate: vi.fn(),
  getLateStudentsForDate: vi.fn(),
  lateSendHistory: {},
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../context/ModeContext', () => ({
  useMode: () => 'admin',
}))

import LateMarkingWidget from '../LateMarkingWidget'

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', mobile: '9876543210', batches: [] },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'LWS-002', mobile: '9876543211', batches: [] },
  'Karan Mehta':  { name: 'Karan Mehta',  lwsId: 'LWS-003', mobile: '9876543212', batches: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.lateSendHistory = {}
  mockStore.markLate.mockResolvedValue(true)
  mockStore.unmarkLate.mockResolvedValue(true)
  mockStore.getLateStudentsForDate.mockResolvedValue([])
})

describe('LateMarkingWidget — empty state', () => {
  it('renders an empty state message when no students are marked late', async () => {
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLateStudentsForDate).toHaveBeenCalledWith('2026-05-21'))
    expect(screen.getByText(/no students marked late/i)).toBeInTheDocument()
  })

  it('disables the Send button when no students are marked late', async () => {
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLateStudentsForDate).toHaveBeenCalled())
    const sendBtn = screen.getByRole('button', { name: /send morning late notifications/i })
    expect(sendBtn).toBeDisabled()
  })
})

describe('LateMarkingWidget — existing late students load on mount', () => {
  it('renders chips for late students returned by getLateStudentsForDate', async () => {
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001', 'LWS-003'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    expect(await screen.findByText('Arjun Sharma')).toBeInTheDocument()
    expect(await screen.findByText('Karan Mehta')).toBeInTheDocument()
    expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument()
  })

  it('enables the Send button once at least one student is loaded', async () => {
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Arjun Sharma')
    const sendBtn = screen.getByRole('button', { name: /send morning late notifications/i })
    expect(sendBtn).not.toBeDisabled()
  })
})

describe('LateMarkingWidget — searching and adding', () => {
  it('filters the search dropdown by name (case-insensitive)', async () => {
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLateStudentsForDate).toHaveBeenCalled())

    const search = screen.getByPlaceholderText(/search student/i)
    fireEvent.change(search, { target: { value: 'arj' } })
    expect(screen.getByRole('button', { name: /add Arjun Sharma/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add Ravi Kumar/i })).not.toBeInTheDocument()
  })

  it('clicking a search result calls markLate and adds the chip', async () => {
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLateStudentsForDate).toHaveBeenCalled())

    const search = screen.getByPlaceholderText(/search student/i)
    fireEvent.change(search, { target: { value: 'arj' } })
    fireEvent.click(screen.getByRole('button', { name: /add Arjun Sharma/i }))

    await waitFor(() => expect(mockStore.markLate).toHaveBeenCalledWith('LWS-001', '2026-05-21'))
    // Chip appears
    expect(await screen.findByText('Arjun Sharma')).toBeInTheDocument()
  })

  it('does not allow adding the same student twice', async () => {
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Arjun Sharma')

    const search = screen.getByPlaceholderText(/search student/i)
    fireEvent.change(search, { target: { value: 'arjun' } })
    // Already-marked students are filtered out of the search results
    expect(screen.queryByRole('button', { name: /add Arjun Sharma/i })).not.toBeInTheDocument()
  })
})

describe('LateMarkingWidget — removing', () => {
  it('clicking × on a chip calls unmarkLate and removes the chip', async () => {
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Arjun Sharma')

    const removeBtn = screen.getByRole('button', { name: /remove Arjun Sharma/i })
    fireEvent.click(removeBtn)

    await waitFor(() => expect(mockStore.unmarkLate).toHaveBeenCalledWith('LWS-001', '2026-05-21'))
    await waitFor(() => expect(screen.queryByText('Arjun Sharma')).not.toBeInTheDocument())
  })
})

describe('LateMarkingWidget — send button', () => {
  it('calls onSend with the list of late students when clicked', async () => {
    const onSend = vi.fn()
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001', 'LWS-002'])
    render(<LateMarkingWidget date="2026-05-21" onSend={onSend} />)
    await screen.findByText('Arjun Sharma')
    await screen.findByText('Ravi Kumar')

    const sendBtn = screen.getByRole('button', { name: /send morning late notifications/i })
    fireEvent.click(sendBtn)
    expect(onSend).toHaveBeenCalledWith(['LWS-001', 'LWS-002'])
  })
})

describe('LateMarkingWidget — pending-aware send states', () => {
  it('shows the first-send button when no history exists for this date', async () => {
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Arjun Sharma')
    expect(screen.getByRole('button', { name: /send morning late notifications/i })).toBeInTheDocument()
  })

  it('shows "Notify N pending" when a marked student is not yet notified (failed leg)', async () => {
    mockStore.lateSendHistory = {
      '2026-05-21': { sentAt: Date.now(), sent: 1, skipped: 1, failedNames: ['Arjun Sharma'], notifiedLwsIds: [] },
    }
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Arjun Sharma')
    expect(screen.getByRole('button', { name: /notify 1 pending/i })).toBeInTheDocument()
  })

  it('counts a student added AFTER the send as pending (the gap this fixes)', async () => {
    mockStore.lateSendHistory = {
      '2026-05-21': { sentAt: Date.now(), sent: 1, skipped: 0, failedNames: [], notifiedLwsIds: ['LWS-001'] },
    }
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001', 'LWS-002'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Ravi Kumar')
    // LWS-001 notified, LWS-002 added after → 1 pending
    expect(screen.getByRole('button', { name: /notify 1 pending/i })).toBeInTheDocument()
  })

  it('shows "All notified · Resend all" once everyone marked has been notified', async () => {
    mockStore.lateSendHistory = {
      '2026-05-21': { sentAt: Date.now(), sent: 2, skipped: 0, failedNames: [], notifiedLwsIds: ['LWS-001'] },
    }
    mockStore.getLateStudentsForDate.mockResolvedValue(['LWS-001'])
    render(<LateMarkingWidget date="2026-05-21" onSend={vi.fn()} />)
    await screen.findByText('Arjun Sharma')
    expect(screen.getByRole('button', { name: /all notified · resend all/i })).toBeInTheDocument()
  })
})
