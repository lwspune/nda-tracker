// Tests for ChapterAccordion — the chapter rows of Chapter Performance.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

// QuestionCard pulls in the store + KaTeX; its rendering is tested elsewhere.
vi.mock('../../../components/ui/QuestionCard', () => ({
  default: ({ q }) => <div data-testid="qcard">Q{q.q}</div>,
}))

import ChapterAccordion from '../ChapterAccordion'

function ea(examId, { correct = 0, wrong = 0, skipped = 0 } = {}) {
  return { examId, examName: `Exam ${examId}`, date: '2026-05-01', correct, wrong, skipped }
}

const SUMMARY = [
  {
    ch: 'Matrices & Determinants', avg: 0, trend: 'flat',
    subs: {
      'Inverse of a Matrix': { weightedScore: 0, examsArr: [ea('e1', { wrong: 2, skipped: 1 })] },
    },
  },
  {
    ch: 'Trigonometric Identities', avg: 0.46, trend: 'flat',
    subs: {
      'Compound Angles': { weightedScore: 0.4, examsArr: [ea('e1', { correct: 2, wrong: 3 }), ea('e2', { wrong: 1, skipped: 2 })] },
      'Multiple Angles': { weightedScore: 0.5, examsArr: [ea('e2', { correct: 1, skipped: 4 })] },
    },
  },
]

const rowFor = ch => screen.getByRole('button', { name: new RegExp(ch.replace(/[&]/g, '\\&')) })

describe('ChapterAccordion — chapter rows', () => {
  it('makes each chapter row a button that reports whether it is open', async () => {
    render(<ChapterAccordion chapterSummary={SUMMARY} name="Alice" exams={[]} />)
    const row = rowFor('Matrices & Determinants')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens from the keyboard', async () => {
    render(<ChapterAccordion chapterSummary={SUMMARY} name="Alice" exams={[]} />)
    const row = rowFor('Trigonometric Identities')
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a 0% chapter as "0%" rather than an empty bar', () => {
    render(<ChapterAccordion chapterSummary={SUMMARY} name="Alice" exams={[]} />)
    expect(within(rowFor('Matrices & Determinants')).getByText('0%')).toBeInTheDocument()
  })

  it('shows how many questions were wrong and skipped across the chapter', () => {
    render(<ChapterAccordion chapterSummary={SUMMARY} name="Alice" exams={[]} />)
    // 3 + 1 wrong; 2 + 4 skipped — summed over every subtopic and exam
    expect(within(rowFor('Trigonometric Identities')).getByText('4 wrong · 6 skipped')).toBeInTheDocument()
    expect(within(rowFor('Matrices & Determinants')).getByText('2 wrong · 1 skipped')).toBeInTheDocument()
  })

  it('prints the whole chapter name', () => {
    render(<ChapterAccordion chapterSummary={SUMMARY} name="Alice" exams={[]} />)
    expect(screen.getByText('Trigonometric Identities')).toBeInTheDocument()
  })
})
