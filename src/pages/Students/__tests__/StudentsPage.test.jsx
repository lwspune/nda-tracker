// Tests for StudentsPage (index.jsx).
// The page renders a paginated, filterable table. When a row is clicked,
// the table is REPLACED by the StudentView (only one of the two is visible at a time).
// A "Back to list" button returns to the table.

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock store ────────────────────────────────────────────────────────────────

const mockStore = {
  exams: [],
  studentList: [],
  studentProfiles: {},
  activeStudent: null,
  setActiveStudent: vi.fn(),
  updateStudentBranchBatch: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

// Stub StudentView and StudentsTable — each has its own tests.
vi.mock('../StudentView', () => ({
  default: ({ name }) => <div data-testid="student-view" data-name={name} />,
}))

vi.mock('../StudentsTable', () => ({
  default: ({ students, activeStudent, isAdmin }) => (
    <div data-testid="students-table"
         data-count={students.length}
         data-active={activeStudent || ''}
         data-faculty={String(isAdmin)} />
  ),
}))

import StudentsPage from '../index'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStudentList(list) { mockStore.studentList = list }
function setActiveStudent(name) { mockStore.activeStudent = name }
function renderPage() { return render(<StudentsPage />) }

beforeEach(() => {
  mockStore.exams = []
  mockStore.studentList = []
  mockStore.studentProfiles = {}
  mockStore.activeStudent = null
  vi.clearAllMocks()
})

// ── Empty state ───────────────────────────────────────────────────────────────

describe('StudentsPage — empty state', () => {
  it('shows "No students yet" when the list is empty', () => {
    renderPage()
    expect(screen.getByText(/no students yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('students-table')).not.toBeInTheDocument()
  })
})

// ── Table rendering ───────────────────────────────────────────────────────────

describe('StudentsPage — table rendering', () => {
  it('renders the table when students exist', () => {
    setStudentList([
      { lws_id: 'LWS-001', canonical_name: 'Aarav', batches: [] },
      { lws_id: 'LWS-002', canonical_name: 'Bina',  batches: [] },
    ])
    renderPage()
    const table = screen.getByTestId('students-table')
    expect(table).toBeInTheDocument()
    expect(table).toHaveAttribute('data-count', '2')
  })

  it('does not render StudentView when no student is selected', () => {
    setStudentList([{ lws_id: 'LWS-001', canonical_name: 'Aarav', batches: [] }])
    renderPage()
    expect(screen.queryByTestId('student-view')).not.toBeInTheDocument()
  })
})

// ── Active student replaces the table ────────────────────────────────────────

describe('StudentsPage — active student replaces the table', () => {
  it('hides the table and renders only the StudentView when a student is active', () => {
    setStudentList([{ lws_id: 'LWS-001', canonical_name: 'Aarav', batches: [] }])
    setActiveStudent('Aarav')
    renderPage()
    expect(screen.queryByTestId('students-table')).not.toBeInTheDocument()
    expect(screen.getByTestId('student-view')).toHaveAttribute('data-name', 'Aarav')
  })

  it('shows a "Back to list" control when a student is active', () => {
    setStudentList([{ lws_id: 'LWS-001', canonical_name: 'Aarav', batches: [] }])
    setActiveStudent('Aarav')
    renderPage()
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument()
  })

  it('Back to list button clears activeStudent via the store action', async () => {
    setStudentList([{ lws_id: 'LWS-001', canonical_name: 'Aarav', batches: [] }])
    setActiveStudent('Aarav')
    renderPage()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /back to list/i }))
    expect(mockStore.setActiveStudent).toHaveBeenCalledWith(null)
  })
})

// ── Source of student list ────────────────────────────────────────────────────

describe('StudentsPage — student list source', () => {
  it('builds the list from studentList (raw Supabase array) when present', () => {
    setStudentList([
      { lws_id: 'LWS-001', canonical_name: 'Aarav', batches: ['B1'] },
      { lws_id: 'LWS-002', canonical_name: 'Bina',  batches: ['B2'] },
    ])
    renderPage()
    expect(screen.getByTestId('students-table')).toHaveAttribute('data-count', '2')
  })

  it('falls back to studentProfiles canonical entries when studentList is empty', () => {
    mockStore.studentProfiles = {
      Aarav: { name: 'Aarav', lwsId: 'LWS-001', batches: [] },
      Bina:  { name: 'Bina',  lwsId: 'LWS-002', batches: [] },
    }
    renderPage()
    expect(screen.getByTestId('students-table')).toHaveAttribute('data-count', '2')
  })

  it('excludes variant entries from the studentProfiles fallback', () => {
    const profile = { name: 'Nirnit Hemraj Patil', lwsId: 'LWS-001',
      branch: '', batches: [], nameVariants: ['Nirnit Patil'] }
    mockStore.studentProfiles = {
      'Nirnit Hemraj Patil': profile,
      'Nirnit Patil':        profile, // variant alias
    }
    renderPage()
    expect(screen.getByTestId('students-table')).toHaveAttribute('data-count', '1')
  })
})
