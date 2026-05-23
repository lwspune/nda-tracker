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

  // ── Missed Lectures badge ──────────────────────────────────────

  it('shows "Missed Lectures: N" badge for months that have lecture absences', () => {
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const lectureAbsences = [
      { date: '2026-05-03', subject: 'Maths' },
      { date: '2026-05-07', subject: 'Physics' },
      { date: '2026-05-12', subject: 'Maths' },
    ]
    render(<AttendanceRings attendance={attendance} lectureAbsences={lectureAbsences} />)
    expect(screen.getByRole('button', { name: /missed lectures: 3/i })).toBeInTheDocument()
  })

  it('hides the Missed Lectures badge when a month has zero lecture absences', () => {
    render(<AttendanceRings attendance={[{ date: '2026-05-01', status: 'P' }]} lectureAbsences={[]} />)
    expect(screen.queryByText(/missed lectures/i)).not.toBeInTheDocument()
  })

  it('clicking Missed Lectures reveals subjects with dates, latest-first', () => {
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const lectureAbsences = [
      { date: '2026-05-03', subject: 'Maths' },
      { date: '2026-05-19', subject: 'English' },
      { date: '2026-05-12', subject: 'Physics' },
    ]
    render(<AttendanceRings attendance={attendance} lectureAbsences={lectureAbsences} />)
    fireEvent.click(screen.getByRole('button', { name: /missed lectures: 3/i }))
    const list = screen.getByTestId('lecture-misses-list-2026-05')
    const text = list.textContent.replace(/\s+/g, ' ')
    expect(text).toMatch(/19 May.*English.+12 May.*Physics.+3 May.*Maths/)
  })

  // ── Missed Exams badge ─────────────────────────────────────────

  it('shows "Missed Exams: N" badge for months that have exam absences (joined via exams[])', () => {
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const exams = [
      { id: 'e1', name: 'Mock #3', date: '2026-05-08', batch: 'X' },
      { id: 'e2', name: 'Mock #5', date: '2026-05-22', batch: 'X' },
    ]
    const examAbsences = [
      { exam_id: 'e1', marked_at: '2026-05-08T10:00Z', notified_at: null },
      { exam_id: 'e2', marked_at: '2026-05-22T10:00Z', notified_at: null },
    ]
    render(<AttendanceRings attendance={attendance} exams={exams} examAbsences={examAbsences} />)
    expect(screen.getByRole('button', { name: /missed exams: 2/i })).toBeInTheDocument()
  })

  it('hides Missed Exams when a month has zero exam absences', () => {
    render(<AttendanceRings attendance={[{ date: '2026-05-01', status: 'P' }]} examAbsences={[]} />)
    expect(screen.queryByText(/missed exams/i)).not.toBeInTheDocument()
  })

  it('drops exam absences whose exam_id is unknown AND that have no exam_name on the row', () => {
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const exams = [{ id: 'e1', name: 'Mock #3', date: '2026-05-08' }]
    const examAbsences = [
      { exam_id: 'e1', marked_at: '2026-05-08T10:00Z', notified_at: null },
      { exam_id: 'gone', marked_at: '2026-05-15T10:00Z', notified_at: null }, // exam not in exams[]
    ]
    render(<AttendanceRings attendance={attendance} exams={exams} examAbsences={examAbsences} />)
    expect(screen.getByRole('button', { name: /missed exams: 1/i })).toBeInTheDocument()
  })

  it('uses exam_name + exam_date directly off the row when present (student portal path)', () => {
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const examAbsences = [
      { exam_id: 'e1', exam_name: 'Mock #3', exam_date: '2026-05-08', marked_at: '2026-05-08T10:00Z', notified_at: null },
    ]
    render(<AttendanceRings attendance={attendance} examAbsences={examAbsences} exams={[]} />)
    expect(screen.getByRole('button', { name: /missed exams: 1/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /missed exams: 1/i }))
    const list = screen.getByTestId('exam-misses-list-2026-05')
    expect(list.textContent).toMatch(/Mock #3/)
  })

  it('clicking Missed Exams reveals exam names with dates, latest-first', () => {
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const exams = [
      { id: 'e1', name: 'Mock #3', date: '2026-05-08' },
      { id: 'e2', name: 'Mock #5', date: '2026-05-22' },
    ]
    const examAbsences = [
      { exam_id: 'e1', marked_at: '2026-05-08T10:00Z', notified_at: null },
      { exam_id: 'e2', marked_at: '2026-05-22T10:00Z', notified_at: null },
    ]
    render(<AttendanceRings attendance={attendance} exams={exams} examAbsences={examAbsences} />)
    fireEvent.click(screen.getByRole('button', { name: /missed exams: 2/i }))
    const list = screen.getByTestId('exam-misses-list-2026-05')
    const text = list.textContent.replace(/\s+/g, ' ')
    expect(text).toMatch(/22 May.*Mock #5.+8 May.*Mock #3/)
  })

  // ── Single-open expansion (B1) ─────────────────────────────────

  it('opening Missed Lectures auto-collapses Days Late in the same month', () => {
    const attendance = [
      { date: '2026-05-01', status: 'P' },
      { date: '2026-05-02', status: 'L' },
    ]
    const lectureAbsences = [{ date: '2026-05-03', subject: 'Maths' }]
    render(<AttendanceRings attendance={attendance} lectureAbsences={lectureAbsences} />)
    fireEvent.click(screen.getByRole('button', { name: /days late: 1/i }))
    expect(screen.getByTestId('late-dates-list-2026-05')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /missed lectures: 1/i }))
    expect(screen.queryByTestId('late-dates-list-2026-05')).not.toBeInTheDocument()
    expect(screen.getByTestId('lecture-misses-list-2026-05')).toBeInTheDocument()
  })

  it('opening any chip in another month collapses the open chip in the current month', () => {
    const attendance = [
      { date: '2026-05-02', status: 'L' },
      { date: '2026-04-02', status: 'L' },
    ]
    render(<AttendanceRings attendance={attendance} />)
    const buttons = screen.getAllByRole('button', { name: /days late: 1/i })
    fireEvent.click(buttons[0]) // May
    expect(screen.getByTestId('late-dates-list-2026-05')).toBeInTheDocument()
    fireEvent.click(buttons[1]) // April
    expect(screen.queryByTestId('late-dates-list-2026-05')).not.toBeInTheDocument()
    expect(screen.getByTestId('late-dates-list-2026-04')).toBeInTheDocument()
  })

  it('clicking the same chip twice collapses it (toggle semantics)', () => {
    const lectureAbsences = [{ date: '2026-05-03', subject: 'Maths' }]
    render(<AttendanceRings attendance={[]} lectureAbsences={lectureAbsences} />)
    const btn = screen.getByRole('button', { name: /missed lectures: 1/i })
    fireEvent.click(btn)
    expect(screen.getByTestId('lecture-misses-list-2026-05')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByTestId('lecture-misses-list-2026-05')).not.toBeInTheDocument()
  })
})
