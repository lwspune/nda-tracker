import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  getLectureAbsencesForStudent: vi.fn(),
  getExamAbsencesForStudent:    vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import RecentIncidents from '../RecentIncidents'

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.getLectureAbsencesForStudent.mockResolvedValue([])
  mockStore.getExamAbsencesForStudent.mockResolvedValue([])
})

describe('RecentIncidents', () => {
  it('renders nothing when no incidents', async () => {
    const { container } = render(
      <RecentIncidents lwsId="LWS-001" attendance={[]} />
    )
    await waitFor(() => expect(mockStore.getLectureAbsencesForStudent).toHaveBeenCalled())
    expect(container.querySelector('.card, [class*="card"]')).toBeNull()
  })

  it('shows L markers from the attendance prop', async () => {
    const today = isoDaysAgo(0)
    const yesterday = isoDaysAgo(1)
    render(
      <RecentIncidents
        lwsId="LWS-001"
        attendance={[
          { date: today, status: 'L' },
          { date: yesterday, status: 'P' },
        ]}
      />
    )
    await waitFor(() => expect(mockStore.getLectureAbsencesForStudent).toHaveBeenCalled())
    expect(screen.getByText('Late')).toBeInTheDocument()
  })

  it('shows lecture-miss rows fetched from the store', async () => {
    const today = isoDaysAgo(0)
    mockStore.getLectureAbsencesForStudent.mockResolvedValue([
      { lws_id: 'LWS-001', date: today, subject: 'Maths' },
      { lws_id: 'LWS-001', date: today, subject: 'Physics' },
    ])
    render(<RecentIncidents lwsId="LWS-001" attendance={[]} />)
    expect(await screen.findByText('Missed Maths')).toBeInTheDocument()
    expect(screen.getByText('Missed Physics')).toBeInTheDocument()
  })

  it('skips the fetch when lwsId is missing', async () => {
    render(<RecentIncidents lwsId={null} attendance={[]} />)
    // No fetch should be made when lwsId is missing
    expect(mockStore.getLectureAbsencesForStudent).not.toHaveBeenCalled()
  })

  it('uses lectureAbsencesProp without fetching (student portal path)', async () => {
    const today = isoDaysAgo(0)
    render(
      <RecentIncidents
        lwsId="LWS-001"
        attendance={[]}
        lectureAbsencesProp={[{ lws_id: 'LWS-001', date: today, subject: 'English' }]}
      />
    )
    expect(await screen.findByText('Missed English')).toBeInTheDocument()
    expect(mockStore.getLectureAbsencesForStudent).not.toHaveBeenCalled()
  })

  it('drops L markers older than 30 days', async () => {
    const oldDate = isoDaysAgo(60)
    render(<RecentIncidents lwsId="LWS-001" attendance={[{ date: oldDate, status: 'L' }]} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForStudent).toHaveBeenCalled())
    expect(screen.queryByText('Late')).not.toBeInTheDocument()
  })

  it('shows exam-absence rows fetched from the store as "Missed exam"', async () => {
    const today = isoDaysAgo(2)
    mockStore.getExamAbsencesForStudent.mockResolvedValue([
      { lws_id: 'LWS-001', exam_id: 'e1', marked_at: today + 'T10:00Z', notified_at: null },
    ])
    const exams = [{ id: 'e1', name: 'Mock #1', date: today }]
    render(<RecentIncidents lwsId="LWS-001" attendance={[]} exams={exams} />)
    expect(await screen.findByText(/Missed exam.*Mock #1/i)).toBeInTheDocument()
  })

  it('uses examAbsencesProp without fetching (student portal path)', async () => {
    const today = isoDaysAgo(2)
    const exams = [{ id: 'e1', name: 'Mock #1', date: today }]
    render(
      <RecentIncidents
        lwsId="LWS-001"
        attendance={[]}
        exams={exams}
        examAbsencesProp={[{ lws_id: 'LWS-001', exam_id: 'e1', marked_at: today + 'T10:00Z', notified_at: null }]}
      />
    )
    expect(await screen.findByText(/Missed exam.*Mock #1/i)).toBeInTheDocument()
    expect(mockStore.getExamAbsencesForStudent).not.toHaveBeenCalled()
  })

  it('drops exam-absence rows for exams not in the exams prop (e.g. deleted exam)', async () => {
    const today = isoDaysAgo(2)
    mockStore.getExamAbsencesForStudent.mockResolvedValue([
      { lws_id: 'LWS-001', exam_id: 'missing-exam', marked_at: today + 'T10:00Z', notified_at: null },
    ])
    const { container } = render(<RecentIncidents lwsId="LWS-001" attendance={[]} exams={[]} />)
    await waitFor(() => expect(mockStore.getExamAbsencesForStudent).toHaveBeenCalled())
    expect(container.querySelector('.card, [class*="card"]')).toBeNull()
  })
})
