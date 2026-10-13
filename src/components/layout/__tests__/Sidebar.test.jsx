import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import Sidebar from '../Sidebar'
import { ModeContext } from '../../../context/ModeContext'

const state = {
  activePage: 'dashboard',
  setActivePage: vi.fn(),
  exams: [],
  studentProfiles: {},
  isSuperadmin: false,
}
vi.mock('../../../store/useStore', () => ({
  default: selector => selector(state),
}))

function renderAs(mode = 'admin', props = {}) {
  return render(
    <ModeContext.Provider value={mode}>
      <Sidebar {...props} />
    </ModeContext.Provider>,
  )
}

const quickLinks = () => screen.getByRole('navigation', { name: 'Quick links' })

describe('Sidebar — mobile bottom bar', () => {
  beforeEach(() => {
    state.activePage = 'dashboard'
    state.isSuperadmin = false
    state.setActivePage.mockClear()
  })

  // Every page used to sit in one row: 14 buttons on a 390px phone pushed the
  // page sideways and the bar off-screen. Four links + More fit.
  it('shows four main links and a More button for an admin', () => {
    renderAs('admin')
    const labels = within(quickLinks()).getAllByRole('button').map(b => b.textContent)
    expect(labels).toEqual([
      expect.stringContaining('Dashboard'),
      expect.stringContaining('Exams'),
      expect.stringContaining('Students'),
      expect.stringContaining('Attendance'),
      expect.stringContaining('More'),
    ])
  })

  it("leads with a teacher's own lectures", () => {
    renderAs('teacher')
    const labels = within(quickLinks()).getAllByRole('button').map(b => b.textContent)
    expect(labels).toHaveLength(5)
    expect(labels[0]).toContain('My Lectures')
    expect(labels[4]).toContain('More')
  })

  it('More opens the full menu, which reaches every page', () => {
    renderAs('admin')
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()

    const more = within(quickLinks()).getByRole('button', { name: /more/i })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)

    expect(more).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('dialog', { name: 'Menu' })
    fireEvent.click(within(menu).getByRole('button', { name: /settings/i }))
    expect(state.setActivePage).toHaveBeenCalledWith('settings')
  })

  it('marks More as current when the open page is not one of the four', () => {
    state.activePage = 'settings'
    renderAs('admin')
    const more = within(quickLinks()).getByRole('button', { name: /more/i })
    expect(more).toHaveAttribute('aria-current', 'page')
    expect(within(quickLinks()).getByRole('button', { name: /dashboard/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('marks the main link as current when its page is open', () => {
    state.activePage = 'students'
    renderAs('admin')
    expect(within(quickLinks()).getByRole('button', { name: /students/i }))
      .toHaveAttribute('aria-current', 'page')
    expect(within(quickLinks()).getByRole('button', { name: /more/i }))
      .not.toHaveAttribute('aria-current')
  })
})
