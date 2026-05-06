// Component tests for Dashboard subject filter UI.
// We mock the Zustand store so the component renders with controlled exam data.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock the store ───────────────────────────────────────────────────────────
// We intercept the default export so each test controls what exams are visible.

const mockStore = {
  exams: [],
  ndaFreqBySubject: {},
  setNdaFreq: vi.fn(),
  resetNdaFreq: vi.fn(),
  studentProfiles: {},
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

// FrequencyTableEditor is a heavy sub-component — stub it out.
vi.mock('../FrequencyTableEditor', () => ({
  default: () => <div data-testid="freq-editor" />,
}))

import DashboardPage from '../index'

// ── Fixture ──────────────────────────────────────────────────────────────────

let _id = 0
function makeExam(overrides = {}) {
  _id++
  return {
    id: `exam-${_id}`,
    name: `Exam ${_id}`,
    date: '2024-01-01',
    subject: 'Maths',
    batch: null,
    marking: { correct: 4, wrong: -1 },
    questions: [
      { q: 1, chapter: 'Algebra', subtopic: 'Equations', correct: 'A' },
    ],
    students: [
      { name: 'Alice', totalMarks: 80, correct: 20, incorrect: 0, notAttempted: 0,
        responses: { 1: 1 } },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setExams(exams) {
  mockStore.exams = exams
}

function renderDashboard() {
  return render(<DashboardPage />)
}

function getSubjectSelect() {
  return screen.getByRole('combobox', { name: /subject/i })
}

function getExamSelect() {
  return screen.getByRole('combobox', { name: /exam/i })
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _id = 0
  mockStore.exams = []
  vi.clearAllMocks()
})

describe('Dashboard — empty state', () => {
  it('renders empty state when there are no exams', () => {
    setExams([])
    renderDashboard()
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  it('does not render subject dropdown when there are no exams', () => {
    setExams([])
    renderDashboard()
    expect(screen.queryByRole('combobox', { name: /subject/i })).not.toBeInTheDocument()
  })
})

describe('Dashboard — subject dropdown presence', () => {
  it('renders subject dropdown when exams exist', () => {
    setExams([makeExam()])
    renderDashboard()
    expect(getSubjectSelect()).toBeInTheDocument()
  })

  it('subject dropdown defaults to "All Subjects"', () => {
    setExams([makeExam()])
    renderDashboard()
    expect(getSubjectSelect()).toHaveValue('all')
  })

  it('subject dropdown only lists subjects that have exams', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderDashboard()
    const select = getSubjectSelect()
    const options = within(select).getAllByRole('option')
    const values = options.map(o => o.value)
    // Should have 'all', 'Maths', 'Physics' — not all 11 subjects
    expect(values).toContain('all')
    expect(values).toContain('Maths')
    expect(values).toContain('Physics')
    expect(values).not.toContain('Chemistry')
    expect(values).not.toContain('English')
  })

  it('lists subjects in alphabetical order', () => {
    setExams([
      makeExam({ subject: 'Physics' }),
      makeExam({ subject: 'English' }),
      makeExam({ subject: 'Maths' }),
    ])
    renderDashboard()
    const select = getSubjectSelect()
    const options = within(select).getAllByRole('option')
    const subjectValues = options.map(o => o.value).filter(v => v !== 'all')
    expect(subjectValues).toEqual(['English', 'Maths', 'Physics'])
  })

  it('subject dropdown appears before the batch dropdown', () => {
    setExams([makeExam({ batch: 'Batch-A' })])
    renderDashboard()
    const allSelects = screen.getAllByRole('combobox')
    const labels = allSelects.map(s => s.getAttribute('aria-label'))
    const subjectIdx = labels.findIndex(l => /subject/i.test(l))
    const batchIdx   = labels.findIndex(l => /batch/i.test(l))
    expect(subjectIdx).toBeLessThan(batchIdx)
  })
})

describe('Dashboard — subject filter changes stats', () => {
  it('shows all exams in stat card when subject is "all"', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderDashboard()
    // The "Exams" stat card should show 2
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('filters the Exams count when a subject is selected', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderDashboard()
    await user.selectOptions(getSubjectSelect(), 'Physics')
    // Find the "Exams" stat card and confirm its value is 1
    const examsLabel = screen.getByText('Exams')
    const statCard   = examsLabel.closest('.stat-card')
    expect(within(statCard).getByText('1')).toBeInTheDocument()
  })
})

describe('Dashboard — filter reset on subject change', () => {
  it('resets exam dropdown to "All Exams" when subject changes', async () => {
    const user = userEvent.setup()
    const mathExam = makeExam({ id: 'maths-1', subject: 'Maths' })
    setExams([mathExam, makeExam({ subject: 'Physics' })])
    renderDashboard()

    // Select a specific Maths exam
    await user.selectOptions(getExamSelect(), 'maths-1')
    expect(getExamSelect()).toHaveValue('maths-1')

    // Switch subject to Physics — exam filter must reset
    await user.selectOptions(getSubjectSelect(), 'Physics')
    expect(getExamSelect()).toHaveValue('all')
  })

  it('resets batch dropdown to "All Batches" when subject changes', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   batch: 'Batch-A' }),
      makeExam({ subject: 'Physics', batch: 'Batch-B' }),
    ])
    renderDashboard()

    // Select Batch-A
    await user.selectOptions(screen.getByRole('combobox', { name: /batch/i }), 'Batch-A')
    expect(screen.getByRole('combobox', { name: /batch/i })).toHaveValue('Batch-A')

    // Switch to Physics — batch should reset to 'all'
    await user.selectOptions(getSubjectSelect(), 'Physics')
    expect(screen.getByRole('combobox', { name: /batch/i })).toHaveValue('all')
  })
})

describe('Dashboard — exam dropdown scoped to selected subject', () => {
  it('shows only exams for the selected subject in the exam dropdown', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ id: 'm1', name: 'Maths Test 1', subject: 'Maths' }),
      makeExam({ id: 'p1', name: 'Physics Test 1', subject: 'Physics' }),
    ])
    renderDashboard()
    await user.selectOptions(getSubjectSelect(), 'Maths')

    const examSelect = getExamSelect()
    const options = within(examSelect).getAllByRole('option')
    const values = options.map(o => o.value)
    expect(values).toContain('m1')
    expect(values).not.toContain('p1')
  })
})

describe('Dashboard — batch dropdown scoped to selected subject', () => {
  it('shows only batches that belong to the selected subject', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   batch: 'Batch-A' }),
      makeExam({ subject: 'Physics', batch: 'Batch-B' }),
    ])
    renderDashboard()
    await user.selectOptions(getSubjectSelect(), 'Maths')

    const batchSelect = screen.queryByRole('combobox', { name: /batch/i })
    if (batchSelect) {
      const options = within(batchSelect).getAllByRole('option')
      const values = options.map(o => o.value)
      expect(values).toContain('Batch-A')
      expect(values).not.toContain('Batch-B')
    }
    // If there's exactly one batch after filtering, it's fine for the dropdown to be hidden
  })
})
