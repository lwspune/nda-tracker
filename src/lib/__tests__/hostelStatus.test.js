import { describe, it, expect } from 'vitest'
import { STATUS_CYCLE, AWAY_STATUSES, nextStatus, isAway } from '../hostelStatus'

// The BEHAVIOURAL half of the hostel checkpoint status model, shared by the
// admin Hostel board and the warden's own capture page (2026-09-12). Both
// screens capture the same exceptions against the same five checkpoints, and
// both feed the same `checkpoint_absences` table — so the tap cycle and the
// definition of "away" must be one thing.
//
// STATUS_META is deliberately NOT here. The two screens render different sets:
// the admin board also shows `leave` and `late`, which are DERIVED by the daily
// chain rather than captured, and it colours `present` green where the capture
// page greys it out. Those are presentational differences that belong to each
// screen, not drift.

describe('STATUS_CYCLE', () => {
  // present -> absent -> sick -> out-pass -> present. `undefined` IS the
  // present state: exception-capture means no row stored equals present, which
  // is why the cycle starts and ends there rather than at a 'present' string.
  it('cycles present -> absent -> sick -> outpass -> present', () => {
    expect(STATUS_CYCLE[undefined]).toBe('absent')
    expect(STATUS_CYCLE['absent']).toBe('sick')
    expect(STATUS_CYCLE['sick']).toBe('outpass')
    expect(STATUS_CYCLE['outpass']).toBeUndefined()
  })

  it('returns to the start in exactly four taps', () => {
    let s
    const seen = []
    for (let i = 0; i < 4; i++) { s = nextStatus(s); seen.push(s) }
    expect(seen).toEqual(['absent', 'sick', 'outpass', undefined])
  })

  it('nextStatus treats an unknown status as a return to present', () => {
    expect(nextStatus('something-else')).toBeUndefined()
    expect(nextStatus(null)).toBe('absent')
  })
})

describe('AWAY_STATUSES', () => {
  // "Away" drives the roll-call headcount reconciliation: a boarder who is
  // absent or on out-pass is physically not in the dorm, while one marked sick
  // IS in the dorm and must still be counted.
  it('counts absent and out-pass as away', () => {
    expect(isAway('absent')).toBe(true)
    expect(isAway('outpass')).toBe(true)
  })

  it('does NOT count sick as away — a sick boarder is still in the dorm', () => {
    expect(isAway('sick')).toBe(false)
  })

  it('does not count present (no stored row) as away', () => {
    expect(isAway(undefined)).toBe(false)
    expect(isAway(null)).toBe(false)
    expect(isAway('present')).toBe(false)
  })

  it('exposes the raw set for callers that filter in bulk', () => {
    expect(AWAY_STATUSES).toBeInstanceOf(Set)
    expect([...AWAY_STATUSES].sort()).toEqual(['absent', 'outpass'])
  })
})
