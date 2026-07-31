import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectedScoreCard from '../ProjectedScoreCard'

// QuestionCard renders KaTeX and option grids; stub it so these tests assert
// which questions surface, not how a question paints.
vi.mock('../../../components/ui/QuestionCard', () => ({
  default: ({ q, studentResult, showRemediation }) => (
    <div data-testid="qcard" data-q={q.q} data-result={studentResult}
         data-remediation={String(!!showRemediation)} />
  ),
}))

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

  // ── Student variant ─────────────────────────────────────────────────────
  // Students see the opportunity list but not the projected score itself. The
  // number is a prediction about their own future exam and the weakest part of
  // the model — it extrapolates a chapter's accuracy over subtopics they have
  // never been tested on. Per-row marks stay: "Statistics is worth 22" is a
  // diagnosis they can act on.
  describe('showScore={false} — the student variant', () => {
    const studentProps = { ...base, projected: { total: 83, breakdown, subtopicBreakdown }, showScore: false }

    it('hides the headline score and the SSB/merit/rank scale', () => {
      render(<ProjectedScoreCard {...studentProps} />)
      expect(screen.queryByText('83')).not.toBeInTheDocument()
      expect(screen.queryByText(/out of 300/)).not.toBeInTheDocument()
      expect(screen.queryByText(/SSB/)).not.toBeInTheDocument()
      expect(screen.queryByText(/merit/)).not.toBeInTheDocument()
      expect(screen.queryByText(/rank/)).not.toBeInTheDocument()
    })

    it('still shows the opportunity rows, with their per-row marks', () => {
      render(<ProjectedScoreCard {...studentProps} />)
      expect(screen.getByText('Matrices & Determinants')).toBeInTheDocument()
      expect(screen.getByText('8.3')).toBeInTheDocument()      // projected
      expect(screen.getByText('/ 23.1')).toBeInTheDocument()   // marks at stake
    })

    it('still offers the subtopic toggle', async () => {
      const user = userEvent.setup()
      render(<ProjectedScoreCard {...studentProps} />)
      await user.click(screen.getByRole('button', { name: /subtopics/i }))
      expect(screen.getByText('Subtopic 1')).toBeInTheDocument()
    })

    it('drops the Settings pointer — a student has no Settings page', () => {
      render(<ProjectedScoreCard {...studentProps} />)
      expect(screen.queryByText(/Settings/)).not.toBeInTheDocument()
    })

    it('does not title itself a score it is not showing', () => {
      render(<ProjectedScoreCard {...studentProps} />)
      expect(screen.queryByText(/Projected NDA/i)).not.toBeInTheDocument()
    })

    it('keeps the score for faculty by default', () => {
      render(<ProjectedScoreCard {...base} projected={{ total: 83, breakdown, subtopicBreakdown }} />)
      expect(screen.getByText('83')).toBeInTheDocument()
      expect(screen.getByText(/Projected NDA/i)).toBeInTheDocument()
    })
  })

  it('names chapters that have no subtopic taxonomy instead of dropping them silently', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...base}
      projected={{ total: 83, breakdown, subtopicBreakdown, subtopicsUncovered: ['Polynomials'] }} />)
    await user.click(screen.getByRole('button', { name: /subtopics/i }))
    expect(screen.getByText(/Polynomials/)).toBeInTheDocument()
  })
})

// ── Question drill-down ─────────────────────────────────────────────────────
// A subtopic row opens into the actual questions behind its number, reusing
// getSubtopicQuestions + QuestionCard rather than a second implementation.
// Absent is deliberately absent: it is a coverage fact, not a performance one,
// and the student payload ships no questions for unsat papers.

describe('ProjectedScoreCard — question drill-down', () => {
  const exams = [{
    id: 'e1', name: 'Mock 1', date: '2026-07-01',
    questions: [
      { q: 1, chapter: 'Matrices & Determinants', subtopic: 'Subtopic 1' },
      { q: 2, chapter: 'Matrices & Determinants', subtopic: 'Subtopic 1' },
      { q: 3, chapter: 'Matrices & Determinants', subtopic: 'Subtopic 1' },
      { q: 4, chapter: 'Lines', subtopic: 'Subtopic 2' },
    ],
    students: [{ name: 'Alice', responses: { 1: 1, 2: -1, 3: 0, 4: 1 } }],
  }]
  const props = {
    ...base,
    projected: { total: 83, breakdown, subtopicBreakdown },
    name: 'Alice',
    exams,
  }

  async function openSubtopics(user) {
    await user.click(screen.getByRole('button', { name: /subtopics/i }))
  }

  it('shows nothing until a row is opened', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...props} />)
    await openSubtopics(user)
    expect(screen.queryAllByTestId('qcard')).toHaveLength(0)
  })

  it('opens a row into its right / wrong / skipped counts', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...props} />)
    await openSubtopics(user)
    await user.click(screen.getByRole('button', { name: 'Subtopic 1' }))

    expect(screen.getByRole('button', { name: /1 Right/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 Wrong/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 Skipped/ })).toBeInTheDocument()
  })

  it('reveals the questions for the bucket that is clicked, and only that one', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...props} />)
    await openSubtopics(user)
    await user.click(screen.getByRole('button', { name: 'Subtopic 1' }))
    await user.click(screen.getByRole('button', { name: /1 Wrong/ }))

    const cards = screen.getAllByTestId('qcard')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveAttribute('data-q', '2')
    expect(cards[0]).toHaveAttribute('data-result', '-1')
  })

  it('does not offer remediation on a question the student got right', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...props} />)
    await openSubtopics(user)
    await user.click(screen.getByRole('button', { name: 'Subtopic 1' }))
    await user.click(screen.getByRole('button', { name: /1 Right/ }))

    expect(screen.getByTestId('qcard')).toHaveAttribute('data-remediation', 'false')
  })

  it('offers remediation on a wrong question', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...props} />)
    await openSubtopics(user)
    await user.click(screen.getByRole('button', { name: 'Subtopic 1' }))
    await user.click(screen.getByRole('button', { name: /1 Wrong/ }))

    expect(screen.getByTestId('qcard')).toHaveAttribute('data-remediation', 'true')
  })

  it('stays inert when the card is rendered without exam data', async () => {
    const user = userEvent.setup()
    render(<ProjectedScoreCard {...base} projected={{ total: 83, breakdown, subtopicBreakdown }} />)
    await openSubtopics(user)
    // No name/exams props — rows must not pretend to be expandable.
    expect(screen.queryByRole('button', { name: 'Subtopic 1' })).not.toBeInTheDocument()
  })

  it('does not drill down in the chapter view', async () => {
    render(<ProjectedScoreCard {...props} />)
    expect(screen.queryByRole('button', { name: /Matrices & Determinants/ })).not.toBeInTheDocument()
  })
})
