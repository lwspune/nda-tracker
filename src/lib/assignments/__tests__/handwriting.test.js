import { describe, it, expect } from 'vitest'
import {
  HAND_CHECKS, MAX_HAND_NOTE_CHARS, holdsGrade, validateHandwriting, withoutReferences, handComparePlan,
} from '../handwriting'

describe('holdsGrade', () => {
  // Only a mismatch keeps a grade from the student. An unclear photo is
  // released with a note: holding on every blurry page would hold half the class.
  it('holds a mismatch and nothing else', () => {
    expect(HAND_CHECKS.filter(holdsGrade)).toEqual(['mismatch'])
  })
})

describe('validateHandwriting', () => {
  const ok = (h, ctx) => validateHandwriting(h, ctx)

  it('passes a match against a reference, with or without a note', () => {
    expect(ok({ check: 'match', note: '' }, { hasReference: true })).toEqual({ ok: true, value: { check: 'match', note: null } })
    expect(ok({ check: 'match', note: ' Same slant. ' }, { hasReference: true }).value.note).toBe('Same slant.')
  })

  it('refuses a missing or unfilled check, so the step cannot be skipped', () => {
    expect(ok(undefined, { hasReference: true }).ok).toBe(false)
    expect(ok({ check: '', note: '' }, { hasReference: true }).ok).toBe(false)
    expect(ok({ check: 'looks fine' }, { hasReference: true }).ok).toBe(false)
  })

  it('needs a note saying what differs for a mismatch or an unclear page', () => {
    for (const check of ['mismatch', 'unclear']) {
      const r = ok({ check, note: '  ' }, { hasReference: true })
      expect(r.ok, check).toBe(false)
      expect(r.errors.join(' '), check).toMatch(/note/i)
    }
    expect(ok({ check: 'mismatch', note: 'Different g and y loops.' }, { hasReference: true }).ok).toBe(true)
  })

  it(`caps the note at ${MAX_HAND_NOTE_CHARS} characters`, () => {
    expect(ok({ check: 'mismatch', note: 'x'.repeat(MAX_HAND_NOTE_CHARS + 1) }, { hasReference: true }).ok).toBe(false)
  })

  // Without a reference there is nothing to match against; the only finding
  // possible is the class-wide one (this hand appears on another submission).
  it('allows only no_reference or a class-wide mismatch when the student has no reference', () => {
    expect(ok({ check: 'no_reference', note: '' }, { hasReference: false }).ok).toBe(true)
    expect(ok({ check: 'mismatch', note: 'Same hand as another submission.' }, { hasReference: false }).ok).toBe(true)
    expect(ok({ check: 'match', note: '' }, { hasReference: false }).ok).toBe(false)
    expect(ok({ check: 'unclear', note: 'Blurry.' }, { hasReference: false }).ok).toBe(false)
  })

  it('refuses no_reference when the student has one', () => {
    expect(ok({ check: 'no_reference', note: '' }, { hasReference: true }).ok).toBe(false)
  })

  // The database repeats the reference rule; when the caller does not know,
  // only the shape is checked here.
  it('checks only the shape when it is not told whether a reference exists', () => {
    expect(ok({ check: 'match', note: '' }).ok).toBe(true)
    expect(ok({ check: 'no_reference', note: '' }).ok).toBe(true)
  })
})

describe('withoutReferences', () => {
  // A reference is kept until faculty delete it by hand; the 30-day purge must
  // never take its pages.
  it('drops the submissions that are a student\'s reference', () => {
    const rows = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    expect(withoutReferences(rows, ['s2']).map(r => r.id)).toEqual(['s1', 's3'])
    expect(withoutReferences(rows, []).map(r => r.id)).toEqual(['s1', 's2', 's3'])
  })
})

describe('handComparePlan', () => {
  const submissions = [
    { id: 's1', lws_id: 'L1', files: ['a/L1/s1/01.jpg', 'a/L1/s1/02.jpg'] },
    { id: 's2', lws_id: 'L2', files: ['a/L2/s2/01.png'] },
  ]
  const references = [
    { lws_id: 'L1', submission_id: 'r1', files: ['b/L1/r1/01.jpeg'], scans_deleted_at: null },
    { lws_id: 'L2', submission_id: 's2', files: ['a/L2/s2/01.png'], scans_deleted_at: null },
  ]

  it('takes page 1 of each submission, named by submission id only', () => {
    const plan = handComparePlan({ submissions, references })
    expect(plan).toContainEqual({ path: 'a/L1/s1/01.jpg', to: 's1.jpg' })
    expect(plan).toContainEqual({ path: 'a/L2/s2/01.png', to: 's2.png' })
    expect(plan.map(p => p.to).join(' ')).not.toMatch(/L1|L2/)
  })

  it('adds the student\'s reference page beside it, unless the reference is this submission', () => {
    const plan = handComparePlan({ submissions, references })
    expect(plan).toContainEqual({ path: 'b/L1/r1/01.jpeg', to: 's1.reference.jpeg' })
    expect(plan.filter(p => p.to.startsWith('s2'))).toHaveLength(1)
  })

  it('skips a reference whose pages are gone', () => {
    const gone = [{ ...references[0], scans_deleted_at: '2026-11-20T00:00:00Z' }]
    expect(handComparePlan({ submissions, references: gone }).map(p => p.to)).toEqual(['s1.jpg', 's2.png'])
  })
})
