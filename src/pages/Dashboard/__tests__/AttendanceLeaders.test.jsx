import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AttendanceLeaders from '../AttendanceLeaders'

const profiles = {
  Alice: { lwsId: 'L1', name: 'Alice', branch: 'APJ',      accountStatus: 'Active' },
  Bob:   { lwsId: 'L2', name: 'Bob',   branch: 'LWS Pune', accountStatus: 'Active' },
}
const rows = {
  attendanceRows: [{ lws_id: 'L1', status: 'A' }, { lws_id: 'L1', status: 'A' }, { lws_id: 'L2', status: 'L' }],
  lectureRows: [{ lws_id: 'L2' }],
  homeworkRows: [],
}

function renderWidget(overrides = {}) {
  const fetchAttendanceLeadersData = overrides.fetch || vi.fn(async () => rows)
  const setActiveStudent = overrides.setActiveStudent || vi.fn()
  render(
    <AttendanceLeaders
      studentProfiles={profiles}
      fetchAttendanceLeadersData={fetchAttendanceLeadersData}
      setActiveStudent={setActiveStudent}
    />
  )
  return { fetchAttendanceLeadersData, setActiveStudent }
}

beforeEach(() => vi.clearAllMocks())

describe('AttendanceLeaders', () => {
  it('renders the four boards and the leader names + counts', async () => {
    renderWidget()
    expect(screen.getByText('Attendance Leaders')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    // Alice: 2 absences in the Most Absent board
    expect(screen.getByText('2 days')).toBeInTheDocument()
    // Bob: 1 late + 1 lecture miss
    expect(screen.getByText('1 lectures')).toBeInTheDocument()
  })

  it('shows an empty state for a board with no records', async () => {
    renderWidget()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    // Homework board has no rows
    expect(screen.getByText('No records in this window.')).toBeInTheDocument()
  })

  it('clicking a leader opens that student', async () => {
    const { setActiveStudent } = renderWidget()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Alice'))
    expect(setActiveStudent).toHaveBeenCalledWith('Alice')
  })

  it('defaults to a 30-day window and refetches when toggled to 7 days', async () => {
    const fetch = vi.fn(async () => rows)
    renderWidget({ fetch })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const first = fetch.mock.calls[0][0]

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const second = fetch.mock.calls[1][0]
    // 7-day window starts later (more recent) than the 30-day window
    expect(second > first).toBe(true)
  })
})
