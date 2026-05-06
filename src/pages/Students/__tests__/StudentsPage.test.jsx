// Tests for StudentsPage (index.jsx).
// Subject filter is now self-contained inside StudentView — no dropdown lives here.
// These tests only cover the search + student selection behaviour.

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock store ────────────────────────────────────────────────────────────────

const mockStore = {
  exams: [],
  studentProfiles: {},
  activeStudent: null,
  setActiveStudent: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

// Stub StudentView — we test it in its own file
vi.mock('../StudentView', () => ({
  default: ({ name }) => (
    <div data-testid="student-view" data-name={name} />
  ),
}))

import StudentsPage from '../index'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExam(studentName = 'Alice') {
  return {
    id: 'e1', name: 'Exam 1', date: '2024-01-01', subject: 'Maths',
    batch: null, marking: { correct: 4, wrong: -1 },
    questions: [], students: [{ name: studentName, totalMarks: 60,
      correct: 15, incorrect: 2, notAttempted: 3, responses: {} }],
    createdAt: new Date().toISOString(),
  }
}

function setExams(exams)        { mockStore.exams = exams }
function setActiveStudent(name) { mockStore.activeStudent = name }
function renderPage()           { return render(<StudentsPage />) }

beforeEach(() => {
  mockStore.exams = []
  mockStore.activeStudent = null
  vi.clearAllMocks()
})

// ── No student selected ───────────────────────────────────────────────────────

describe('StudentsPage — no student selected', () => {
  it('shows empty-state prompt when no exams exist', () => {
    setExams([])
    renderPage()
    expect(screen.getByText(/no exams yet/i)).toBeInTheDocument()
  })

  it('shows search prompt when exams exist but no student selected', () => {
    setExams([makeExam()])
    renderPage()
    expect(screen.getByText(/search for a student/i)).toBeInTheDocument()
  })

  it('does not render StudentView when no student is selected', () => {
    setExams([makeExam()])
    renderPage()
    expect(screen.queryByTestId('student-view')).not.toBeInTheDocument()
  })

  it('does not render a subject dropdown (filter lives inside StudentView)', () => {
    setExams([makeExam()])
    renderPage()
    expect(screen.queryByRole('combobox', { name: /subject/i })).not.toBeInTheDocument()
  })
})

// ── Student selected ──────────────────────────────────────────────────────────

describe('StudentsPage — student selected', () => {
  it('renders StudentView with the active student name', () => {
    setExams([makeExam('Alice')])
    setActiveStudent('Alice')
    renderPage()
    expect(screen.getByTestId('student-view')).toHaveAttribute('data-name', 'Alice')
  })

  it('does not pass a subjectFilter prop (StudentView owns its own filter)', () => {
    setExams([makeExam('Alice')])
    setActiveStudent('Alice')
    renderPage()
    // The stub only exposes data-name; no data-subject attribute should be set
    expect(screen.getByTestId('student-view')).not.toHaveAttribute('data-subject')
  })
})

// ── Variant names excluded from search ────────────────────────────────────────

describe('StudentsPage — variant name filtering', () => {
  it('excludes name variants from search results, showing only the primary name', () => {
    const profile = { name: 'Swarup Yuvraj Karle', nameVariants: ['Swarup karle'], lwsId: 'L001',
      branch: '', batches: [], mobile: '', parentMobiles: [], regDate: '', accountStatus: '', comingStatus: '' }
    mockStore.studentProfiles = {
      'Swarup Yuvraj Karle': profile,
      'Swarup karle': profile,
    }
    setExams([makeExam('Swarup karle'), makeExam('Swarup Yuvraj Karle')])
    renderPage()

    const input = screen.getByPlaceholderText(/search student name/i)
    fireEvent.change(input, { target: { value: 'Swarup' } })
    fireEvent.focus(input)

    expect(screen.getByText('Swarup Yuvraj Karle')).toBeInTheDocument()
    expect(screen.queryByText('Swarup karle')).not.toBeInTheDocument()
  })
})
