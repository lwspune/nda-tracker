import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ReportRow from '../ReportRow'

function profile(over = {}) {
  return { lwsId: 'LWS-001', name: 'Aksheet Patil', ...over }
}

function report(over = {}) {
  return {
    examTable: [
      { examName: 'Maths', date: '2026-01-09', marks: 17, percentage: 57, attended: true },
      { examName: 'Phys',  date: '2026-01-16', marks: null, percentage: null, attended: false },
    ],
    attendance: {
      present: 20, absent: 1, late: 2, missedLectures: 1,
      totalWorkingDays: 23,
      attendancePercentage: 96,
      lateDates: [], missedLectureDetails: [],
    },
    ...over,
  }
}

describe('ReportRow', () => {
  it('renders name + lws id + at-a-glance counts (exams taken, missed exams, attendance, late)', () => {
    render(<ReportRow profile={profile()} report={report()} onDownload={vi.fn()} />)
    expect(screen.getByText('Aksheet Patil')).toBeInTheDocument()
    expect(screen.getByText('LWS-001')).toBeInTheDocument()
    // exam stats — Exams taken (1 attended), Missed (1)
    expect(screen.getByText('Exams taken')).toBeInTheDocument()
    expect(screen.getByText('Missed exams')).toBeInTheDocument()
    expect(screen.getByText('96%')).toBeInTheDocument()
  })

  it('shows "—" for attendance when there are no working days', () => {
    const r = report({
      attendance: { present: 0, absent: 0, late: 0, missedLectures: 0, totalWorkingDays: 0, attendancePercentage: 0, lateDates: [], missedLectureDetails: [] },
    })
    render(<ReportRow profile={profile()} report={r} onDownload={vi.fn()} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('calls onDownload with the profile + current remark when Download is clicked', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    render(<ReportRow profile={profile()} report={report()} onDownload={onDownload} />)

    const remarkBox = screen.getByLabelText(/Remark for Aksheet Patil/i)
    await user.type(remarkBox, 'Steady month; focus on conics.')
    await user.click(screen.getByRole('button', { name: /download pdf/i }))

    expect(onDownload).toHaveBeenCalledTimes(1)
    const [profArg, remarkArg] = onDownload.mock.calls[0]
    expect(profArg.lwsId).toBe('LWS-001')
    expect(remarkArg).toBe('Steady month; focus on conics.')
  })

  it('passes an empty remark when nothing was typed', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    render(<ReportRow profile={profile()} report={report()} onDownload={onDownload} />)
    await user.click(screen.getByRole('button', { name: /download pdf/i }))
    expect(onDownload.mock.calls[0][1]).toBe('')
  })

  it('disables the download button while a download is in flight', async () => {
    const user = userEvent.setup()
    let resolve
    const onDownload = vi.fn(() => new Promise(r => { resolve = r }))
    render(<ReportRow profile={profile()} report={report()} onDownload={onDownload} />)
    const btn = screen.getByRole('button', { name: /download pdf/i })
    await user.click(btn)
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent(/generating/i)
    resolve()
  })
})
