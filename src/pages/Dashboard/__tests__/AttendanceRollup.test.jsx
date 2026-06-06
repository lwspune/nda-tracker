import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AttendanceRollup from '../AttendanceRollup'

const PROFILES = {
  Alice: { name: 'Alice', lwsId: 'L1', branch: 'LWS Pune', batches: ['LWS_A'], gender: 'Female', accountStatus: 'Active', nameVariants: [] },
  Bob:   { name: 'Bob',   lwsId: 'L2', branch: 'LWS Pune', batches: ['LWS_A'], gender: 'Male',   accountStatus: 'Active', nameVariants: [] },
  Carol: { name: 'Carol', lwsId: 'L3', branch: 'LWS Pune', batches: ['LWS_A'], gender: 'Female', accountStatus: 'Active', nameVariants: [] },
  Dave:  { name: 'Dave',  lwsId: 'L4', branch: 'APJ',      batches: ['APJ_1'], gender: 'Male',   accountStatus: 'Active', nameVariants: [] },
}
const BRANCH_MAP = { LWS_A: 'LWS Pune', APJ_1: 'APJ' }
const BRANCHES = ['APJ', 'LWS Pune']

// Bob absent; Alice + Carol present; Dave present (no record).
const ROWS_0605 = [
  { lws_id: 'L1', status: 'P' },
  { lws_id: 'L2', status: 'A' },
  { lws_id: 'L3', status: 'L' },
]

function makeFetch(byDate = { '2026-06-05': ROWS_0605 }, latest = '2026-06-05') {
  return vi.fn(async (date) => {
    const d = date ?? latest
    return { date: d, rows: byDate[d] ?? [] }
  })
}

function renderWidget(props = {}) {
  return render(
    <AttendanceRollup
      studentProfiles={PROFILES}
      branches={BRANCHES}
      syllabusBatchBranches={BRANCH_MAP}
      fetchDailyAttendance={makeFetch()}
      {...props}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('AttendanceRollup', () => {
  it('fetches the latest date on mount and shows it in the date picker', async () => {
    const fetchFn = makeFetch()
    renderWidget({ fetchDailyAttendance: fetchFn })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(null))
    const picker = await screen.findByLabelText(/attendance date/i)
    expect(picker).toHaveValue('2026-06-05')
  })

  it('renders one table per branch that has members', async () => {
    renderWidget()
    expect(await screen.findByRole('heading', { name: 'LWS Pune' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'APJ' })).toBeInTheDocument()
  })

  it('shows present/absent/total counts split by gender', async () => {
    renderWidget()
    // LWS_A: Alice(F,P) Bob(M,A) Carol(F,P)
    const presentF = await screen.findByTestId('cell-LWS Pune-LWS_A-present-female')
    expect(presentF).toHaveTextContent('2')   // Alice + Carol
    expect(screen.getByTestId('cell-LWS Pune-LWS_A-absent-male')).toHaveTextContent('1')   // Bob
    expect(screen.getByTestId('cell-LWS Pune-LWS_A-present-male')).toHaveTextContent('0')
    expect(screen.getByTestId('cell-LWS Pune-LWS_A-total-female')).toHaveTextContent('2')
    expect(screen.getByTestId('cell-LWS Pune-LWS_A-total-male')).toHaveTextContent('1')
  })

  it('expands a cell to reveal the names behind the number', async () => {
    const user = userEvent.setup()
    renderWidget()
    const cell = await screen.findByTestId('cell-LWS Pune-LWS_A-present-female')
    await user.click(within(cell).getByRole('button'))
    const list = await screen.findByTestId('names-LWS Pune-LWS_A-present-female')
    expect(list).toHaveTextContent('Alice')
    expect(list).toHaveTextContent('Carol')
  })

  it('is single-open — opening another cell collapses the first', async () => {
    const user = userEvent.setup()
    renderWidget()
    const presentF = await screen.findByTestId('cell-LWS Pune-LWS_A-present-female')
    await user.click(within(presentF).getByRole('button'))
    expect(screen.getByTestId('names-LWS Pune-LWS_A-present-female')).toBeInTheDocument()

    const absentM = screen.getByTestId('cell-LWS Pune-LWS_A-absent-male')
    await user.click(within(absentM).getByRole('button'))
    expect(screen.getByTestId('names-LWS Pune-LWS_A-absent-male')).toBeInTheDocument()
    expect(screen.queryByTestId('names-LWS Pune-LWS_A-present-female')).not.toBeInTheDocument()
  })

  it('refetches when the date picker changes', async () => {
    const fetchFn = makeFetch(
      { '2026-06-05': ROWS_0605, '2026-06-04': [{ lws_id: 'L1', status: 'A' }] },
      '2026-06-05',
    )
    renderWidget({ fetchDailyAttendance: fetchFn })
    const picker = await screen.findByLabelText(/attendance date/i)
    fireEvent.change(picker, { target: { value: '2026-06-04' } })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('2026-06-04'))
    // Alice now absent on the new date
    await waitFor(() =>
      expect(screen.getByTestId('cell-LWS Pune-LWS_A-absent-female')).toHaveTextContent('1'),
    )
  })

  it('shows an empty state when there is no recorded attendance', async () => {
    const fetchFn = vi.fn(async () => ({ date: null, rows: [] }))
    renderWidget({ fetchDailyAttendance: fetchFn })
    expect(await screen.findByText(/no attendance recorded/i)).toBeInTheDocument()
  })
})
