import { describe, it, expect } from 'vitest'
import { calibrate, decideQuestion, readSheet, MIN_CONTRAST } from '../readBubbles'

// The reader's job is NOT to maximise how many answers it extracts. It is to be
// right about the ones it reports and to hand everything else to a human. A
// silently misread bubble becomes a wrong mark in a parent's WhatsApp, which is
// far worse than a slow manual pass — the same posture as `assessMarking`
// refusing and `findKeyMismatches` surfacing rather than overwriting.

const q = (n, scores) => ({ q: n, options: ['A', 'B', 'C', 'D'], scores })

describe('calibrate', () => {
  it('finds the empty baseline and the filled level from the sheet itself', () => {
    // a realistic sheet: mostly empty paper, a minority of heavy marks
    const scores = [...Array(120).fill(0.08), ...Array(30).fill(0.82)]
    const cal = calibrate(scores)
    expect(cal.blank).toBe(false)
    expect(cal.low).toBeLessThan(0.2)
    expect(cal.high).toBeGreaterThan(0.7)
    expect(cal.fillAt).toBeGreaterThan(cal.emptyAt)
  })

  it('calls a sheet with no marks BLANK rather than 600 ambiguities', () => {
    // an unfilled sheet has no contrast to stretch: scaling its noise would
    // turn every bubble into a review item and bury the operator.
    const cal = calibrate(Array.from({ length: 600 }, (_, i) => 0.07 + (i % 5) * 0.002))
    expect(cal.blank).toBe(true)
  })

  it('handles a sheet where almost nothing was answered', () => {
    // A high quantile assumes a predictable share of bubbles is inked. A student
    // who answered three questions breaks that assumption, the range collapses,
    // and the sheet reads as blank — so the filled level is the maximum.
    const scores = [...Array(168).fill(0.05), 0.92, 0.9]
    const cal = calibrate(scores)
    expect(cal.blank).toBe(false)
    expect(0.92).toBeGreaterThan(cal.fillAt)
    expect(0.05).toBeLessThan(cal.emptyAt)
  })

  it('is not fooled by pencil — it calibrates on contrast, not absolute darkness', () => {
    const pen = calibrate([...Array(100).fill(0.06), ...Array(20).fill(0.9)])
    const pencil = calibrate([...Array(100).fill(0.06), ...Array(20).fill(0.42)])
    expect(pen.blank).toBe(false)
    expect(pencil.blank).toBe(false)
    // a faint-but-clear pencil mark still sits above its own sheet's fill line
    expect(0.42).toBeGreaterThan(pencil.fillAt)
  })
})

describe('decideQuestion', () => {
  const cal = calibrate([...Array(100).fill(0.08), ...Array(25).fill(0.85)])

  it('reads a single clear mark', () => {
    const d = decideQuestion(q(1, [0.08, 0.85, 0.07, 0.09]), cal)
    expect(d.state).toBe('single')
    expect(d.choice).toBe('B')
    expect(d.review).toBe(false)
  })

  it('reads an untouched row as blank, not as a guess', () => {
    const d = decideQuestion(q(2, [0.08, 0.07, 0.09, 0.08]), cal)
    expect(d.state).toBe('blank')
    expect(d.choice).toBeNull()
    expect(d.review).toBe(false)
  })

  it('reports a double mark as MULTI and never picks one of them', () => {
    // Evalbee scores a double mark wrong even when one of the two is the key,
    // so the distinction has to survive: `multi` is not `blank`.
    const d = decideQuestion(q(3, [0.85, 0.02, 0.88, 0.05]), cal)
    expect(d.state).toBe('multi')
    expect(d.choice).toBeNull()
    expect(d.marked).toEqual(['A', 'C'])
    expect(d.review).toBe(true)
  })

  it('sends a half-filled bubble to review instead of deciding it', () => {
    const d = decideQuestion(q(4, [0.08, 0.45, 0.07, 0.06]), cal)
    expect(d.state).toBe('review')
    expect(d.choice).toBeNull()
    expect(d.review).toBe(true)
  })

  it('sends an erasure — one clear mark plus one smudge — to review', () => {
    const d = decideQuestion(q(5, [0.85, 0.44, 0.06, 0.08]), cal)
    expect(d.review).toBe(true)
    expect(d.choice).toBeNull()
  })

  it('keeps the raw scores, so a reviewer sees why', () => {
    const d = decideQuestion(q(6, [0.08, 0.45, 0.07, 0.06]), cal)
    expect(d.scores).toEqual([0.08, 0.45, 0.07, 0.06])
  })
})

describe('readSheet', () => {
  const rows = [
    q(1, [0.85, 0.06, 0.07, 0.08]),   // A
    q(2, [0.06, 0.07, 0.88, 0.05]),   // C
    q(3, [0.07, 0.06, 0.08, 0.07]),   // blank
    q(4, [0.86, 0.84, 0.05, 0.06]),   // multi
    q(5, [0.07, 0.46, 0.06, 0.08]),   // review
  ]

  it('answers what it is sure of and flags the rest', () => {
    const r = readSheet(rows)
    expect(r.answers[1]).toBe('A')
    expect(r.answers[2]).toBe('C')
    expect(r.answers[3]).toBeNull()
    expect(r.answers[4]).toBeNull()
    expect(r.answers[5]).toBeNull()
    expect(r.reviewCount).toBe(2)
    expect(r.needsReview.map(d => d.q)).toEqual([4, 5])
  })

  it('refuses to be saved while anything is unresolved', () => {
    // mirrors writtenQuizCompletion().complete — a half-read stack must not be
    // committable as if it were finished.
    expect(readSheet(rows).complete).toBe(false)
    expect(readSheet(rows.filter(r => r.q <= 3)).complete).toBe(true)
  })

  it('reads a blank sheet as 150 blanks, not 150 review items', () => {
    const blankRows = Array.from({ length: 150 }, (_, i) => q(i + 1, [0.07, 0.08, 0.07, 0.06]))
    const r = readSheet(blankRows)
    expect(r.reviewCount).toBe(0)
    expect(Object.values(r.answers).every(a => a === null)).toBe(true)
    expect(r.calibration.blank).toBe(true)
  })

  it('exposes the contrast it worked from, so a bad capture is diagnosable', () => {
    const r = readSheet(rows)
    expect(r.calibration.high - r.calibration.low).toBeGreaterThan(MIN_CONTRAST)
  })
})
