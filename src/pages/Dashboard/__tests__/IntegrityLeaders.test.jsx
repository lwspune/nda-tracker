import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import IntegrityLeaders from '../IntegrityLeaders'

const ROWS = [
  { id: '1', lws_id: 'L1', student_name: 'Manas', exam_id: 'e1', exam_name: 'Mock A', exam_date: '2026-06-14', counterpart_name: 'Saarth', status: 'admitted', created_at: '2026-06-15T09:00:00Z' },
  { id: '2', lws_id: 'L1', student_name: 'Manas', exam_id: 'e2', exam_name: 'Mock B', exam_date: '2026-06-13', counterpart_name: 'Ganesh', status: 'admitted', created_at: '2026-06-14T09:00:00Z' },
  { id: '3', lws_id: 'L2', student_name: 'Saarth', exam_id: 'e1', exam_name: 'Mock A', exam_date: '2026-06-14', counterpart_name: 'Manas', status: 'admitted', created_at: '2026-06-15T09:00:00Z' },
]
const profiles = { 'Manas Shirsat': { name: 'Manas Shirsat', lwsId: 'L1', branch: 'APJ' } }

describe('IntegrityLeaders widget', () => {
  it('renders nothing when there are no incidents', async () => {
    const { container } = render(
      <IntegrityLeaders studentProfiles={{}} getAllIntegrityIncidents={vi.fn(async () => [])} />
    )
    await waitFor(() => {}) // let the effect resolve
    expect(container.querySelector('div')).toBeNull()
    expect(screen.queryByText(/Integrity Incidents/i)).not.toBeInTheDocument()
  })

  it('ranks the repeat offender first, expands the exam list, and clicks through', async () => {
    const setActiveStudent = vi.fn()
    render(
      <IntegrityLeaders
        studentProfiles={profiles}
        getAllIntegrityIncidents={vi.fn(async () => ROWS)}
        setActiveStudent={setActiveStudent}
      />
    )
    // Repeat offender (2 incidents / 2 exams) renders with the profile name + badge.
    expect(await screen.findByText('Manas Shirsat')).toBeInTheDocument()
    expect(screen.getByText(/2 incidents · 2 exams/)).toBeInTheDocument()
    // Single-incident student falls back to the row snapshot name.
    expect(screen.getByText('Saarth')).toBeInTheDocument()

    // Expand the first student's exam list.
    await userEvent.click(screen.getAllByText('Details ▼')[0])
    expect(await screen.findByText('Mock B')).toBeInTheDocument() // newest-first → Mock A then Mock B both shown
    expect(screen.getByText(/with Ganesh/)).toBeInTheDocument()

    // Click-through to the student.
    await userEvent.click(screen.getByText('Manas Shirsat'))
    expect(setActiveStudent).toHaveBeenCalledWith('Manas Shirsat')
  })
})
