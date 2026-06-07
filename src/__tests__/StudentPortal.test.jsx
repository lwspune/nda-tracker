import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock the store — StudentPortal only needs loadStudentData.
vi.mock('../store/useStore', () => ({
  default: (selector) => selector({ loadStudentData: vi.fn() }),
}))

// Stub the heavy children so we can assert presence/absence cheaply. Their own
// behaviour is tested in their own suites.
vi.mock('../pages/Students/StudentView', () => ({
  default: () => <div data-testid="student-view">student view</div>,
}))
vi.mock('../pages/Quizzes/StudentQuizzes', () => ({
  default: () => <div data-testid="student-quizzes">quizzes</div>,
}))
vi.mock('../pages/Students/FocusedExamResult', () => ({
  default: ({ examId }) => <div data-testid="focused">focused:{examId || 'none'}</div>,
}))

import { StudentPortal } from '../App'

const DATA = {
  name: 'Riya Sharma',
  viaParent: true,
  exams: [{ id: 'exam1', name: 'Maths Mock', students: [{}] }],
  profile: { mobile: '9999999999', batches: ['B1'] },
  attendance: [], lectureAbsences: [], examAbsences: [], homeworkPending: [],
}

function setUrl(search) {
  window.history.replaceState({}, '', search ? `/?${search}` : '/')
}

beforeEach(() => {
  vi.clearAllMocks()
  setUrl('')
})

describe('StudentPortal — deep-link focused landing', () => {
  it('on ?exam= arrival shows only the focused result + a reveal button, hiding the dashboard', () => {
    setUrl('exam=exam1')
    render(<StudentPortal data={DATA} onLogout={vi.fn()} />)

    expect(screen.getByTestId('focused')).toHaveTextContent('focused:exam1')
    expect(screen.getByRole('button', { name: /View full performance/i })).toBeInTheDocument()
    // Dashboard hidden until revealed
    expect(screen.queryByTestId('student-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-quizzes')).not.toBeInTheDocument()
  })

  it('clicking "View full performance" reveals the full dashboard', () => {
    setUrl('exam=exam1')
    render(<StudentPortal data={DATA} onLogout={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /View full performance/i }))
    expect(screen.getByTestId('student-view')).toBeInTheDocument()
    expect(screen.getByTestId('student-quizzes')).toBeInTheDocument()
  })

  it('shows the parent-view banner when viaParent is set', () => {
    setUrl('exam=exam1')
    render(<StudentPortal data={DATA} onLogout={vi.fn()} />)
    expect(screen.getByText(/Parent view/i)).toBeInTheDocument()
  })

  it('without ?exam= renders the full dashboard directly (no reveal button)', () => {
    render(<StudentPortal data={DATA} onLogout={vi.fn()} />)
    expect(screen.getByTestId('student-view')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View full performance/i })).not.toBeInTheDocument()
  })

  it('does not show the parent banner when viaParent is false', () => {
    render(<StudentPortal data={{ ...DATA, viaParent: false }} onLogout={vi.fn()} />)
    expect(screen.queryByText(/Parent view/i)).not.toBeInTheDocument()
  })

  it('renders nothing focused when ?exam= does not match an exam (full view)', () => {
    setUrl('exam=ghost')
    render(<StudentPortal data={DATA} onLogout={vi.fn()} />)
    // focusedExam is null → no reveal button, full dashboard shows
    expect(screen.queryByRole('button', { name: /View full performance/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('student-view')).toBeInTheDocument()
  })
})
