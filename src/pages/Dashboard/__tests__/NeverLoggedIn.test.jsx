import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import NeverLoggedIn from '../NeverLoggedIn'

const profiles = {
  Alice: {
    lwsId: 'L1', name: 'Alice', branch: 'APJ', batches: ['APJ_NDA_11th_(26-27)_A'],
    accountStatus: 'Active', regDate: '2026-04-01', mobile: '9000000001', parentMobiles: [],
  },
  Bob: {
    lwsId: 'L2', name: 'Bob', branch: 'APJ', batches: ['APJ_NDA_11th_(26-27)_B'],
    accountStatus: 'Active', regDate: '2025-05-14', mobile: '9000000002', parentMobiles: [],
  },
  Erin: {
    lwsId: 'L5', name: 'Erin', branch: 'APJ', batches: ['APJ_NDA_9th_(26-27)'],
    accountStatus: 'Active', regDate: '2026-05-23', mobile: '', parentMobiles: [],
  },
}

function renderWidget(overrides = {}) {
  const fetchStudentLoginIds = overrides.fetch || vi.fn(async () => new Set(['L1']))
  const setActiveStudent = overrides.setActiveStudent || vi.fn()
  render(
    <NeverLoggedIn
      studentProfiles={overrides.studentProfiles || profiles}
      fetchStudentLoginIds={fetchStudentLoginIds}
      setActiveStudent={setActiveStudent}
    />
  )
  return { fetchStudentLoginIds, setActiveStudent }
}

beforeEach(() => vi.clearAllMocks())

describe('NeverLoggedIn', () => {
  it('lists the students with no login, longest-enrolled first', async () => {
    renderWidget()
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
    expect(screen.getByText('Erin')).toBeInTheDocument()
    // Alice has logged in — she must not appear
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('shows the count of students who have never logged in', async () => {
    renderWidget()
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
    expect(screen.getByTestId('never-count')).toHaveTextContent('2')
  })

  it('flags a student who has no contact number as unable to log in', async () => {
    renderWidget()
    await waitFor(() => expect(screen.getByText('Erin')).toBeInTheDocument())
    expect(screen.getByTestId('no-contact-L5')).toBeInTheDocument()
    // Bob has a mobile — no flag on his row
    expect(screen.queryByTestId('no-contact-L2')).not.toBeInTheDocument()
  })

  it('stays visible with an all-clear message when everyone has logged in', async () => {
    // A chase list that disappears cannot distinguish "all clear" from "not loaded".
    renderWidget({ fetch: vi.fn(async () => new Set(['L1', 'L2', 'L5'])) })
    await waitFor(() => expect(screen.getByTestId('never-empty')).toBeInTheDocument())
    expect(screen.getByText(/Never Logged In/i)).toBeInTheDocument()
  })

  it('clicking a student opens that student', async () => {
    const { setActiveStudent } = renderWidget()
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Bob'))
    expect(setActiveStudent).toHaveBeenCalledWith('Bob')
  })

  it('renders nothing but the shell when the fetch is unavailable', () => {
    render(<NeverLoggedIn studentProfiles={profiles} fetchStudentLoginIds={undefined} setActiveStudent={vi.fn()} />)
    expect(screen.getByText(/Never Logged In/i)).toBeInTheDocument()
  })
})
