import { describe, it, expect } from 'vitest'
import { computeAbsentees } from '../lectureRoster'

// roster order is preserved in the output; on-leave students are ALWAYS excluded
// from the absentee set regardless of mode (a leave explains the absence).
const ROSTER = ['A', 'B', 'C', 'D']

describe('computeAbsentees', () => {
  it('absent mode: returns exactly the selected students (roster order)', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['C', 'A'], mode: 'absent', onLeaveIds: [] }))
      .toEqual(['A', 'C'])
  })

  it('present mode: absent = roster − present', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['A', 'B'], mode: 'present', onLeaveIds: [] }))
      .toEqual(['C', 'D'])
  })

  it('absent mode: an on-leave student is never logged absent, even if selected', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['A', 'B'], mode: 'absent', onLeaveIds: ['B'] }))
      .toEqual(['A'])
  })

  it('present mode: on-leave students are excluded from absent (not present, but explained)', () => {
    // Present = [A]. Naively absent = B,C,D; but B is on leave → B excluded.
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['A'], mode: 'present', onLeaveIds: ['B'] }))
      .toEqual(['C', 'D'])
  })

  it('non-hostel branch (empty onLeaveIds): behaves as a plain present/absent toggle', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['B'], mode: 'absent', onLeaveIds: [] })).toEqual(['B'])
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['B'], mode: 'present', onLeaveIds: [] })).toEqual(['A', 'C', 'D'])
  })

  it('ignores selected ids that are not in the roster', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ['A', 'Z'], mode: 'absent', onLeaveIds: [] }))
      .toEqual(['A'])
  })

  it('accepts Sets for selectedIds and onLeaveIds', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: new Set(['C']), mode: 'absent', onLeaveIds: new Set(['C']) }))
      .toEqual([])   // C selected but on leave → excluded
  })

  it('present mode with everyone present → nobody absent', () => {
    expect(computeAbsentees({ rosterIds: ROSTER, selectedIds: ROSTER, mode: 'present', onLeaveIds: [] })).toEqual([])
  })

  it('empty roster → empty result', () => {
    expect(computeAbsentees({ rosterIds: [], selectedIds: ['A'], mode: 'present', onLeaveIds: [] })).toEqual([])
  })
})
