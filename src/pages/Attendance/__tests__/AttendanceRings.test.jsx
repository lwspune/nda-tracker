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

  it('a month with only L rows still renders a ring', () => {
    // Ensures L months are not filtered out of the rings list entirely
    const data = [{ date: '2026-05-05', status: 'L' }]
    render(<AttendanceRings attendance={data} />)
    expect(screen.getByText(/May/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /days late: 1/i })).toBeInTheDocument()
  })

  // ── Months with no register ────────────────────────────────────

  it('a month with no P/A days reads "no register", never 0%', () => {
    // Only an exam absence: no register was taken, so there is no percentage to show.
    // Rendering 0% told students they had missed the whole month.
    const attendance = [{ date: '2026-05-01', status: 'P' }]
    const examAbsences = [{ exam_id: 'e1', exam_name: 'Mock #1', exam_date: '2025-09-14' }]
    render(<AttendanceRings attendance={attendance} examAbsences={examAbsences} />)
    const sep = screen.getByTestId('ring-2025-09')
    expect(sep).toHaveTextContent(/no register/i)
    expect(sep).not.toHaveTextContent('0%')
    // the absence itself is real and stays visible
    expect(screen.getByRole('button', { name: /missed exams: 1/i })).toBeInTheDocument()
  })

  it('a month where every register day was absent still reads 0%', () => {
    render(<AttendanceRings attendance={[{ date: '2026-05-01', status: 'A' }, { date: '2026-05-02', status: 'A' }]} />)
    expect(screen.getByTestId('ring-2026-05')).toHaveTextContent('0%')
    expect(screen.queryByText(/no register/i)).not.toBeInTheDocument()
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

  // ── Homework badge ─────────────────────────────────────────────

  it('shows "Homework: N" badge for months that have flagged homework (resolved or not)', () => {
    const attendance = [{ date: '2026-06-01', status: 'P' }]
    const homework = [
      { date: '2026-06-04', subject: 'Maths', chapter: 'Statistic', type: 'homework', resolved_at: '2026-06-04T17:00:00Z' },
      { date: '2026-06-10', subject: 'Physics', chapter: 'Laws', type: 'notes', resolved_at: null },
    ]
    render(<AttendanceRings attendance={attendance} homework={homework} />)
    // counts the resolved one too
    expect(screen.getByRole('button', { name: /homework: 2/i })).toBeInTheDocument()
  })

  it('hides the Homework badge when a month has zero homework rows', () => {
    render(<AttendanceRings attendance={[{ date: '2026-06-01', status: 'P' }]} homework={[]} />)
    expect(screen.queryByText(/homework:/i)).not.toBeInTheDocument()
  })

  it('clicking Homework reveals subject · chapter with dates, latest-first', () => {
    const attendance = [{ date: '2026-06-01', status: 'P' }]
    const homework = [
      { date: '2026-06-04', subject: 'Maths', chapter: 'Statistic', type: 'homework', resolved_at: null },
      { date: '2026-06-12', subject: 'Physics', chapter: 'Laws', type: 'notes', resolved_at: null },
    ]
    render(<AttendanceRings attendance={attendance} homework={homework} />)
    fireEvent.click(screen.getByRole('button', { name: /homework: 2/i }))
    const list = screen.getByTestId('homework-list-2026-06')
    const text = list.textContent.replace(/\s+/g, ' ')
    expect(text).toMatch(/12 Jun.*Physics.*Laws.+4 Jun.*Maths.*Statistic/)
  })

  // ── Compact layout ─────────────────────────────────────────────

  it('chips show a short label and keep the full wording as their accessible name', () => {
    const attendance = [
      { date: '2026-05-01', status: 'P' },
      { date: '2026-05-02', status: 'L' },
    ]
    const lectureAbsences = [{ date: '2026-05-03', subject: 'Maths' }, { date: '2026-05-04', subject: 'Maths' }]
    const examAbsences = [{ exam_id: 'e1', exam_name: 'Mock #1', exam_date: '2026-05-08' }]
    const homework = [{ date: '2026-05-04', subject: 'Maths', chapter: 'Sets' }]
    render(<AttendanceRings attendance={attendance} lectureAbsences={lectureAbsences}
                            examAbsences={examAbsences} homework={homework} />)
    expect(screen.getByRole('button', { name: /days late: 1/i })).toHaveTextContent(/^Late 1/)
    expect(screen.getByRole('button', { name: /missed lectures: 2/i })).toHaveTextContent(/^Lec 2/)
    expect(screen.getByRole('button', { name: /missed exams: 1/i })).toHaveTextContent(/^Exam 1/)
    expect(screen.getByRole('button', { name: /homework: 1/i })).toHaveTextContent(/^HW 1/)
  })

  it('an opened list renders below the grid, named by kind and month, not inside the ring column', () => {
    const lectureAbsences = [{ date: '2026-05-03', subject: 'Maths' }]
    render(<AttendanceRings attendance={[{ date: '2026-05-01', status: 'P' }]} lectureAbsences={lectureAbsences} />)
    const chip = screen.getByRole('button', { name: /missed lectures: 1/i })
    fireEvent.click(chip)
    const list = screen.getByTestId('lecture-misses-list-2026-05')
    expect(screen.getByTestId('ring-2026-05')).not.toContainElement(list)
    expect(list).toHaveTextContent(/missed lectures · May 26/i)
    expect(chip).toHaveAttribute('aria-controls', list.id)
  })

  it('has no second "My Attendance" heading under the card title', () => {
    render(<AttendanceRings attendance={ATTENDANCE} />)
    expect(screen.queryByText(/my attendance/i)).not.toBeInTheDocument()
  })

  // ── Latest two months by default ───────────────────────────────

  const THREE_MONTHS = [
    { date: '2026-03-02', status: 'L' },
    { date: '2026-04-01', status: 'P' },
    { date: '2026-05-01', status: 'P' },
  ]
  const monthLabels = () => screen.getAllByTestId('ring-month-label').map(el => el.textContent)

  it('shows only the two latest months until asked for the rest', () => {
    render(<AttendanceRings attendance={THREE_MONTHS} />)
    expect(monthLabels()).toEqual(['May 26', 'Apr 26'])
    const more = screen.getByRole('button', { name: /show all 3 months/i })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(more)
    expect(monthLabels()).toEqual(['May 26', 'Apr 26', 'Mar 26'])
    const fewer = screen.getByRole('button', { name: /show fewer/i })
    expect(fewer).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(fewer)
    expect(monthLabels()).toEqual(['May 26', 'Apr 26'])
  })

  it('offers no toggle when there are two months or fewer', () => {
    render(<AttendanceRings attendance={ATTENDANCE} />)
    expect(screen.queryByRole('button', { name: /show all|show fewer/i })).not.toBeInTheDocument()
  })

  it('hiding a month also closes its open list', () => {
    render(<AttendanceRings attendance={THREE_MONTHS} />)
    fireEvent.click(screen.getByRole('button', { name: /show all 3 months/i }))
    fireEvent.click(screen.getByRole('button', { name: /days late: 1/i }))
    expect(screen.getByTestId('late-dates-list-2026-03')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show fewer/i }))
    expect(screen.queryByTestId('late-dates-list-2026-03')).not.toBeInTheDocument()
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
