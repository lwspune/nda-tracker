import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const state = {
  activePage: 'monthlyReports',
  setActivePage: vi.fn(),
  loadRemoteData: vi.fn(),
  loadExamsFromSupabase: vi.fn().mockResolvedValue(),
  loadQuizzesFromSupabase: vi.fn().mockResolvedValue(),
  timetableTeachers: [],
}
vi.mock('../store/useStore', () => ({
  default: selector => selector(state),
}))
vi.mock('../store/persist', () => ({ loadFromSupabase: vi.fn().mockResolvedValue(null) }))

// Stub the pages and chrome: this suite is about which page a teacher may reach.
vi.mock('../pages/MonthlyReports', () => ({ default: () => <div data-testid="monthly-reports" /> }))
vi.mock('../pages/Dashboard', () => ({ default: () => <div data-testid="dashboard" /> }))
vi.mock('../components/layout/Sidebar', () => ({
  default: ({ grants = [] }) => <div data-testid="sidebar">{grants.join(',')}</div>,
}))
vi.mock('../components/layout/StaleDataBanner', () => ({ default: () => null }))

import { TeacherPortal } from '../App'

const SESSION = { user: { email: 'asha@lwspune.com' } }

beforeEach(() => {
  state.activePage = 'monthlyReports'
})

describe('TeacherPortal — Monthly Reports permission', () => {
  it('opens Monthly Reports for a teacher with the reports switch', async () => {
    state.timetableTeachers = [{ id: 't1', email: 'asha@lwspune.com', reportsAccess: true }]
    render(<TeacherPortal session={SESSION} onLogout={vi.fn()} />)
    expect(await screen.findByTestId('monthly-reports')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toHaveTextContent('reports')
  })

  // Without the switch the page is not in the teacher's map at all, so even a
  // stale activePage lands on the Dashboard rather than the reports.
  it('falls back to the Dashboard for a teacher without it', async () => {
    state.timetableTeachers = [{ id: 't1', email: 'asha@lwspune.com', timetableAccess: true }]
    render(<TeacherPortal session={SESSION} onLogout={vi.fn()} />)
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('monthly-reports')).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).not.toHaveTextContent('reports')
  })
})
