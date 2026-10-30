import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSave = vi.fn()
const mockStore = { studentList: [], whatsappFlows: {}, saveAttendanceRecords: (...a) => mockSave(...a) }
vi.mock('../../../store/useStore', () => ({ default: (selector) => selector(mockStore) }))

let mockHolidays = []
vi.mock('../../../store/useHolidays', () => ({ default: () => mockHolidays }))

const mockParse = vi.fn()
vi.mock('../../../lib/excel', () => ({ parsePunchReportExcel: (...a) => mockParse(...a) }))

// Rows already written for the date: who was sent (attendance_report_sends)
// and whose attendance is already on file (student_attendance).
let mockAlreadySent = []
let mockOnFile = []
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
    from: (table) => ({
      select: () => ({
        eq: () => Promise.resolve({
          data: (table === 'student_attendance' ? mockOnFile : mockAlreadySent).map(lws_id => ({ lws_id })),
          error: null,
        }),
      }),
    }),
  },
}))

import AttendanceReportCard from '../AttendanceReportCard'

const student = (n, over = {}) => ({
  lws_id: `LWS-${n}`, canonical_name: `Student ${n}`, eis_reg_no: `2500000${String(n).padStart(2, '0')}`,
  branch: 'LWS Pune', account_status: 'Active', mobile: `98765432${String(n).padStart(2, '0')}`,
  parent_mobiles: [], batches: ['Batch A'], ...over,
})
const punch = (n, over = {}) => ({
  regNo: `2500000${String(n).padStart(2, '0')}`, name: `File ${n}`, batch: 'A',
  status: 'P', inTime: '08:30 AM', outTime: '06:00 PM', ...over,
})

function upload() {
  const input = screen.getByLabelText(/punch monitor file/i)
  fireEvent.change(input, { target: { files: [new File(['x'], 'Punch_Monitor_list_23 Oct 2026.xls')] } })
}

function mockFetchOk() {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    return {
      ok: true,
      json: async () => ({ ok: true, sent: body.students.length, skipped: 0, alreadySent: 0, lines: [] }),
    }
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentList = [student(1), student(2), student(3, { branch: 'APJ' }), student(4, { account_status: 'Block' })]
  mockStore.whatsappFlows = {}
  mockHolidays = []
  mockAlreadySent = []
  mockOnFile = []
  mockSave.mockImplementation(async records => ({ upserted: records.length, lateProtected: 0, error: null }))
  mockParse.mockResolvedValue({
    date: '2026-10-23',
    rows: [punch(1), punch(2, { status: 'A', inTime: '', outTime: '' }), punch(3), punch(4), punch(99, { name: 'Shravani Vedpathak' })],
    duplicates: ['250000001'],
  })
  mockFetchOk()
})

describe('AttendanceReportCard — preview', () => {
  it("shows the report date and each student's message values", async () => {
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByText(/23 Oct 2026/)).toBeInTheDocument()
    const row1 = screen.getByRole('row', { name: /Student 1/ })
    expect(within(row1).getByText('08:30 AM')).toBeInTheDocument()
    expect(within(row1).getByText('06:00 PM')).toBeInTheDocument()
    const row2 = screen.getByRole('row', { name: /Student 2/ })
    expect(within(row2).getAllByText('Absent')).toHaveLength(2)
  })

  it('lists who is left out and why', async () => {
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByText(/Shravani Vedpathak/)).toBeInTheDocument()
    expect(screen.getByText(/not in the tracker/i)).toBeInTheDocument()
    expect(screen.getByText(/other branch/i)).toBeInTheDocument()
    expect(screen.getByText(/blocked/i)).toBeInTheDocument()
    expect(screen.getByText(/repeated in the file/i)).toBeInTheDocument()
  })

  it('shows the parser error and offers no send', async () => {
    mockParse.mockRejectedValue(new Error('Cannot find the "Out Time" column in the punch file'))
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByText(/Out Time/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^send to/i })).not.toBeInTheDocument()
  })

  it('refuses a file whose date cannot be read', async () => {
    mockParse.mockResolvedValue({ date: null, rows: [punch(1)], duplicates: [] })
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByText(/cannot read the report date/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^send to/i })).not.toBeInTheDocument()
  })
})

describe('AttendanceReportCard — guards before sending', () => {
  it('needs a tick before sending a file that is not from today', async () => {
    render(<AttendanceReportCard today="2026-10-24" />)
    upload()
    const send = await screen.findByRole('button', { name: /send to 2 students/i })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/not today/i))
    expect(send).toBeEnabled()
  })

  it('needs a tick before sending on a Sunday', async () => {
    mockParse.mockResolvedValue({ date: '2026-10-25', rows: [punch(1)], duplicates: [] })
    render(<AttendanceReportCard today="2026-10-25" />)
    upload()
    const send = await screen.findByRole('button', { name: /send to 1 student/i })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Sunday/))
    expect(send).toBeEnabled()
  })

  it('needs a tick before sending on a holiday', async () => {
    mockHolidays = [{ id: 'h', name: 'Diwali', fromDate: '2026-10-23', toDate: '2026-10-23', branch: 'LWS Pune', batchNames: [] }]
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    const send = await screen.findByRole('button', { name: /send to 2 students/i })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Diwali/))
    expect(send).toBeEnabled()
  })

  it('is disabled, not hidden, when the flow is switched off', async () => {
    mockStore.whatsappFlows = { attendanceReport: { enabled: false } }
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    const send = await screen.findByRole('button', { name: /send to 2 students/i })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('title', expect.stringMatching(/switched off/))
  })

  it('leaves out students already sent for this date', async () => {
    mockAlreadySent = ['LWS-1']
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByRole('button', { name: /send to 1 student/i })).toBeInTheDocument()
    expect(screen.getByText(/1 already sent/i)).toBeInTheDocument()
  })
})

describe('AttendanceReportCard — sending', () => {
  it('posts ids and punch times only, to the attendance-report kind', async () => {
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /send to 2 students/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/send-attendance-alerts')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({
      kind: 'attendance-report',
      date: '2026-10-23',
      students: [
        { lwsId: 'LWS-1', status: 'P', inTime: '08:30 AM', outTime: '06:00 PM' },
        { lwsId: 'LWS-2', status: 'A', inTime: '', outTime: '' },
      ],
    })
    expect(await screen.findByText(/Sent 2/)).toBeInTheDocument()
  })

  it('sends a long list in groups', async () => {
    const many = Array.from({ length: 23 }, (_, i) => i + 10)
    mockStore.studentList = many.map(n => student(n))
    mockParse.mockResolvedValue({ date: '2026-10-23', rows: many.map(n => punch(n)), duplicates: [] })
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /send to 23 students/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const sizes = fetch.mock.calls.map(([, init]) => JSON.parse(init.body).students.length)
    expect(sizes).toEqual([10, 10, 3])
  })

  it('a test send goes to the typed number with one present and one absent student', async () => {
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    await screen.findByRole('button', { name: /send to 2 students/i })
    fireEvent.change(screen.getByLabelText(/test number/i), { target: { value: '9000000001' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.redirectTo).toBe('9000000001')
    expect(body.students.map(s => s.status)).toEqual(['P', 'A'])
  })

  it('stops and says so when the server refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, error: 'Daily attendance report is switched off in Settings → WhatsApp' }) })))
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /send to 2 students/i }))
    expect(await screen.findByText(/switched off in Settings/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('AttendanceReportCard — saving attendance', () => {
  const SAVED = [
    { lws_id: 'LWS-1', date: '2026-10-23', status: 'P' },
    { lws_id: 'LWS-2', date: '2026-10-23', status: 'A' },
    { lws_id: 'LWS-4', date: '2026-10-23', status: 'P' },
  ]

  it("saves each matched LWS Pune student's P or A, blocked included, and sends nothing", async () => {
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /save attendance only/i }))
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(SAVED))
    expect(await screen.findByText(/attendance saved for 3 students/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('saves first, then sends', async () => {
    const order = []
    mockSave.mockImplementation(async records => { order.push('save'); return { upserted: records.length, lateProtected: 0, error: null } })
    const sendOk = fetch.getMockImplementation()
    fetch.mockImplementation(async (...a) => { order.push('send'); return sendOk(...a) })
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /save & send to 2 students/i }))
    expect(await screen.findByText(/Sent 2/)).toBeInTheDocument()
    expect(mockSave).toHaveBeenCalledWith(SAVED)
    expect(order).toEqual(['save', 'send'])
  })

  it('does not send when the attendance could not be saved', async () => {
    mockSave.mockResolvedValue({ upserted: 0, lateProtected: 0, error: 'permission denied' })
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /save & send to 2 students/i }))
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says how many Late marks were kept', async () => {
    mockSave.mockResolvedValue({ upserted: 2, lateProtected: 1, error: null })
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    fireEvent.click(await screen.findByRole('button', { name: /save attendance only/i }))
    expect(await screen.findByText(/1 late mark kept/i)).toBeInTheDocument()
  })

  it('a test send saves nothing', async () => {
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    await screen.findByRole('button', { name: /save attendance only/i })
    fireEvent.change(screen.getByLabelText(/test number/i), { target: { value: '9000000001' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('needs the same tick before saving a file that is not from today', async () => {
    render(<AttendanceReportCard today="2026-10-24" />)
    upload()
    const save = await screen.findByRole('button', { name: /save attendance only/i })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/not today/i))
    expect(save).toBeEnabled()
  })

  it('still saves when the WhatsApp flow is switched off', async () => {
    mockStore.whatsappFlows = { attendanceReport: { enabled: false } }
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByRole('button', { name: /save attendance only/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /save & send/i })).toBeDisabled()
  })

  it('still saves when everyone was already sent, so a later file can correct the day', async () => {
    mockAlreadySent = ['LWS-1', 'LWS-2']
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByRole('button', { name: /all sent for this date/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /save attendance only/i })).toBeEnabled()
  })

  it('warns when the day already has attendance on file', async () => {
    mockOnFile = ['LWS-1', 'LWS-2', 'LWS-77']
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByText(/2 of these students already have attendance for this date/i)).toBeInTheDocument()
  })

  it('lists a status it will not save', async () => {
    mockParse.mockResolvedValue({ date: '2026-10-23', rows: [punch(1), punch(2, { status: 'H' })], duplicates: [] })
    render(<AttendanceReportCard today="2026-10-23" />)
    upload()
    expect(await screen.findByText(/not saved/i)).toBeInTheDocument()
    expect(screen.getByText(/Student 2 \(H\)/)).toBeInTheDocument()
  })
})
