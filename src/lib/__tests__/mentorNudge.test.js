import { describe, it, expect } from 'vitest'
import {
  fmtNudgeDate,
  isNudgeDay,
  istDateString,
  pickDailyMentees,
} from '../mentorNudge.js'

const M = (lwsId, name) => ({ lwsId, name: name || lwsId })
const constRng = () => 0.5 // stable sort → preserves input order, deterministic tests

describe('fmtNudgeDate', () => {
  it('formats with ordinal day, full month, year', () => {
    expect(fmtNudgeDate('2026-06-22')).toBe('22nd June 2026')
    expect(fmtNudgeDate('2026-06-01')).toBe('1st June 2026')
    expect(fmtNudgeDate('2026-06-02')).toBe('2nd June 2026')
    expect(fmtNudgeDate('2026-06-03')).toBe('3rd June 2026')
    expect(fmtNudgeDate('2026-06-11')).toBe('11th June 2026') // teens are always th
    expect(fmtNudgeDate('2026-06-12')).toBe('12th June 2026')
    expect(fmtNudgeDate('2026-06-13')).toBe('13th June 2026')
    expect(fmtNudgeDate('2026-06-21')).toBe('21st June 2026')
    expect(fmtNudgeDate('2026-06-23')).toBe('23rd June 2026')
    expect(fmtNudgeDate('2026-01-31')).toBe('31st January 2026')
  })
  it('returns empty string on garbage input', () => {
    expect(fmtNudgeDate('')).toBe('')
    expect(fmtNudgeDate(null)).toBe('')
    expect(fmtNudgeDate('not-a-date')).toBe('')
  })
})

describe('isNudgeDay', () => {
  it('is true Monday–Friday, false on weekends', () => {
    expect(isNudgeDay('2026-06-22')).toBe(true)  // Monday
    expect(isNudgeDay('2026-06-26')).toBe(true)  // Friday
    expect(isNudgeDay('2026-06-20')).toBe(false) // Saturday
    expect(isNudgeDay('2026-06-21')).toBe(false) // Sunday
  })
  it('returns false on garbage', () => {
    expect(isNudgeDay('nope')).toBe(false)
  })
})

describe('istDateString', () => {
  it('returns the Asia/Kolkata calendar date for a UTC instant', () => {
    // 02:00 UTC = 07:30 IST same day
    expect(istDateString(new Date('2026-06-22T02:00:00Z'))).toBe('2026-06-22')
    // 20:00 UTC prev day = 01:30 IST next day (crosses midnight)
    expect(istDateString(new Date('2026-06-21T20:00:00Z'))).toBe('2026-06-22')
  })
})

describe('pickDailyMentees', () => {
  const FIVE = [M('a'), M('b'), M('c'), M('d'), M('e')]

  it('returns [] for an empty roster', () => {
    expect(pickDailyMentees([], [], { n: 3, today: '2026-06-22', rng: constRng })).toEqual([])
  })

  it('picks n on a fresh roster (no history)', () => {
    const picks = pickDailyMentees(FIVE, [], { n: 3, today: '2026-06-22', rng: constRng })
    expect(picks.map(p => p.lwsId)).toEqual(['a', 'b', 'c'])
  })

  it('finishes the current round before repeating anyone — short tail day', () => {
    // a,b,c already nudged once this round; only d,e remain
    const log = [
      { lwsId: 'a', date: '2026-06-22' },
      { lwsId: 'b', date: '2026-06-22' },
      { lwsId: 'c', date: '2026-06-22' },
    ]
    const picks = pickDailyMentees(FIVE, log, { n: 3, today: '2026-06-23', rng: constRng })
    expect(picks.map(p => p.lwsId)).toEqual(['d', 'e']) // only 2 — no round overlap
  })

  it('starts a fresh round once everyone is level', () => {
    const log = FIVE.map(m => ({ lwsId: m.lwsId, date: '2026-06-22' })) // all count 1
    const picks = pickDailyMentees(FIVE, log, { n: 3, today: '2026-06-24', rng: constRng })
    expect(picks.map(p => p.lwsId)).toEqual(['a', 'b', 'c'])
  })

  it('never picks a higher-count mentee while a lower-count one waits', () => {
    // a,b,c at count 2; d at count 1; e at count 1 → only d,e eligible
    const log = [
      { lwsId: 'a', date: '2026-06-20' }, { lwsId: 'a', date: '2026-06-23' },
      { lwsId: 'b', date: '2026-06-20' }, { lwsId: 'b', date: '2026-06-23' },
      { lwsId: 'c', date: '2026-06-20' }, { lwsId: 'c', date: '2026-06-23' },
      { lwsId: 'd', date: '2026-06-20' },
      { lwsId: 'e', date: '2026-06-20' },
    ]
    const picks = pickDailyMentees(FIVE, log, { n: 3, today: '2026-06-24', rng: constRng })
    expect(picks.map(p => p.lwsId)).toEqual(['d', 'e'])
  })

  it('is idempotent within a day — returns [] if n already sent today', () => {
    const log = [
      { lwsId: 'a', date: '2026-06-22' },
      { lwsId: 'b', date: '2026-06-22' },
      { lwsId: 'c', date: '2026-06-22' },
    ]
    expect(pickDailyMentees(FIVE, log, { n: 3, today: '2026-06-22', rng: constRng })).toEqual([])
  })

  it('resumes a partial day — fills only the remainder', () => {
    const log = [{ lwsId: 'a', date: '2026-06-22' }] // 1 already sent today
    const picks = pickDailyMentees(FIVE, log, { n: 3, today: '2026-06-22', rng: constRng })
    expect(picks.map(p => p.lwsId)).toEqual(['b', 'c']) // 2 more, excluding a
  })

  it('returns all when roster smaller than n', () => {
    const picks = pickDailyMentees([M('a'), M('b')], [], { n: 3, today: '2026-06-22', rng: constRng })
    expect(picks.map(p => p.lwsId)).toEqual(['a', 'b'])
  })
})
