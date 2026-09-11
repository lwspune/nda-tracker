import { render, screen, within } from '@testing-library/react'
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

beforeEach(() => {
  setExams([
    exam('m1', 'Maths', [{ q: 1, questionId: Q(1), chapter: 'Vectors', subtopic: 'Dot', answer: 'B', question: 'find a dot b' }],
      [[10, -1, 'C'], [9, -1, 'C'], [8, -1, 'C'], [7, 1, 'B']]),
    exam('g1', 'GAT', [{ q: 1, questionId: Q(2), chapter: 'Optics', subtopic: 'Lens', answer: 'A', question: 'focal length?' }],
      [[10, 1, 'A'], [9, 1, 'A'], [8, -1, 'B'], [7, 1, 'A']]),
  ])
})

describe('ItemStatsPage', () => {
  it('lists a row per bank question, worst key-vs-distractor first', () => {
    render(<ItemStatsPage />)
    const rows = screen.getAllByTestId('item-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText(/find a dot b/)).toBeInTheDocument()  // 3:1 against the key
  })

  it('filters by subject', async () => {
    const user = userEvent.setup()
    render(<ItemStatsPage />)
    await user.selectOptions(screen.getByLabelText(/subject/i), 'GAT')
    const rows = screen.getAllByTestId('item-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText(/focal length/)).toBeInTheDocument()
  })

  it('filters by chapter', async () => {
    const user = userEvent.setup()
    render(<ItemStatsPage />)
    await user.selectOptions(screen.getByLabelText(/chapter/i), 'Vectors')
    expect(screen.getAllByTestId('item-row')).toHaveLength(1)
  })

  it('sorts by percent correct when asked', async () => {
    const user = userEvent.setup()
    render(<ItemStatsPage />)
    await user.selectOptions(screen.getByLabelText(/sort/i), 'pCorrect')
    const rows = screen.getAllByTestId('item-row')
    expect(within(rows[0]).getByText(/find a dot b/)).toBeInTheDocument()  // 25% < 75%
  })

  it('surfaces a question keyed differently in two sittings', () => {
    setExams([
      exam('a', 'Maths', [{ q: 1, questionId: Q(3), chapter: 'Algebra', answer: 'B', question: 'conflicted' }], [[10, 1, 'B']]),
      exam('b', 'Maths', [{ q: 1, questionId: Q(3), chapter: 'Algebra', answer: 'C', question: 'conflicted' }], [[10, 1, 'C']]),
    ])
    render(<ItemStatsPage />)
    expect(screen.getByText(/keyed differently/i)).toBeInTheDocument()
    expect(screen.getByText(/conflicted/)).toBeInTheDocument()
  })

  it('marks thin evidence rather than hiding it', () => {
    render(<ItemStatsPage />)   // 4 attempts each, default threshold is 20
    expect(screen.getAllByText(/thin/i).length).toBeGreaterThan(0)
  })

  it('says so plainly when no exam carries bank ids', () => {
    setExams([exam('x', 'Maths', [{ q: 1, chapter: 'Algebra', answer: 'A' }], [[10, 1, 'A']])])
    render(<ItemStatsPage />)
    expect(screen.getByText(/no questions.*bank/i)).toBeInTheDocument()
  })
})
