import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = { exams: [] }
vi.mock('../../../store/useStore', () => ({ default: (selector) => selector(mockStore) }))

import ItemStatsPage from '../index'

const Q = n => `${String(n).repeat(8)}-1111-4111-8111-111111111111`

// rows: [totalMarks, verdict, chosen]
function exam(id, subject, questions, rows) {
  return {
    id, name: `Exam ${id}`, date: '2026-09-01', subject, questions,
    students: rows.map(([total, verdict, chose], i) => ({
      name: `S${id}${i}`, totalMarks: total,
      responses: Object.fromEntries(questions.map(q => [q.q, verdict])),
      choices: Object.fromEntries(questions.map(q => [q.q, chose])),
    })),
  }
}

function setExams(list) { mockStore.exams = list }

// Both fixtures have 4 attempts, which is below the default threshold — so most
// tests drop the threshold first. That is deliberate: the default must hide
// thin evidence, and a test that never exercises the filter would not notice.
// fireEvent, not userEvent: clearing a CONTROLLED number input snaps it back to
// its fallback, so `clear` then `type('1')` lands on 11, not 1 — and 11 still
// hides a 4-attempt fixture. Setting the value outright is what we mean.
function showEverything() {
  fireEvent.change(screen.getByLabelText(/min attempts/i), { target: { value: '1' } })
}

beforeEach(() => {
  setExams([
    exam('m1', 'Maths', [{ q: 1, questionId: Q(1), chapter: 'Vectors', subtopic: 'Dot', answer: 'B', question: 'find a dot b' }],
      [[10, -1, 'C'], [9, -1, 'C'], [8, -1, 'C'], [7, 1, 'B']]),
    exam('g1', 'GAT', [{ q: 1, questionId: Q(2), chapter: 'Optics', subtopic: 'Lens', answer: 'A', question: 'focal length?' }],
      [[10, 1, 'A'], [9, 1, 'A'], [8, -1, 'B'], [7, 1, 'A']]),
  ])
})

describe('ItemStatsPage — the table', () => {
  it('lists a row per bank question, worst key-vs-distractor first', () => {
    render(<ItemStatsPage />)
    showEverything()
    const rows = screen.getAllByTestId('item-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText(/find a dot b/)).toBeInTheDocument()  // 3:1 against the key
  })

  it('shows the numbers, not just the question', () => {
    render(<ItemStatsPage />)
    showEverything()
    const first = screen.getAllByTestId('item-row')[0]
    expect(within(first).getByText('25%')).toBeInTheDocument()   // 1 of 4 attempted
    expect(within(first).getByText('B')).toBeInTheDocument()     // the key
  })

  it('has a header naming every column', () => {
    render(<ItemStatsPage />)
    for (const col of ['Question', 'Attempts', 'Correct', 'Skipped', 'Key', 'Vs key', 'Discrim']) {
      expect(screen.getByRole('columnheader', { name: col })).toBeInTheDocument()
    }
  })
})

describe('ItemStatsPage — filters', () => {
  it('HIDES thin evidence by default, and says how many', () => {
    render(<ItemStatsPage />)   // 4 attempts each, threshold 20
    expect(screen.queryAllByTestId('item-row')).toHaveLength(0)
    expect(screen.getByText(/2 .*below 20 attempts/i)).toBeInTheDocument()
  })

  it('filters by subject', async () => {
    const user = userEvent.setup()
    render(<ItemStatsPage />)
    showEverything()
    await user.selectOptions(screen.getByLabelText(/subject/i), 'GAT')
    const rows = screen.getAllByTestId('item-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText(/focal length/)).toBeInTheDocument()
  })

  it('filters by chapter', async () => {
    const user = userEvent.setup()
    render(<ItemStatsPage />)
    showEverything()
    await user.selectOptions(screen.getByLabelText(/chapter/i), 'Vectors')
    expect(screen.getAllByTestId('item-row')).toHaveLength(1)
  })

  it('sorts by percent correct when asked', async () => {
    const user = userEvent.setup()
    render(<ItemStatsPage />)
    showEverything()
    await user.selectOptions(screen.getByLabelText(/sort/i), 'pCorrect')
    const rows = screen.getAllByTestId('item-row')
    expect(within(rows[0]).getByText(/find a dot b/)).toBeInTheDocument()  // 25% < 75%
  })
})

describe('ItemStatsPage — findings and empty states', () => {
  it('surfaces a question keyed differently in two sittings', () => {
    setExams([
      exam('a', 'Maths', [{ q: 1, questionId: Q(3), chapter: 'Algebra', answer: 'B', question: 'conflicted' }], [[10, 1, 'B']]),
      exam('b', 'Maths', [{ q: 1, questionId: Q(3), chapter: 'Algebra', answer: 'C', question: 'conflicted' }], [[10, 1, 'C']]),
    ])
    render(<ItemStatsPage />)
    expect(screen.getByText(/keyed differently/i)).toBeInTheDocument()
    expect(screen.getByText(/conflicted/)).toBeInTheDocument()
  })

  it('says so plainly when no exam carries bank ids', () => {
    setExams([exam('x', 'Maths', [{ q: 1, chapter: 'Algebra', answer: 'A' }], [[10, 1, 'A']])])
    render(<ItemStatsPage />)
    expect(screen.getByText(/no questions.*bank/i)).toBeInTheDocument()
  })
})
