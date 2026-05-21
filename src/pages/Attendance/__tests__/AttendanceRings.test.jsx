import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AttendanceRings from '../AttendanceRings'

const ATTENDANCE = [
  { date: '2026-04-27', status: 'P' },
  { date: '2026-04-28', status: 'A' },
  { date: '2026-04-29', status: 'P' },
  { date: '2026-05-01', status: 'P' },
  { date: '2026-05-05', status: 'P' },
  { date: '2026-05-06', status: 'A' },
  { date: '2026-05-07', status: 'P' },
]

describe('AttendanceRings', () => {
  it('renders one ring per calendar month present in data', () => {
    render(<AttendanceRings attendance={ATTENDANCE} />)
    // April and May months should both appear as labels
    expect(screen.getByText(/Apr/i)).toBeInTheDocument()
    expect(screen.getByText(/May/i)).toBeInTheDocument()
  })

  it('shows correct percentage in ring centre for each month', () => {
    render(<AttendanceRings attendance={ATTENDANCE} />)
    // April: 2P 1A → 67%
    expect(screen.getByText('67%')).toBeInTheDocument()
    // May: 3P 1A → 75%
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('shows empty state when no attendance records', () => {
    render(<AttendanceRings attendance={[]} />)
    expect(screen.getByText(/No attendance/i)).toBeInTheDocument()
  })

  it('shows empty state when attendance prop is undefined', () => {
    render(<AttendanceRings />)
    expect(screen.getByText(/No attendance/i)).toBeInTheDocument()
  })

  it('renders rings sorted by month (latest first)', () => {
    render(<AttendanceRings attendance={ATTENDANCE} />)
    const labels = screen.getAllByTestId('ring-month-label').map(el => el.textContent)
    expect(labels[0]).toMatch(/May/i)
    expect(labels[1]).toMatch(/Apr/i)
  })

  it('counts only P and A — no status leaks into total', () => {
    // single month, 2P 0A → 100%
    const data = [
      { date: '2026-06-01', status: 'P' },
      { date: '2026-06-02', status: 'P' },
    ]
    render(<AttendanceRings attendance={data} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  // ── Days-late badge ────────────────────────────────────────────

  it('shows "Days late: N" badge under months that have L rows', () => {
    const data = [
      { date: '2026-05-01', status: 'P' },
      { date: '2026-05-05', status: 'L' },
      { date: '2026-05-07', status: 'L' },
      { date: '2026-05-08', status: 'L' },
    ]
    render(<AttendanceRings attendance={data} />)
    expect(screen.getByRole('button', { name: /days late: 3/i })).toBeInTheDocument()
  })

  it('hides the days-late badge when a month has zero L rows', () => {
    const data = [
      { date: '2026-05-01', status: 'P' },
      { date: '2026-05-05', status: 'A' },
    ]
    render(<AttendanceRings attendance={data} />)
    expect(screen.queryByText(/days late/i)).not.toBeInTheDocument()
  })

  it('clicking the badge reveals the late dates in latest-first DD MMM format', () => {
    const data = [
      { date: '2026-05-05', status: 'L' },
      { date: '2026-05-19', status: 'L' },
      { date: '2026-05-12', status: 'L' },
    ]
    render(<AttendanceRings attendance={data} />)
    // Initially the dates list is not visible
    expect(screen.queryByText(/19 May/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /days late: 3/i }))
    const list = screen.getByTestId('late-dates-list-2026-05')
    expect(list.textContent.replace(/\s+/g, ' ')).toMatch(/19 May.+12 May.+5 May/)
  })

  it('clicking the badge a second time collapses the dates list', () => {
    const data = [{ date: '2026-05-05', status: 'L' }]
    render(<AttendanceRings attendance={data} />)
    const btn = screen.getByRole('button', { name: /days late: 1/i })
    fireEvent.click(btn)
    expect(screen.getByTestId('late-dates-list-2026-05')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByTestId('late-dates-list-2026-05')).not.toBeInTheDocument()
  })

  it('expanding one month auto-collapses the previously expanded month', () => {
    const data = [
      { date: '2026-04-10', status: 'L' },
      { date: '2026-05-05', status: 'L' },
    ]
    render(<AttendanceRings attendance={data} />)
    // Rings are sorted latest-first, so [0] is May, [1] is April
    const buttons = screen.getAllByRole('button', { name: /days late: 1/i })
    fireEvent.click(buttons[0])
    expect(screen.getByTestId('late-dates-list-2026-05')).toBeInTheDocument()

    fireEvent.click(buttons[1])
    expect(screen.queryByTestId('late-dates-list-2026-05')).not.toBeInTheDocument()
    expect(screen.getByTestId('late-dates-list-2026-04')).toBeInTheDocument()
  })

  it('a month with only L rows still renders a ring (denominator P+A = 0 → 0%)', () => {
    // Ensures L months are not filtered out of the rings list entirely
    const data = [{ date: '2026-05-05', status: 'L' }]
    render(<AttendanceRings attendance={data} />)
    expect(screen.getByText(/May/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /days late: 1/i })).toBeInTheDocument()
  })
})
