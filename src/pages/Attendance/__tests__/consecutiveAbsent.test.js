import { describe, it, expect } from 'vitest'
import { buildConsecutiveAbsent } from '../consecutiveAbsent'

// lws_id → name map used across tests
const NAMES = { L001: 'Alice', L002: 'Bob', L003: 'Charlie' }

// Helper: build a record array for one student
function rec(lwsId, entries) {
  return entries.map(([date, status]) => ({ lws_id: lwsId, date, status }))
}

describe('buildConsecutiveAbsent', () => {
  // ── guard cases ──────────────────────────────────────────────

  it('returns [] when n < 1', () => {
    const records = rec('L001', [['2026-05-05', 'A']])
    expect(buildConsecutiveAbsent(records, NAMES, 0)).toEqual([])
  })

  it('returns [] when records is empty', () => {
    expect(buildConsecutiveAbsent([], NAMES, 3)).toEqual([])
  })

  it('returns [] when dataset has fewer than n non-Sunday dates', () => {
    // only 2 non-Sunday dates available, n=3
    const records = [
      ...rec('L001', [['2026-05-04', 'A'], ['2026-05-05', 'A']]),
    ]
    expect(buildConsecutiveAbsent(records, NAMES, 3)).toEqual([])
  })

  // ── Sunday exclusion ─────────────────────────────────────────

  it('skips Sundays when building the target date list', () => {
    // 2026-05-03 is a Sunday — should be excluded
    // Target dates (n=2) should be Mon May 4 + Tue May 5, not Sun May 3
    const records = [
      ...rec('L001', [
        ['2026-05-03', 'A'], // Sunday — must NOT count
        ['2026-05-04', 'A'], // Monday
        ['2026-05-05', 'A'], // Tuesday
      ]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Alice')
    // since = earliest of the 2 target dates = May 4
    expect(result[0].since).toBe('2026-05-04')
  })

  it('does not flag a student absent only on Sunday', () => {
    // Only date is a Sunday → no valid target dates
    const records = rec('L001', [['2026-05-03', 'A']])
    expect(buildConsecutiveAbsent(records, NAMES, 1)).toEqual([])
  })

  // ── flagging logic ───────────────────────────────────────────

  it('flags a student absent on all n target dates', () => {
    const records = [
      ...rec('L001', [['2026-05-05', 'A'], ['2026-05-06', 'A'], ['2026-05-07', 'A']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 3)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Alice')
  })

  it('does not flag a student present on any of the n target dates', () => {
    const records = [
      ...rec('L001', [['2026-05-05', 'A'], ['2026-05-06', 'P'], ['2026-05-07', 'A']]),
    ]
    expect(buildConsecutiveAbsent(records, NAMES, 3)).toEqual([])
  })

  it('does not flag a student missing a record for one of the target dates', () => {
    // n=3; student only has records on 2 of the 3 target dates
    const records = [
      // date 2026-05-05 exists in dataset (from Bob) but Alice has no record that day
      ...rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
      ...rec('L002', [['2026-05-05', 'A'], ['2026-05-06', 'A'], ['2026-05-07', 'A']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 3)
    // Only Bob is flagged (has records on all 3 dates, all A)
    expect(result.map(r => r.name)).toEqual(['Bob'])
  })

  // ── target date selection uses global dataset ────────────────

  it('uses the last n non-Sunday dates from the whole dataset, not per-student', () => {
    // Dataset has dates May 5, 6, 7. Alice is absent May 6+7 but no record May 5.
    // With n=2 the targets are May 6+7 — Alice qualifies.
    const records = [
      ...rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
      ...rec('L002', [['2026-05-05', 'P'], ['2026-05-06', 'P'], ['2026-05-07', 'P']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result.map(r => r.name)).toContain('Alice')
  })

  // ── since date ───────────────────────────────────────────────

  it('sets since to the earliest of the n target dates', () => {
    const records = [
      ...rec('L001', [['2026-05-05', 'A'], ['2026-05-06', 'A'], ['2026-05-07', 'A']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 3)
    expect(result[0].since).toBe('2026-05-05')
  })

  it('sets since correctly for n=1', () => {
    const records = rec('L001', [['2026-05-07', 'A']])
    const result = buildConsecutiveAbsent(records, NAMES, 1)
    expect(result[0].since).toBe('2026-05-07')
  })

  // ── multi-student scenarios ──────────────────────────────────

  it('flags multiple students when all qualify', () => {
    const records = [
      ...rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
      ...rec('L002', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result).toHaveLength(2)
  })

  it('returns results sorted alphabetically by name', () => {
    const records = [
      ...rec('L003', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
      ...rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
      ...rec('L002', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result.map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('falls back lws_id as name when not in map', () => {
    const records = rec('L999', [['2026-05-07', 'A']])
    const result = buildConsecutiveAbsent(records, NAMES, 1)
    expect(result[0].name).toBe('L999')
  })

  // ── streak walks past N — true since-date ────────────────────

  it('flags a student absent for MORE than n days, with since at the true streak start', () => {
    // n=2 but student absent 4 consecutive non-Sunday days.
    // Walk-back from latest counts all four As, so since must reach the earliest.
    const records = rec('L001', [
      ['2026-05-04', 'A'], ['2026-05-05', 'A'],
      ['2026-05-06', 'A'], ['2026-05-07', 'A'],
    ])
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result).toHaveLength(1)
    expect(result[0].since).toBe('2026-05-04')
  })

  it('does not extend the streak across a P/L break', () => {
    // Pattern (oldest → latest): A, P, A, A. Walk back from latest: A(7) A(6)
    // P(5) ⇒ stop. Streak = 2, since = May 6 (NOT May 4, even though it is A).
    const records = rec('L001', [
      ['2026-05-04', 'A'], ['2026-05-05', 'P'],
      ['2026-05-06', 'A'], ['2026-05-07', 'A'],
    ])
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result[0].since).toBe('2026-05-06')
  })

  it('does not extend the streak across a missing record', () => {
    // Alice has records only on 6 + 7; dataset spans 4-7 via Bob (kept all P
    // so he does not enter the result). Walk-back for Alice: A(7) A(6) miss(5)
    // ⇒ stop. Streak = 2, since = May 6.
    const records = [
      ...rec('L002', [
        ['2026-05-04', 'P'], ['2026-05-05', 'P'],
        ['2026-05-06', 'P'], ['2026-05-07', 'P'],
      ]),
      ...rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    const alice = result.find(r => r.name === 'Alice')
    expect(alice).toBeDefined()
    expect(alice.since).toBe('2026-05-06')
  })

  it('per-student since may differ even when both qualify under the same n', () => {
    // n=2: Alice absent 6+7, Bob absent 4+5+6+7. Same N gate, different since.
    const records = [
      ...rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']]),
      ...rec('L002', [
        ['2026-05-04', 'A'], ['2026-05-05', 'A'],
        ['2026-05-06', 'A'], ['2026-05-07', 'A'],
      ]),
    ]
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    const alice = result.find(r => r.name === 'Alice')
    const bob   = result.find(r => r.name === 'Bob')
    expect(alice.since).toBe('2026-05-06')
    expect(bob.since).toBe('2026-05-04')
  })

  // ── count: recorded absent days in the streak ────────────────

  it('reports count equal to the streak length when it equals n', () => {
    const records = rec('L001', [['2026-05-06', 'A'], ['2026-05-07', 'A']])
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result[0].count).toBe(2)
  })

  it('reports count equal to the true streak when it runs past n', () => {
    // n=2 but 4 consecutive recorded absences.
    const records = rec('L001', [
      ['2026-05-04', 'A'], ['2026-05-05', 'A'],
      ['2026-05-06', 'A'], ['2026-05-07', 'A'],
    ])
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result[0].count).toBe(4)
  })

  it('count excludes Sundays (only recorded non-Sunday A days)', () => {
    // 2026-05-03 is a Sunday — must not be counted.
    const records = rec('L001', [
      ['2026-05-03', 'A'], // Sunday — excluded
      ['2026-05-04', 'A'],
      ['2026-05-05', 'A'],
    ])
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result[0].count).toBe(2)
  })

  it('count stops at a P/L break (does not count As before the break)', () => {
    // A, P, A, A → walk back counts 2 As then stops at P.
    const records = rec('L001', [
      ['2026-05-04', 'A'], ['2026-05-05', 'P'],
      ['2026-05-06', 'A'], ['2026-05-07', 'A'],
    ])
    const result = buildConsecutiveAbsent(records, NAMES, 2)
    expect(result[0].count).toBe(2)
  })
})
