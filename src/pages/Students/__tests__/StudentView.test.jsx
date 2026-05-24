// Tests for StudentView — self-contained subject filter.
// The component owns its own subjectFilter state; no prop is passed in.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock store ────────────────────────────────────────────────────────────────

const mockStore = {
  exams: [],
  studentProfiles: {},
  savedInsights: { classReport: null, studentPlans: {} },
  ndaFreqBySubject: {},
  // RecentIncidents + MissedExams read these; in tests they just resolve to no data.
  getLectureAbsencesForStudent: vi.fn().mockResolvedValue([]),
  getExamAbsencesForStudent:    vi.fn().mockResolvedValue([]),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../config', () => ({ IS_READ_ONLY: true }))

vi.mock('../ChapterAccordion', () => ({
  default: ({ chapterSummary }) => (
    <div data-testid="chapter-accordion"
         data-chapters={chapterSummary.map(c => c.ch).join(',')} />
  ),
}))

vi.mock('../ProjectedScoreCard', () => ({
  default: ({ primarySubject }) => (
    <div data-testid="projected-score" data-subject={primarySubject} />
  ),
}))

vi.mock('../WrongAnswerAudit', () => ({
  default: () => <div data-testid="wrong-audit" />,
}))

vi.mock('../UnattemptedAudit', () => ({
  default: () => <div data-testid="unattempted-audit" />,
}))

vi.mock('../../../lib/ndaFreq', () => ({
  NDA_FREQ_BY_SUBJECT: {},
  getFreqForSubject: () => [],
}))

import StudentView from '../StudentView'

// ── Fixtures ──────────────────────────────────────────────────────────────────

let _id = 0
function makeExam({ subject = 'Maths', studentScore = 60, studentName = 'Alice',
                    chapter = 'Algebra', examName } = {}) {
  _id++
  return {
    id: `exam-${_id}`,
    name: examName ?? `Exam ${_id}`,
    date: `2024-0${_id}-01`,
    subject,
    batch: null,
    marking: { correct: 4, wrong: -1 },
    questions: [{ q: 1, chapter, subtopic: 'Sub', correct: 'A' }],
    students: [{
      name: studentName, totalMarks: studentScore,
      correct: 15, incorrect: 2, notAttempted: 3, responses: { 1: 1 },
    }],
    createdAt: new Date().toISOString(),
  }
}

function setExams(exams) { mockStore.exams = exams }
function renderView(name = 'Alice') { return render(<StudentView name={name} />) }
function getSubjectSelect() { return screen.queryByRole('combobox', { name: /subject/i }) }

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _id = 0
  mockStore.exams = []
  mockStore.studentProfiles = {}
  mockStore.savedInsights = { classReport: null, studentPlans: {} }
  mockStore.ndaFreqBySubject = {}
})

// ── Empty state ───────────────────────────────────────────────────────────────

describe('StudentView — empty state', () => {
  it('shows empty state when student has no exams', () => {
    setExams([])
    renderView()
    expect(screen.getByText(/no exam records/i)).toBeInTheDocument()
  })

  it('does not render subject dropdown in empty state', () => {
    setExams([])
    renderView()
    expect(getSubjectSelect()).not.toBeInTheDocument()
  })
})

// ── Auto-redirect when default 'Maths' filter has no matches ──────────────────
// Without this, the <select value="Maths"> falls back to displaying its first
// option ("All Subjects") visually while the state remains 'Maths' — confusing
// users into thinking they're seeing "All Subjects" with no data.

describe('StudentView — auto-redirect away from default Maths filter when no match', () => {
  it('renders exam content directly when student has only GAT exams (no dead-end empty state)', () => {
    setExams([makeExam({ subject: 'GAT', examName: 'GAT Mock 1' })])
    renderView()
    expect(screen.getByText('GAT Mock 1')).toBeInTheDocument()
    expect(screen.queryByText(/no data/i)).not.toBeInTheDocument()
  })

  it('renders all exams when student has only Physics + English (no Maths to default to)', () => {
    setExams([
      makeExam({ subject: 'Physics', examName: 'Physics Test 1' }),
      makeExam({ subject: 'English', examName: 'English Test 1' }),
    ])
    renderView()
    expect(screen.getByText('Physics Test 1')).toBeInTheDocument()
    expect(screen.getByText('English Test 1')).toBeInTheDocument()
    expect(screen.queryByText(/no data/i)).not.toBeInTheDocument()
  })

  it('dropdown displays "all" (not stale "Maths") when student has no Maths exams', () => {
    setExams([
      makeExam({ subject: 'Physics', examName: 'Physics Test 1' }),
      makeExam({ subject: 'English', examName: 'English Test 1' }),
    ])
    renderView()
    expect(getSubjectSelect()).toHaveValue('all')
  })
})

// ── Subject dropdown — single subject ─────────────────────────────────────────

describe('StudentView — single subject (no multi-subject filtering needed)', () => {
  it('does not render subject dropdown when student has only one subject', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Maths' }),
    ])
    renderView()
    expect(getSubjectSelect()).not.toBeInTheDocument()
  })
})

// ── Subject dropdown — multiple subjects ──────────────────────────────────────

describe('StudentView — subject dropdown with multiple subjects', () => {
  it('renders subject dropdown when student has exams in 2+ subjects', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderView()
    expect(getSubjectSelect()).toBeInTheDocument()
  })

  it('defaults to "Maths"', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderView()
    expect(getSubjectSelect()).toHaveValue('Maths')
  })

  it('lists only subjects the student has actually taken', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderView()
    const opts = within(getSubjectSelect()).getAllByRole('option').map(o => o.value)
    expect(opts).toContain('all')
    expect(opts).toContain('Maths')
    expect(opts).toContain('Physics')
    expect(opts).not.toContain('Chemistry')
  })

  it('lists subjects in alphabetical order', () => {
    setExams([
      makeExam({ subject: 'Physics' }),
      makeExam({ subject: 'English' }),
      makeExam({ subject: 'Maths' }),
    ])
    renderView()
    const subjectOpts = within(getSubjectSelect())
      .getAllByRole('option')
      .map(o => o.value)
      .filter(v => v !== 'all')
    expect(subjectOpts).toEqual(['English', 'Maths', 'Physics'])
  })

  it('dropdown sits above the stat cards in the DOM', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderView()
    const select   = getSubjectSelect()
    const statCard = screen.getByText('Exams Taken').closest('.stat-card')
    expect(select.compareDocumentPosition(statCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ── Exam history — all subjects ───────────────────────────────────────────────

describe('StudentView — exam history with no filter', () => {
  it('shows all exams when "all" is explicitly selected', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   examName: 'Maths Test 1' }),
      makeExam({ subject: 'Physics', examName: 'Physics Test 1' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'all')
    expect(screen.getByText('Maths Test 1')).toBeInTheDocument()
    expect(screen.getByText('Physics Test 1')).toBeInTheDocument()
  })

  it('Exams Taken stat shows count for default Maths filter', () => {
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Maths' }),
    ])
    renderView()
    const card = screen.getByText('Exams Taken').closest('.stat-card')
    expect(within(card).getByText('2')).toBeInTheDocument()
  })
})

// ── Exam history — filtered by subject ───────────────────────────────────────

describe('StudentView — exam history after selecting a subject', () => {
  it('shows only matching exams after selecting a subject', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   examName: 'Maths Test 1' }),
      makeExam({ subject: 'Physics', examName: 'Physics Test 1' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'Maths')
    expect(screen.getByText('Maths Test 1')).toBeInTheDocument()
    expect(screen.queryByText('Physics Test 1')).not.toBeInTheDocument()
  })

  it('Exams Taken stat reflects filtered count', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Physics' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'Maths')
    const card = screen.getByText('Exams Taken').closest('.stat-card')
    expect(within(card).getByText('2')).toBeInTheDocument()
  })

  it('Latest Score reflects most recent filtered exam', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   studentScore: 80, examName: 'Maths Test 1' }),
      makeExam({ subject: 'Physics', studentScore: 40, examName: 'Physics Test 1' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'Maths')
    const card = screen.getByText('Latest Score').closest('.stat-card')
    expect(within(card).getByText('80')).toBeInTheDocument()
  })

  it('hides the other subject exam after filtering', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   examName: 'Maths Test 1' }),
      makeExam({ subject: 'Physics', examName: 'Physics Test 1' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'Physics')
    expect(screen.queryByText('Maths Test 1')).not.toBeInTheDocument()
    expect(screen.getByText('Physics Test 1')).toBeInTheDocument()
  })

  it('restores all exams when switching back to "All Subjects"', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   examName: 'Maths Test 1' }),
      makeExam({ subject: 'Physics', examName: 'Physics Test 1' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'Maths')
    expect(screen.queryByText('Physics Test 1')).not.toBeInTheDocument()
    await user.selectOptions(getSubjectSelect(), 'all')
    expect(screen.getByText('Physics Test 1')).toBeInTheDocument()
    expect(screen.getByText('Maths Test 1')).toBeInTheDocument()
  })
})

// ── Chapter accordion scoped to selected subject ──────────────────────────────

describe('StudentView — chapter accordion scoped to subject filter', () => {
  it('shows chapters from all subjects when filter is "all"', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   chapter: 'Algebra' }),
      makeExam({ subject: 'Physics', chapter: 'Optics' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'all')
    const accordion = screen.getByTestId('chapter-accordion')
    expect(accordion.dataset.chapters).toContain('Algebra')
    expect(accordion.dataset.chapters).toContain('Optics')
  })

  it('restricts accordion to selected subject chapters', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   chapter: 'Algebra' }),
      makeExam({ subject: 'Physics', chapter: 'Optics' }),
    ])
    renderView()
    await user.selectOptions(getSubjectSelect(), 'Physics')
    const accordion = screen.getByTestId('chapter-accordion')
    expect(accordion.dataset.chapters).toContain('Optics')
    expect(accordion.dataset.chapters).not.toContain('Algebra')
  })
})

// ── Name variant normalization ────────────────────────────────────────────────

describe('StudentView — name variant normalization', () => {
  it('shows exam records stored under a variant name when the canonical name is passed', () => {
    const profile = {
      name: 'Swarup Yuvraj Karle', nameVariants: ['Swarup karle'],
      lwsId: 'L001', branch: '', batches: [], mobile: '',
      parentMobiles: [], regDate: '', accountStatus: '', comingStatus: '',
    }
    mockStore.studentProfiles = {
      'Swarup Yuvraj Karle': profile,
      'Swarup karle': profile,
    }
    setExams([makeExam({ studentName: 'Swarup karle', examName: 'Mock 1' })])
    renderView('Swarup Yuvraj Karle')
    expect(screen.queryByText(/no exam records/i)).not.toBeInTheDocument()
    expect(screen.getByText('Mock 1')).toBeInTheDocument()
  })

  it('combines exams across multiple variant names', () => {
    const profile = {
      name: 'Swarup Yuvraj Karle', nameVariants: ['Swarup karle', 'S Karle'],
      lwsId: 'L001', branch: '', batches: [], mobile: '',
      parentMobiles: [], regDate: '', accountStatus: '', comingStatus: '',
    }
    mockStore.studentProfiles = {
      'Swarup Yuvraj Karle': profile,
      'Swarup karle': profile,
      'S Karle': profile,
    }
    setExams([
      makeExam({ studentName: 'Swarup karle', examName: 'Mock 1' }),
      makeExam({ studentName: 'S Karle',      examName: 'Mock 2' }),
    ])
    renderView('Swarup Yuvraj Karle')
    expect(screen.getByText('Mock 1')).toBeInTheDocument()
    expect(screen.getByText('Mock 2')).toBeInTheDocument()
    const card = screen.getByText('Exams Taken').closest('.stat-card')
    expect(within(card).getByText('2')).toBeInTheDocument()
  })
})

// ── State resets on remount (simulates switching students) ────────────────────

describe('StudentView — state resets when name prop changes', () => {
  it('resets subject filter to "Maths" when component remounts with a new student', async () => {
    const user = userEvent.setup()
    setExams([
      makeExam({ subject: 'Maths',   studentName: 'Alice', examName: 'Maths Test' }),
      makeExam({ subject: 'Physics', studentName: 'Alice', examName: 'Physics Test' }),
      makeExam({ subject: 'Maths',   studentName: 'Bob',   examName: 'Bob Maths' }),
      makeExam({ subject: 'Physics', studentName: 'Bob',   examName: 'Bob Physics' }),
    ])

    const { rerender } = render(<StudentView name="Alice" />)
    await user.selectOptions(getSubjectSelect(), 'Physics')
    expect(getSubjectSelect()).toHaveValue('Physics')

    // Remount with Bob — filter must reset to default
    rerender(<StudentView key="Bob" name="Bob" />)
    expect(getSubjectSelect()).toHaveValue('Maths')
  })
})
