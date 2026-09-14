import { describe, it, expect } from 'vitest'
import { resolveQuestion, assignStudent, withCompleteness } from '../reviewSheet'

const flagged = (q, scores = [0.1, 0.45, 0.1, 0.1]) =>
  ({ q, state: 'review', choice: null, review: true, scores })
const settled = (q, choice) =>
  ({ q, state: 'single', choice, review: false, scores: [0.9, 0, 0, 0] })

const sheet = (o = {}) => {
  const decisions = o.decisions || [settled(1, 'A'), settled(2, 'C')]
  const needsReview = decisions.filter(d => d.review)
  return {
    ok: true,
    decisions,
    needsReview,
    reviewCount: needsReview.length,
    answers: Object.fromEntries(decisions.map(d => [d.q, d.choice])),
    roll: { digits: '00013', review: false, reason: null },
    student: { lwsId: 'LWS-013', review: false, reason: null, candidates: [] },
    complete: true,
    ...o,
  }
}

describe('withCompleteness', () => {
  it('is complete when every question is settled and the student is known', () => {
    expect(withCompleteness(sheet()).complete).toBe(true)
  })

  it('is not complete while a question is flagged', () => {
    const r = withCompleteness(sheet({ decisions: [flagged(1), settled(2, 'C')] }))
    expect(r.complete).toBe(false)
    expect(r.reviewCount).toBe(1)
  })

  it('is not complete while nobody knows whose sheet it is', () => {
    const r = withCompleteness(sheet({
      student: { lwsId: null, review: true, reason: 'roll 00099 is not on the roster', candidates: [] },
    }))
    expect(r.complete).toBe(false)
  })

  // The roll number is a ROUTE to identity, not a question in its own right. A
  // sheet handed in with the roll block untouched is complete once a human says
  // who it belongs to — gating on the roll as well meant assigning the student
  // by hand could never unblock the save, which is the whole point of doing it.
  it('is complete once the student is known, even if the roll never read', () => {
    const r = withCompleteness(sheet({
      roll: { digits: null, review: true, reason: 'roll number left blank' },
      student: { lwsId: 'LWS-013', review: false, reason: null, candidates: [] },
    }))
    expect(r.complete).toBe(true)
  })

  it('keeps needsReview and answers in step with the decisions', () => {
    const r = withCompleteness(sheet({ decisions: [settled(1, 'B'), flagged(2)] }))
    expect(r.needsReview.map(d => d.q)).toEqual([2])
    expect(r.answers).toEqual({ 1: 'B', 2: null })
  })
})

describe('resolveQuestion', () => {
  const withFlag = sheet({ decisions: [flagged(1), settled(2, 'C')] })

  it('takes the letter a human picked', () => {
    const r = resolveQuestion(withFlag, 1, 'B')
    expect(r.answers[1]).toBe('B')
    expect(r.decisions[0].state).toBe('single')
    expect(r.complete).toBe(true)
  })

  it('takes "blank" as unanswered', () => {
    const r = resolveQuestion(withFlag, 1, 'blank')
    expect(r.answers[1]).toBeNull()
    expect(r.decisions[0].state).toBe('blank')
    expect(r.complete).toBe(true)
  })

  // Evalbee grades a double mark WRONG, not unanswered, and a scanned sheet has
  // to agree or the same paper scores differently depending on who read it.
  it('takes "multi" as a double mark, which grades wrong rather than blank', () => {
    const r = resolveQuestion(withFlag, 1, 'multi')
    expect(r.decisions[0].state).toBe('multi')
    expect(r.answers[1]).toBeNull()
  })

  it('leaves the other questions alone', () => {
    const r = resolveQuestion(withFlag, 1, 'B')
    expect(r.answers[2]).toBe('C')
  })

  it('does not mutate the sheet it was given', () => {
    resolveQuestion(withFlag, 1, 'B')
    expect(withFlag.answers[1]).toBeNull()
    expect(withFlag.decisions[0].review).toBe(true)
  })
})

describe('assignStudent', () => {
  const unknown = sheet({
    complete: false,
    roll: { digits: '00099', review: false, reason: null },
    student: { lwsId: null, review: true, reason: 'roll 00099 is not on the roster', candidates: [] },
  })

  it('settles who the sheet belongs to', () => {
    const r = assignStudent(unknown, 'LWS-042')
    expect(r.student.lwsId).toBe('LWS-042')
    expect(r.student.review).toBe(false)
    expect(r.complete).toBe(true)
  })

  // Provenance: a mark filed against a name a human chose is a different thing
  // from one the roll number resolved, and a later question about it should be
  // answerable.
  it('records that a human chose it', () => {
    expect(assignStudent(unknown, 'LWS-042').student.matchedBy).toBe('manual')
  })

  it('does not unblock a sheet that still has a flagged question', () => {
    const both = sheet({
      complete: false,
      decisions: [flagged(1), settled(2, 'C')],
      student: { lwsId: null, review: true, reason: 'no roll number read', candidates: [] },
    })
    expect(assignStudent(both, 'LWS-042').complete).toBe(false)
  })

  it('refuses an empty choice rather than filing against nobody', () => {
    const r = assignStudent(unknown, '')
    expect(r.student.lwsId).toBeNull()
    expect(r.student.review).toBe(true)
    expect(r.complete).toBe(false)
  })

  it('does not mutate the sheet it was given', () => {
    assignStudent(unknown, 'LWS-042')
    expect(unknown.student.lwsId).toBeNull()
  })
})
