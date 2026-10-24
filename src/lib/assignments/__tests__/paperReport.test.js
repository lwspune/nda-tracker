import { describe, it, expect } from 'vitest'
import { buildPaperReport, causeLabel, LOSS_ORDER } from '../paperReport'

// Grade rows in the student-payload shape.
const g = (label, maxMarks, awarded, cause = null, topic = null, over = {}) => ({
  position: Number(label.slice(1)), label, maxMarks,
  outcome: awarded === null ? 'not_attempted' : 'scored', awarded,
  earned: null, missing: awarded !== null && awarded < maxMarks ? `What ${label} missed.` : null,
  cause, topic, ...over,
})

const grades = [
  g('Q1', 1, 1),
  g('Q2', 1, 0, 'mcq'),
  g('Q3', 2, 1, 'concept', 'Distributive property'),
  g('Q4', 3, 2.5, 'careless'),
  g('Q5', 5, 1.5, 'incomplete', 'Steps of construction'),
  g('Q6', 5, 4.5, 'careless'),
  g('Q7', 3, null),
  g('Q8', 3, 2, 'misread'),
]
const r = buildPaperReport(grades)

describe('buildPaperReport — the score', () => {
  it('totals the marks, out of every question, and rounds the percent', () => {
    expect(r.total).toBe(12.5)
    expect(r.max).toBe(23)
    expect(r.pct).toBe(54)
  })

  it('counts full, partial, zero and not attempted', () => {
    expect(r.counts).toEqual({ questions: 8, full: 1, partial: 5, zero: 1, notAttempted: 1 })
  })
})

describe('buildPaperReport — where the marks went', () => {
  it('adds lost marks up by cause, in a fixed order, skipping causes that cost nothing', () => {
    expect(r.lost.map(l => [l.key, l.marks, l.questions])).toEqual([
      ['concept', 1, ['Q3']],
      ['incomplete', 3.5, ['Q5']],
      ['careless', 1, ['Q4', 'Q6']],
      ['misread', 1, ['Q8']],
      ['mcq', 1, ['Q2']],
      ['not_attempted', 3, ['Q7']],
    ])
    expect(r.lost.every(l => typeof l.label === 'string' && l.label)).toBe(true)
  })

  // The chart's bars must add back up to the score.
  it('reconciles: maximum minus every loss is the score', () => {
    expect(r.max - r.lost.reduce((s, l) => s + l.marks, 0)).toBe(r.total)
  })

  it('files lost marks saved before causes existed under one "other" bucket', () => {
    const old = buildPaperReport([g('Q1', 5, 3, null), g('Q2', 5, 5)])
    expect(old.lost).toEqual([{ key: 'other', label: expect.any(String), marks: 2, questions: ['Q1'] }])
    expect(old.max - old.lost.reduce((s, l) => s + l.marks, 0)).toBe(old.total)
  })

  it('lists every cause the grader can choose, plus not attempted and other', () => {
    expect(LOSS_ORDER).toEqual(['concept', 'incomplete', 'careless', 'misread', 'mcq', 'not_attempted', 'other'])
  })
})

describe('buildPaperReport — what a careful second attempt is worth', () => {
  it('adds the slips back for the potential score', () => {
    expect(r.potential).toEqual({ marks: 13.5, pct: 59, avoidable: 1, questions: ['Q4', 'Q6'] })
  })

  it('is the score itself when nothing was a slip', () => {
    const clean = buildPaperReport([g('Q1', 2, 2)])
    expect(clean.potential).toEqual({ marks: 2, pct: 100, avoidable: 0, questions: [] })
  })
})

describe('buildPaperReport — what to focus on', () => {
  // The biggest losses that need learning, not just care: concept gaps, work
  // left out, a misread question.
  it('picks up to three, biggest loss first, with a heading from the cause and topic', () => {
    expect(r.focus).toEqual([
      { label: 'Q5', lost: 3.5, cause: 'incomplete', heading: 'Show full steps: Steps of construction', missing: 'What Q5 missed.' },
      { label: 'Q3', lost: 1, cause: 'concept', heading: 'Learn this again: Distributive property', missing: 'What Q3 missed.' },
      { label: 'Q8', lost: 1, cause: 'misread', heading: 'Read the question again', missing: 'What Q8 missed.' },
    ])
  })

  it('groups the rest of the lost marks into smaller fixes, by cause', () => {
    expect(r.smallerFixes.map(f => [f.cause, f.questions, f.marks])).toEqual([
      ['careless', ['Q4', 'Q6'], 1],
      ['mcq', ['Q2'], 1],
      ['not_attempted', ['Q7'], 3],
    ])
    expect(r.smallerFixes.every(f => f.heading && f.advice)).toBe(true)
  })

  it('moves a fourth learning question into the smaller fixes', () => {
    const many = buildPaperReport([
      g('Q1', 5, 0, 'concept', 'A'), g('Q2', 5, 1, 'concept', 'B'),
      g('Q3', 5, 2, 'incomplete', 'C'), g('Q4', 5, 4, 'concept', 'D'),
    ])
    expect(many.focus.map(f => f.label)).toEqual(['Q1', 'Q2', 'Q3'])
    expect(many.smallerFixes).toEqual([
      expect.objectContaining({ cause: 'concept', questions: ['Q4'], marks: 1 }),
    ])
  })

  it('has nothing to focus on for full marks', () => {
    const full = buildPaperReport([g('Q1', 3, 3), g('Q2', 2, 2)])
    expect(full.focus).toEqual([])
    expect(full.smallerFixes).toEqual([])
    expect(full.lost).toEqual([])
  })
})

describe('buildPaperReport — numbers', () => {
  it('keeps halves exact', () => {
    const halves = buildPaperReport([g('Q1', 0.5, 0, 'careless'), g('Q2', 1.5, 1, 'careless')])
    expect(halves.lost[0].marks).toBe(1)
    expect(halves.total).toBe(1)
  })

  it('reads numeric strings, as rows sometimes arrive', () => {
    const strs = buildPaperReport([{ ...g('Q1', 2, 1, 'careless'), maxMarks: '2', awarded: '1' }])
    expect(strs.total).toBe(1)
    expect(strs.max).toBe(2)
  })
})

describe('causeLabel', () => {
  it('names one question\'s loss for staff, with its topic', () => {
    expect(causeLabel('concept', 'Chain rule')).toBe('Concept gap: Chain rule')
    expect(causeLabel('incomplete', 'Steps of construction')).toBe('Steps left out: Steps of construction')
    expect(causeLabel('careless', null)).toBe('Calculation error')
    expect(causeLabel('misread', '')).toBe('Misread the question')
    expect(causeLabel('mcq', null)).toBe('Objective answer')
    expect(causeLabel(null, null)).toBe('')
  })
})
