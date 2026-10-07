import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  holidays: [],
  holidaysLoaded: true,
  loadHolidays: vi.fn(),
  addHolidays: vi.fn(),
  deleteHoliday: vi.fn(),
  branches: ['LWS Pune', 'APJ'],
  syllabusBatches: ['LWS_2Y_A', 'LWS_6M', 'APJ_12th', 'APJ_11th_A', 'APJ_old'],
  archivedBatches: ['APJ_old'],
  syllabusBatchBranches: {
    LWS_2Y_A: 'LWS Pune', LWS_6M: 'LWS Pune',
    APJ_12th: 'APJ', APJ_11th_A: 'APJ', APJ_old: 'APJ',
  },
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../context/ModeContext', () => ({
  useMode: () => 'admin',
}))

import HolidaysTab from '../HolidaysTab'

const TODAY = '2026-10-07'

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('HolidaysTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.holidays = []
    mockStore.addHolidays = vi.fn().mockResolvedValue({ ok: true })
    mockStore.deleteHoliday = vi.fn().mockResolvedValue(true)
  })

  it('says Sundays need no entry', () => {
    render(<HolidaysTab today={TODAY} />)
    expect(screen.getByText(/sundays are always off/i)).toBeInTheDocument()
  })

  it('lists upcoming holidays apart from past ones, with branch and batches', () => {
    mockStore.holidays = [
      { id: 'p', name: 'Independence Day', fromDate: '2026-08-15', toDate: '2026-08-15', branch: 'LWS Pune', batchNames: [] },
      { id: 'u', name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11', branch: 'APJ', batchNames: ['APJ_12th'] },
    ]
    render(<HolidaysTab today={TODAY} />)
    const upcoming = within(screen.getByRole('region', { name: /upcoming/i }))
    expect(upcoming.getByText('Diwali')).toBeInTheDocument()
    expect(upcoming.getByText('9 Nov 2026 – 11 Nov 2026')).toBeInTheDocument()
    expect(upcoming.getByText(/APJ_12th/)).toBeInTheDocument()
    const past = within(screen.getByRole('region', { name: /past/i }))
    expect(past.getByText('Independence Day')).toBeInTheDocument()
    expect(past.getByText(/all batches/i)).toBeInTheDocument()
  })

  it('adds a holiday for two whole branches', async () => {
    render(<HolidaysTab today={TODAY} />)
    fill('Holiday name', 'Diwali')
    fill('From', '2026-11-09')
    fill('To', '2026-11-11')
    fireEvent.click(screen.getByRole('checkbox', { name: 'LWS Pune' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'APJ' }))
    fireEvent.click(screen.getByRole('button', { name: /add holiday/i }))
    await waitFor(() => expect(mockStore.addHolidays).toHaveBeenCalledWith({
      name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11',
      scopes: [{ branch: 'LWS Pune', batchNames: [] }, { branch: 'APJ', batchNames: [] }],
    }))
    // The form clears for the next entry
    await waitFor(() => expect(screen.getByLabelText('Holiday name')).toHaveValue(''))
  })

  it("offers only the chosen branch's active batches, and sends the picked ones", async () => {
    render(<HolidaysTab today={TODAY} />)
    fill('Holiday name', 'Board practical')
    fill('From', '2026-11-20')
    fireEvent.click(screen.getByRole('checkbox', { name: 'APJ' }))
    fireEvent.click(screen.getByRole('radio', { name: /only some batches/i }))
    expect(screen.getByRole('checkbox', { name: 'APJ_12th' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'APJ_old' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'LWS_2Y_A' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'APJ_12th' }))
    fireEvent.click(screen.getByRole('button', { name: /add holiday/i }))
    await waitFor(() => expect(mockStore.addHolidays).toHaveBeenCalledWith({
      name: 'Board practical', fromDate: '2026-11-20', toDate: '',
      scopes: [{ branch: 'APJ', batchNames: ['APJ_12th'] }],
    }))
  })

  it('refuses "some batches" with none ticked, without saving', async () => {
    render(<HolidaysTab today={TODAY} />)
    fill('Holiday name', 'X')
    fill('From', '2026-11-20')
    fireEvent.click(screen.getByRole('checkbox', { name: 'APJ' }))
    fireEvent.click(screen.getByRole('radio', { name: /only some batches/i }))
    fireEvent.click(screen.getByRole('button', { name: /add holiday/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/pick at least one APJ batch/i)
    expect(mockStore.addHolidays).not.toHaveBeenCalled()
  })

  it('shows the reason a save was refused and keeps the form filled', async () => {
    mockStore.addHolidays = vi.fn().mockResolvedValue({ ok: false, error: 'Choose at least one branch.' })
    render(<HolidaysTab today={TODAY} />)
    fill('Holiday name', 'Diwali')
    fill('From', '2026-11-09')
    fireEvent.click(screen.getByRole('button', { name: /add holiday/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one branch.')
    expect(screen.getByLabelText('Holiday name')).toHaveValue('Diwali')
  })

  it('deletes a holiday after confirming', async () => {
    mockStore.holidays = [
      { id: 'u', name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11', branch: 'APJ', batchNames: [] },
    ]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<HolidaysTab today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Diwali for APJ' }))
    await waitFor(() => expect(mockStore.deleteHoliday).toHaveBeenCalledWith('u'))
  })

  it('does not delete when the confirm is cancelled', () => {
    mockStore.holidays = [
      { id: 'u', name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11', branch: 'APJ', batchNames: [] },
    ]
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<HolidaysTab today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Diwali for APJ' }))
    expect(mockStore.deleteHoliday).not.toHaveBeenCalled()
  })
})
