import { describe, it, expect } from 'vitest'
import { validateGrade, OUTCOMES, GRADERS, MAX_FEEDBACK_CHARS } from '../grade'

const row = (over = {}) => ({
  label: 'Q1', max: 5, outcome: 'scored', awarded: 5, earned: 'Correct method and answer.', missing: '', ...over,
})

const file = (grades, over = {}) => ({
  wentWell: 'Clear working on Q1.',
  nextSteps: 'Revise the chain rule.',
  handwriting: { check: 'match', note: '' },
  grades,
  ...over,
})

describe('validateGrade — a sound grade', () => {
  it('passes, numbers positions in order, and sums the total', () => {
    const r = validateGrade({
      maxMarks: 10,
      file: file([row(), row({ label: 'Q2', awarded: 2.5, missing: 'No final answer.' })]),
    })
    expect(r.ok).toBe(true)
    expect(r.totalAwarded).toBe(7.5)
    expect(r.rows.map(x => [x.position, x.label])).toEqual([[1, 'Q1'], [2, 'Q2']])
    expect(r.rows[1]).toMatchObject({ maxMarks: 5, outcome: 'scored', awarded: 2.5, missing: 'No final answer.' })
  })

  it('stores a not-attempted question with null marks and null feedback', () => {
    const r = validateGrade({
      maxMarks: 10,
      file: file([row(), row({ label: 'Q2', outcome: 'not_attempted', awarded: null, earned: '', missing: '' })]),
    })
    expect(r.ok).toBe(true)
    expect(r.rows[1]).toMatchObject({ awarded: null, earned: null, missing: null })
    expect(r.totalAwarded).toBe(5)
  })

  it('trims text', () => {
    const r = validateGrade({ maxMarks: 5, file: file([row({ label: ' Q1 ' })], { wentWell: '  ok  ' }) })
    expect(r.rows[0].label).toBe('Q1')
    expect(r.wentWell).toBe('ok')
  })
})

describe('validateGrade — refusals name every problem at once', () => {
  it('refuses a file with no grades list', () => {
    expect(validateGrade({ maxMarks: 5, file: {} }).ok).toBe(false)
    expect(validateGrade({ maxMarks: 5, file: null }).ok).toBe(false)
  })

  it('requires both summaries', () => {
    const r = validateGrade({ maxMarks: 5, file: file([row()], { wentWell: '', nextSteps: ' ' }) })
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(2)
  })

  it('refuses marks above the question maximum, below zero, or not in halves', () => {
    for (const awarded of [6, -1, 2.3]) {
      const r = validateGrade({ maxMarks: 5, file: file([row({ awarded, missing: 'x' })]) })
      expect(r.ok, String(awarded)).toBe(false)
    }
  })

  it('refuses a scored question with no numeric marks', () => {
    expect(validateGrade({ maxMarks: 5, file: file([row({ awarded: null })]) }).ok).toBe(false)
    expect(validateGrade({ maxMarks: 5, file: file([row({ awarded: '5' })]) }).ok).toBe(false)
  })

  it('refuses marks on a question that was not attempted', () => {
    const r = validateGrade({ maxMarks: 5, file: file([row({ outcome: 'not_attempted', awarded: 0 })]) })
    expect(r.ok).toBe(false)
  })

  it('needs "missing" wherever marks were lost and "earned" wherever marks were given', () => {
    expect(validateGrade({ maxMarks: 5, file: file([row({ awarded: 3, missing: '' })]) }).ok).toBe(false)
    expect(validateGrade({ maxMarks: 5, file: file([row({ earned: '' })]) }).ok).toBe(false)
    // Zero marks: nothing was earned, so "earned" may be blank.
    expect(validateGrade({ maxMarks: 5, file: file([row({ awarded: 0, earned: '', missing: 'Wrong method.' })]) }).ok).toBe(true)
  })

  it('refuses "missing" on a full-marks question — the student sees it as a red ✗ beside full marks', () => {
    const r = validateGrade({ maxMarks: 5, file: file([row({ missing: 'You numbered this answer 3.' })]) })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/Q1.*full marks/)
  })

  it('refuses an unknown outcome', () => {
    expect(validateGrade({ maxMarks: 5, file: file([row({ outcome: 'not_counted' })]) }).ok).toBe(false)
  })

  it('refuses a blank or repeated label', () => {
    expect(validateGrade({ maxMarks: 10, file: file([row({ label: '' }), row({ label: 'Q2' })]) }).ok).toBe(false)
    expect(validateGrade({ maxMarks: 10, file: file([row(), row()]) }).ok).toBe(false)
  })

  it('refuses feedback over the limit', () => {
    const long = 'x'.repeat(MAX_FEEDBACK_CHARS + 1)
    expect(validateGrade({ maxMarks: 5, file: file([row({ earned: long })]) }).ok).toBe(false)
  })

  // The breakdown must cover the whole assignment: a grader that skipped a
  // question would otherwise hand back a total that looks like a full score.
  it('refuses a breakdown whose maximums do not add up to the assignment\'s marks', () => {
    const r = validateGrade({ maxMarks: 20, file: file([row(), row({ label: 'Q2' })]) })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/20/)
  })

  it('refuses a sheet with nothing scored — that is a rejection, not a grade', () => {
    const r = validateGrade({
      maxMarks: 5, file: file([row({ outcome: 'not_attempted', awarded: null, earned: '', missing: '' })]),
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/reject/i)
  })

  it('collects several problems in one pass', () => {
    const r = validateGrade({
      maxMarks: 99,
      file: file([row({ awarded: 9 }), row({ label: 'Q1' })], { wentWell: '' }),
    })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThanOrEqual(4)
  })
})

describe('validateGrade — against a teacher-set question breakdown', () => {
  const questions = [{ label: 'Q1', marks: 5 }, { label: 'Q2', marks: 5 }]

  it('passes when every question is graded at its set marks', () => {
    const r = validateGrade({
      maxMarks: 10, questions, file: file([row(), row({ label: 'Q2' })]),
    })
    expect(r.ok).toBe(true)
  })

  it('refuses a missing question, an extra one, and a changed maximum', () => {
    expect(validateGrade({ maxMarks: 10, questions, file: file([row()]) }).ok).toBe(false)
    expect(validateGrade({
      maxMarks: 10, questions, file: file([row(), row({ label: 'Q2' }), row({ label: 'Q3' })]),
    }).ok).toBe(false)
    expect(validateGrade({
      maxMarks: 10, questions, file: file([row({ max: 4, awarded: 4 }), row({ label: 'Q2', max: 6, awarded: 6 })]),
    }).ok).toBe(false)
  })

  it('keeps the teacher\'s question order, whatever order the grade file used', () => {
    const r = validateGrade({ maxMarks: 10, questions, file: file([row({ label: 'Q2' }), row()]) })
    expect(r.rows.map(x => x.label)).toEqual(['Q1', 'Q2'])
  })
})

// 2026-10-13: every grade records a handwriting check against the student's
// reference (their first graded homework). It never changes the marks; a
// mismatch keeps the grade from the student until faculty release it.
describe('validateGrade — the handwriting check', () => {
  it('refuses a grade with no handwriting check, alongside any other problem', () => {
    const r = validateGrade({ maxMarks: 5, file: file([row()], { handwriting: undefined, wentWell: '' }) })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/handwriting/i)
    expect(r.errors.join(' ')).toMatch(/wentWell/)
  })

  it('returns the check with the grade, and whether it holds the grade', () => {
    const r = validateGrade({
      maxMarks: 5, hasReference: true,
      file: file([row()], { handwriting: { check: 'mismatch', note: 'Different letter shapes throughout.' } }),
    })
    expect(r.ok).toBe(true)
    expect(r.handwriting).toEqual({ check: 'mismatch', note: 'Different letter shapes throughout.', holds: true })
    expect(validateGrade({ maxMarks: 5, hasReference: true, file: file([row()]) }).handwriting.holds).toBe(false)
  })

  it('applies the reference rule when told the student has none', () => {
    const r = validateGrade({ maxMarks: 5, hasReference: false, file: file([row()]) })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/no reference/i)
  })

  it('never changes the marks', () => {
    const plain = validateGrade({ maxMarks: 5, file: file([row({ awarded: 4, missing: 'Units.' })]) })
    const held = validateGrade({
      maxMarks: 5, file: file([row({ awarded: 4, missing: 'Units.' })], { handwriting: { check: 'mismatch', note: 'Differs.' } }),
    })
    expect(held.totalAwarded).toBe(plain.totalAwarded)
    expect(held.rows).toEqual(plain.rows)
  })
})

describe('constants', () => {
  it('has the two outcomes and the two graders the database allows', () => {
    expect(OUTCOMES).toEqual(['scored', 'not_attempted'])
    expect(GRADERS).toEqual(['session', 'api'])
  })
})
