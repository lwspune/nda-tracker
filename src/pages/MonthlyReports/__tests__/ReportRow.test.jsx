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

function renderRow(over = {}) {
  const props = {
    profile: profile(),
    report: report(),
    remark: '',
    onRemarkChange: vi.fn(),
    onDownload: vi.fn(),
    ...over,
  }
  render(<ReportRow {...props} />)
  return props
}

describe('ReportRow', () => {
  it('renders name + lws id + at-a-glance counts', () => {
    renderRow()
    expect(screen.getByText('Aksheet Patil')).toBeInTheDocument()
    expect(screen.getByText('LWS-001')).toBeInTheDocument()
    expect(screen.getByText('Exams taken')).toBeInTheDocument()
    expect(screen.getByText('Missed exams')).toBeInTheDocument()
    expect(screen.getByText('96%')).toBeInTheDocument()
  })

  it('shows "—" for attendance when there are no working days', () => {
    renderRow({
      report: report({
        attendance: { present: 0, absent: 0, late: 0, missedLectures: 0,
                      totalWorkingDays: 0, attendancePercentage: 0,
                      lateDates: [], missedLectureDetails: [] },
      }),
    })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('calls onRemarkChange as the user types in the remark box (controlled input)', async () => {
    const user = userEvent.setup()
    const onRemarkChange = vi.fn()
    renderRow({ onRemarkChange })
    await user.type(screen.getByLabelText(/Remark for Aksheet Patil/i), 'X')
    // Controlled — each keystroke fires onRemarkChange with the appended value.
    expect(onRemarkChange).toHaveBeenCalledWith('X')
  })

  it('displays the parent-supplied remark value', () => {
    renderRow({ remark: 'Strong improvement this month.' })
    expect(screen.getByLabelText(/Remark for Aksheet Patil/i).value).toBe('Strong improvement this month.')
  })

  it('calls onDownload(profile) when Download is clicked (parent already holds the remark)', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    renderRow({ onDownload })
    await user.click(screen.getByRole('button', { name: /download pdf/i }))
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onDownload.mock.calls[0][0].lwsId).toBe('LWS-001')
  })

  it('disables the download button while a download is in flight', async () => {
    const user = userEvent.setup()
    let resolve
    const onDownload = vi.fn(() => new Promise(r => { resolve = r }))
    renderRow({ onDownload })
    const btn = screen.getByRole('button', { name: /download pdf/i })
    await user.click(btn)
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent(/generating/i)
    resolve()
  })
})
