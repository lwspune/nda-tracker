import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectedScoreCard from '../ProjectedScoreCard'

const breakdown = [
  { chapter: 'Matrices & Determinants', marksAtStake: 23.1, projected: 8.3, accuracy: 0.4, gap: 14.8 },
  { chapter: 'Lines', marksAtStake: 13.5, projected: 0, accuracy: null, gap: 13.5 },
]

// 12 rows so the 10-row cap and the expander are both exercised.
const subtopicBreakdown = Array.from({ length: 12 }, (_, i) => ({
  chapter: i % 2 ? 'Lines' : 'Matrices & Determinants',
  subtopic: `Subtopic ${i + 1}`,
  marksAtStake: 12 - i,
  projected: i === 0 ? 0 : 1,
  gap: 12 - i,
  accuracy: i === 0 ? null : 0.3,
  pctHard: 20,
  n: i === 0 ? 0 : 5,
  correct: 1, wrong: 2, skipped: 2,
}))

const base = { primarySubject: 'Maths', subjectMaxScore: 300 }

describe('ProjectedScoreCard', () => {
  it('opens on the chapter view', () => {
    render(<ProjectedScoreCard {...base} projected={{ total: 83, breakdown, subtopicBreakdown }} />)
    expect(screen.getByText('Matrices & Determinants')).toBeInTheDocument()
    expect(screen.queryByText('Subtopic 1')).not.toBeInTheDocument()
  })

  it('hides the toggle when there is no subtopic data (non-Maths subjects)', () => {
    render(<ProjectedScoreCard {...base} primarySubject="English"
                               projected={{ total: 83, breakdown }} />)
    expect(screen.queryByRole('button', { name: /subtopics/i })).not.toBeInTheDocument()
  })

  it('switches to a flat subtopic list capped at 10 rows', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...base} projected={{ total: 83, breakdown, subtopicBreakdown }} />)

    await user.click(screen.getByRole('button', { name: /subtopics/i }))

    expect(screen.getByText('Subtopic 1')).toBeInTheDocument()
    expect(screen.getByText('Subtopic 10')).toBeInTheDocument()
    expect(screen.queryByText('Subtopic 11')).not.toBeInTheDocument()
    // Each row names its parent chapter — the list is cross-chapter, so the
    // subtopic name alone would not say where it came from.
    expect(screen.getAllByText('Matrices & Determinants').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Lines').length).toBeGreaterThan(0)
  })

  it('reveals the rest behind an expander that names the true count', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...base} projected={{ total: 83, breakdown, subtopicBreakdown }} />)
    await user.click(screen.getByRole('button', { name: /subtopics/i }))

    await user.click(screen.getByRole('button', { name: /show all 12/i }))
    expect(screen.getByText('Subtopic 12')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show top 10/i }))
    expect(screen.queryByText('Subtopic 12')).not.toBeInTheDocument()
  })

  it('marks an untested subtopic rather than showing it as a zero score', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...base} projected={{ total: 83, breakdown, subtopicBreakdown }} />)
    await user.click(screen.getByRole('button', { name: /subtopics/i }))
    // Row 1 has accuracy null / n 0 — the same treatment chapter rows already use.
    expect(screen.getAllByText('not tested').length).toBeGreaterThan(0)
  })

  it('names chapters that have no subtopic taxonomy instead of dropping them silently', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...base}
      projected={{ total: 83, breakdown, subtopicBreakdown, subtopicsUncovered: ['Polynomials'] }} />)
    await user.click(screen.getByRole('button', { name: /subtopics/i }))
    expect(screen.getByText(/Polynomials/)).toBeInTheDocument()
  })
})
