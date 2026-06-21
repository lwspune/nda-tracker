// Tests for IntegrityIncidents — confirmed academic-integrity incidents on a
// student profile. Admin/teacher fetch from the slice; student portal supplies
// rows via prop-bypass. Delete is admin-only.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModeContext } from '../../../context/ModeContext'

let mockRows = []
const mockGetForStudent = vi.fn(async () => mockRows)
const mockDelete        = vi.fn(async () => true)

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({
    getIntegrityIncidentsForStudent: mockGetForStudent,
    deleteIntegrityIncident:         mockDelete,
  }),
}))

import IntegrityIncidents from '../IntegrityIncidents'

const ROW = {
  id: 'inc1', exam_name: "Math's mock test", exam_date: '2026-06-14',
  counterpart_name: 'Saarth Deshmukh', shared_wrong: 18, diff: 8,
  status: 'admitted', note: 'Admitted after confrontation',
  created_at: '2026-06-15T09:00:00Z', created_by: 'teacher@lws.test',
}

function renderWithMode(ui, mode = 'admin') {
  return render(<ModeContext.Provider value={mode}>{ui}</ModeContext.Provider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRows = []
  mockGetForStudent.mockImplementation(async () => mockRows)
})

describe('IntegrityIncidents', () => {
  it('renders nothing when the student has no incidents', async () => {
    const { container } = renderWithMode(<IntegrityIncidents lwsId="LWS-1" />)
    await waitFor(() => expect(mockGetForStudent).toHaveBeenCalledWith('LWS-1'))
    expect(screen.queryByText(/Academic Integrity/i)).not.toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
  })

  it('renders a row with exam, counterpart, evidence and note (slice fetch)', async () => {
    mockRows = [ROW]
    renderWithMode(<IntegrityIncidents lwsId="LWS-1" />)
    expect(await screen.findByText("Math's mock test")).toBeInTheDocument()
    expect(screen.getByText('Saarth Deshmukh')).toBeInTheDocument()
    expect(screen.getByText(/18 shared wrong · 8 diff/)).toBeInTheDocument()
    expect(screen.getByText(/Admitted after confrontation/)).toBeInTheDocument()
  })

  it('uses the prop without calling the slice (student portal bypass)', async () => {
    renderWithMode(<IntegrityIncidents lwsId="LWS-1" integrityIncidentsProp={[ROW]} />, 'student')
    expect(await screen.findByText("Math's mock test")).toBeInTheDocument()
    expect(mockGetForStudent).not.toHaveBeenCalled()
  })

  it('shows a delete control for admins and removes the row on confirm', async () => {
    mockRows = [ROW]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithMode(<IntegrityIncidents lwsId="LWS-1" />, 'admin')
    await screen.findByText("Math's mock test")
    await userEvent.click(screen.getByTitle('Remove incident'))
    expect(mockDelete).toHaveBeenCalledWith('inc1')
    await waitFor(() => expect(screen.queryByText("Math's mock test")).not.toBeInTheDocument())
  })

  it('hides the delete control for non-admins (teacher / student portal)', async () => {
    renderWithMode(<IntegrityIncidents lwsId="LWS-1" integrityIncidentsProp={[ROW]} />, 'teacher')
    await screen.findByText("Math's mock test")
    expect(screen.queryByTitle('Remove incident')).not.toBeInTheDocument()
  })
})
