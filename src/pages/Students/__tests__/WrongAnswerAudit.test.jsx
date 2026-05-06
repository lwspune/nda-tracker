import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../chapterAccordionHelpers', () => ({
  getSubtopicQuestions: vi.fn(() => ({ wrong: [], skipped: [] })),
  groupByExam: vi.fn(() => []),
  fmtDate: vi.fn((d, _full) => d),
}))

vi.mock('../../../components/ui/QuestionCard', () => ({
  default: ({ q }) => <div data-testid="question-card" data-qnum={q.q} />,
}))

import WrongAnswerAudit from '../WrongAnswerAudit'
import { getSubtopicQuestions, groupByExam } from '../chapterAccordionHelpers'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeItem(n) {
  return {
    chapter: `Chapter ${n}`,
    subtopic: `Subtopic ${n}`,
    wrong: n,
    correct: 2,
    total: n + 2,
    wrongRate: n / (n + 2),
  }
}

function makeItems(count) {
  return Array.from({ length: count }, (_, i) => makeItem(i + 1))
}

function renderAudit(items, { name = 'Alice', exams = [] } = {}) {
  return render(<WrongAnswerAudit wrongAudit={items} name={name} exams={exams} />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
  getSubtopicQuestions.mockReturnValue({ wrong: [], skipped: [] })
  groupByExam.mockReturnValue([])
})

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('WrongAnswerAudit — rendering', () => {
  it('renders the section title', () => {
    renderAudit(makeItems(3))
    expect(screen.getByText(/wrong answer audit/i)).toBeInTheDocument()
  })

  it('renders all subtopic names when ≤10 items', () => {
    renderAudit(makeItems(5))
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(`Subtopic ${i}`)).toBeInTheDocument()
    }
  })

  it('renders the chapter name below each subtopic', () => {
    renderAudit([makeItem(1)])
    expect(screen.getByText('Chapter 1')).toBeInTheDocument()
  })

  it('renders a Show Questions button for each visible row', () => {
    renderAudit(makeItems(3))
    const btns = screen.getAllByRole('button', { name: /show questions/i })
    expect(btns).toHaveLength(3)
  })
})

// ── Pagination — not shown when ≤10 ──────────────────────────────────────────

describe('WrongAnswerAudit — no pagination when ≤5 items', () => {
  it('does not render Prev or Next when there are 5 items', () => {
    renderAudit(makeItems(5))
    expect(screen.queryByRole('button', { name: /prev/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
  })

  it('does not render the counter when there are fewer than 5 items', () => {
    renderAudit(makeItems(3))
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument()
  })
})

// ── Pagination — shown when >10 ───────────────────────────────────────────────

describe('WrongAnswerAudit — pagination with 15 items', () => {
  it('shows Prev and Next buttons when there are 6+ items', () => {
    renderAudit(makeItems(6))
    expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  it('shows only first 5 subtopics on page 1', () => {
    renderAudit(makeItems(15))
    expect(screen.getByText('Subtopic 1')).toBeInTheDocument()
    expect(screen.getByText('Subtopic 5')).toBeInTheDocument()
    expect(screen.queryByText('Subtopic 6')).not.toBeInTheDocument()
  })

  it('shows "Showing 1–5 of 7" counter on first page', () => {
    renderAudit(makeItems(7))
    expect(screen.getByText(/showing 1.5 of 7/i)).toBeInTheDocument()
  })

  it('Prev button is disabled on the first page', () => {
    renderAudit(makeItems(15))
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled()
  })

  it('Next button is enabled on the first page', () => {
    renderAudit(makeItems(15))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('advances to page 2 when Next is clicked', async () => {
    const user = userEvent.setup()
    renderAudit(makeItems(7))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByText('Subtopic 1')).not.toBeInTheDocument()
    expect(screen.getByText('Subtopic 6')).toBeInTheDocument()
  })

  it('shows "Showing 6–7 of 7" on second page', async () => {
    const user = userEvent.setup()
    renderAudit(makeItems(7))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/showing 6.7 of 7/i)).toBeInTheDocument()
  })

  it('Next is disabled on the last page', async () => {
    const user = userEvent.setup()
    renderAudit(makeItems(7))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('Prev is enabled on page 2', async () => {
    const user = userEvent.setup()
    renderAudit(makeItems(15))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /prev/i })).not.toBeDisabled()
  })

  it('returns to first page when Prev is clicked from page 2', async () => {
    const user = userEvent.setup()
    renderAudit(makeItems(15))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /prev/i }))
    expect(screen.getByText('Subtopic 1')).toBeInTheDocument()
    expect(screen.queryByText('Subtopic 11')).not.toBeInTheDocument()
  })

  it('shows exactly 5 items on a full page and fewer on the last page', async () => {
    const user = userEvent.setup()
    renderAudit(makeItems(7))
    // Page 1: 5 "Show Questions" buttons
    expect(screen.getAllByRole('button', { name: /show questions/i })).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Page 2: 2 remaining
    expect(screen.getAllByRole('button', { name: /show questions/i })).toHaveLength(2)
  })
})

// ── Question card expansion ───────────────────────────────────────────────────

describe('WrongAnswerAudit — question card toggle', () => {
  it('shows no question cards before any toggle', () => {
    renderAudit([makeItem(1)])
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument()
  })

  it('calls getSubtopicQuestions with correct args when expanded', async () => {
    const user = userEvent.setup()
    const exams = [{ id: 'e1' }]
    renderAudit([makeItem(1)], { name: 'Alice', exams })
    await user.click(screen.getByRole('button', { name: /show questions/i }))
    expect(getSubtopicQuestions).toHaveBeenCalledWith('Chapter 1', 'Subtopic 1', 'Alice', exams)
  })

  it('shows question cards when getSubtopicQuestions returns wrong questions', async () => {
    const user = userEvent.setup()
    const qObj = { q: 42, chapter: 'Chapter 1', subtopic: 'Subtopic 1' }
    getSubtopicQuestions.mockReturnValue({
      wrong: [{ qObj, examName: 'Test 1', examDate: '2024-01-01', examId: 'e1', studentResult: -1 }],
      skipped: [],
    })
    groupByExam.mockReturnValue([{
      examName: 'Test 1', examDate: '2024-01-01', examId: 'e1',
      items: [{ qObj, studentResult: -1 }],
    }])
    renderAudit([makeItem(1)])
    await user.click(screen.getByRole('button', { name: /show questions/i }))
    expect(screen.getByTestId('question-card')).toBeInTheDocument()
  })

  it('shows "no question details" message when wrong questions array is empty', async () => {
    const user = userEvent.setup()
    getSubtopicQuestions.mockReturnValue({ wrong: [], skipped: [] })
    groupByExam.mockReturnValue([])
    renderAudit([makeItem(1)])
    await user.click(screen.getByRole('button', { name: /show questions/i }))
    expect(screen.getByText(/no question details/i)).toBeInTheDocument()
  })

  it('button label changes to "Hide Questions" when expanded', async () => {
    const user = userEvent.setup()
    renderAudit([makeItem(1)])
    await user.click(screen.getByRole('button', { name: /show questions/i }))
    expect(screen.getByRole('button', { name: /hide questions/i })).toBeInTheDocument()
  })

  it('hides question cards when Hide Questions is clicked', async () => {
    const user = userEvent.setup()
    const qObj = { q: 1, chapter: 'Chapter 1', subtopic: 'Subtopic 1' }
    getSubtopicQuestions.mockReturnValue({
      wrong: [{ qObj, examName: 'Test 1', examDate: '2024-01-01', examId: 'e1', studentResult: -1 }],
      skipped: [],
    })
    groupByExam.mockReturnValue([{
      examName: 'Test 1', examDate: '2024-01-01', examId: 'e1',
      items: [{ qObj, studentResult: -1 }],
    }])
    renderAudit([makeItem(1)])
    await user.click(screen.getByRole('button', { name: /show questions/i }))
    expect(screen.getByTestId('question-card')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /hide questions/i }))
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument()
  })

  it('expanding one row does not expand other rows', async () => {
    const user = userEvent.setup()
    const qObj = { q: 1, chapter: 'Chapter 1', subtopic: 'Subtopic 1' }
    getSubtopicQuestions.mockReturnValue({
      wrong: [{ qObj, examName: 'Test 1', examDate: '2024-01-01', examId: 'e1', studentResult: -1 }],
      skipped: [],
    })
    groupByExam.mockReturnValue([{
      examName: 'Test 1', examDate: '2024-01-01', examId: 'e1',
      items: [{ qObj, studentResult: -1 }],
    }])
    renderAudit(makeItems(3))
    // Click the first row's Show Questions button
    const buttons = screen.getAllByRole('button', { name: /show questions/i })
    await user.click(buttons[0])
    // Only one question card should appear
    expect(screen.getAllByTestId('question-card')).toHaveLength(1)
    // Other rows still show "Show Questions"
    expect(screen.getAllByRole('button', { name: /show questions/i })).toHaveLength(2)
  })

  it('shows exam name and date header above question cards', async () => {
    const user = userEvent.setup()
    const qObj = { q: 5, chapter: 'Chapter 1', subtopic: 'Subtopic 1' }
    getSubtopicQuestions.mockReturnValue({
      wrong: [{ qObj, examName: 'Mock Test 3', examDate: '2024-03-01', examId: 'e3', studentResult: -1 }],
      skipped: [],
    })
    groupByExam.mockReturnValue([{
      examName: 'Mock Test 3', examDate: '2024-03-01', examId: 'e3',
      items: [{ qObj, studentResult: -1 }],
    }])
    renderAudit([makeItem(1)])
    await user.click(screen.getByRole('button', { name: /show questions/i }))
    expect(screen.getByText('Mock Test 3')).toBeInTheDocument()
  })
})
