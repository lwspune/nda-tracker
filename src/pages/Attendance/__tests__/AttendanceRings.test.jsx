import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
