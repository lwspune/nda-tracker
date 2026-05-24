import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the PDF download lib BEFORE importing the page — the page calls it
// on the Download button click.
const mockDownload = vi.fn(() => Promise.resolve('file.pdf'))
vi.mock('../../../lib/monthlyReportPdf', () => ({
  downloadMonthlyReportPdf: (...args) => mockDownload(...args),
}))

const mockZipDownload = vi.fn(() => Promise.resolve('reports.zip'))
const mockZipFilename = vi.fn((batch, label) => `${batch}_${label}_Reports.zip`)
vi.mock('../../../lib/monthlyReportZip', () => ({
  downloadMonthlyReportsZip: (...args) => mockZipDownload(...args),
  zipFilename: (...args) => mockZipFilename(...args),
}))

// Mock the store.
const mockFetch = vi.fn()
let mockState = {}
vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockState),
}))

import MonthlyReportsPage from '../index'

function activeStudent(name, lwsId, over = {}) {
  return {
    lwsId, name,
    accountStatus: 'Active',
    batches: ['LWS_NDA_2Y_(26-28)_A'],
    regDate: '2025-11-01',
    branch: 'LWS Pune',
    nameVariants: [name],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState = {
    exams: [],
    studentProfiles: {
      'Alice': activeStudent('Alice', 'LWS-001'),
      'Bob':   activeStudent('Bob',   'LWS-002'),
    },
    syllabusBatches: ['LWS_NDA_2Y_(26-28)_A', 'APJ_NDA_2Y_(26-28)'],
    syllabusPrograms: [],
    batchChapterTimelines: {},
    fetchMonthlyReportData: mockFetch,
  }
  mockFetch.mockResolvedValue({
    attendanceByLwsId: {}, lectureAbsencesByLwsId: {}, examAbsencesByLwsId: {},
  })
})

describe('MonthlyReportsPage', () => {
  it('renders month + batch pickers and a Generate button', () => {
    render(<MonthlyReportsPage />)
    expect(screen.getByLabelText(/^Month$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Batch$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^generate$/i })).toBeInTheDocument()
  })

  it('shows the cohort count after picking a batch', () => {
    render(<MonthlyReportsPage />)
    // The "2" lives in a <span> inside the cohort line — match flexibly.
    const cohortLine = screen.getByText(/cohort:/i).closest('div')
    expect(cohortLine.textContent).toMatch(/2\s*student/i)
  })

  it('disables Generate when no batch is selected', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    const batchSel = screen.getByLabelText(/^Batch$/i)
    await user.selectOptions(batchSel, '')
    const btn = screen.getByRole('button', { name: /^generate$/i })
    expect(btn).toBeDisabled()
  })

  it('triggers fetchMonthlyReportData with month + cohort lws_ids when Generate is clicked', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [month, lwsIds] = mockFetch.mock.calls[0]
    expect(typeof month).toBe('string')
    expect(month).toMatch(/^\d{4}-\d{2}$/)
    expect(lwsIds.sort()).toEqual(['LWS-001', 'LWS-002'])
  })

  it('renders one ReportRow per cohort student after Generate', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('clicking Download on a row calls downloadMonthlyReportPdf with a built report + remark', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    const downloadBtns = screen.getAllByRole('button', { name: /download pdf/i })
    await user.click(downloadBtns[0])

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
    const [reportArg, optsArg] = mockDownload.mock.calls[0]
    expect(reportArg.meta.name).toBeTruthy()
    expect(reportArg.meta.month).toMatch(/^\d{4}-\d{2}$/)
    expect(optsArg).toEqual({ remark: '' })
  })

  it('typed remarks are passed through to downloadMonthlyReportPdf per student', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    await user.type(screen.getByLabelText(/Remark for Alice/i), 'Solid start.')
    const downloadBtns = screen.getAllByRole('button', { name: /download pdf/i })
    await user.click(downloadBtns[0])

    await waitFor(() => expect(mockDownload).toHaveBeenCalled())
    expect(mockDownload.mock.calls[0][1]).toEqual({ remark: 'Solid start.' })
  })

  it('clicking "Download all as ZIP" calls downloadMonthlyReportsZip with one item per cohort student', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /download all as zip/i }))
    await waitFor(() => expect(mockZipDownload).toHaveBeenCalledTimes(1))

    const [items, zipName] = mockZipDownload.mock.calls[0]
    expect(items).toHaveLength(2)
    expect(items.map(i => i.report.meta.name).sort()).toEqual(['Alice', 'Bob'])
    expect(items.every(i => i.filename.endsWith('.pdf'))).toBe(true)
    expect(zipName).toMatch(/_Reports\.zip$/)
  })

  it('typed remarks land in the ZIP payload per student', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    await user.type(screen.getByLabelText(/Remark for Alice/i), 'Solid start.')
    await user.type(screen.getByLabelText(/Remark for Bob/i),   'Needs review.')
    await user.click(screen.getByRole('button', { name: /download all as zip/i }))

    await waitFor(() => expect(mockZipDownload).toHaveBeenCalled())
    const [items] = mockZipDownload.mock.calls[0]
    const byName = Object.fromEntries(items.map(i => [i.report.meta.name, i.remark]))
    expect(byName).toEqual({ Alice: 'Solid start.', Bob: 'Needs review.' })
  })

  it('"Download all as ZIP" button does not appear before Generate', () => {
    render(<MonthlyReportsPage />)
    expect(screen.queryByRole('button', { name: /download all as zip/i })).not.toBeInTheDocument()
  })

  it('shows an error banner when fetchMonthlyReportData returns null', async () => {
    mockFetch.mockResolvedValueOnce(null)
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument())
  })

  it('changing the month after generating clears the preview list (so user does not see mismatched data)', async () => {
    const user = userEvent.setup()
    render(<MonthlyReportsPage />)
    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    await user.clear(screen.getByLabelText(/^Month$/i))
    await user.type(screen.getByLabelText(/^Month$/i), '2026-03')

    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('shows empty-cohort message when no Active in-batch students are present', () => {
    mockState.studentProfiles = {}
    render(<MonthlyReportsPage />)
    const cohortLine = screen.getByText(/cohort:/i).closest('div')
    expect(cohortLine.textContent).toMatch(/0\s*student/i)
    expect(screen.getByRole('button', { name: /^generate$/i })).toBeDisabled()
  })
})
