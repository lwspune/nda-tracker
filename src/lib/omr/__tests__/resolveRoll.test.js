import { describe, it, expect } from 'vitest'
import { readRollDigits, resolveRoll, findDuplicateRolls } from '../resolveRoll'
import { calibrate } from '../readBubbles'

// Identity is the dangerous part of a generic sheet. An unreadable roll number
// is harmless — it goes to review. The failure that matters is a misread that
// lands on a DIFFERENT VALID STUDENT, silently swapping two people's marks.
// Everything here exists to make that impossible rather than unlikely.

const cal = calibrate([...Array(200).fill(0.06), ...Array(20).fill(0.88)])
/** One roll column: ten scores, `digit` filled. */
const col = digit => Array.from({ length: 10 }, (_, v) => (v === digit ? 0.88 : 0.06))

const roster = [
  { lwsId: 'LWS-048', name: 'Tejas Jadhav', evalbeeRollNos: ['00048'] },
  { lwsId: 'LWS-057', name: 'Ayush Sekhar', evalbeeRollNos: ['00057'] },
  { lwsId: 'LWS-013', name: 'Mangesh Pawar', evalbeeRollNos: ['00013', '13'] },
  { lwsId: 'LWS-061', name: 'No Evalbee Roll', evalbeeRollNos: [] },
]

describe('readRollDigits', () => {
  it('reads one filled bubble per column as a digit', () => {
    const r = readRollDigits([col(0), col(0), col(0), col(5), col(7)], cal)
    expect(r.digits).toBe('00057')
    expect(r.review).toBe(false)
  })

  it('refuses a column with two bubbles filled', () => {
    const two = col(3).map((s, v) => (v === 8 ? 0.9 : s))
    const r = readRollDigits([col(0), col(0), col(0), two, col(7)], cal)
    expect(r.review).toBe(true)
    expect(r.digits).toBeNull()
    expect(r.reason).toMatch(/ambiguous|multiple/i)
  })

  it('refuses a half-filled bubble rather than rounding it up', () => {
    const faint = col(4).map((s, v) => (v === 4 ? 0.42 : s))
    const r = readRollDigits([col(0), col(0), col(0), col(1), faint], cal)
    expect(r.review).toBe(true)
    expect(r.digits).toBeNull()
  })

  it('refuses an entirely blank roll block — the sheet we actually received', () => {
    // Aarti More's sheet had no roll number written or bubbled at all.
    const empty = Array.from({ length: 10 }, () => 0.06)
    const r = readRollDigits([empty, empty, empty, empty, empty], cal)
    expect(r.review).toBe(true)
    expect(r.digits).toBeNull()
    expect(r.reason).toMatch(/blank|empty/i)
  })
})

describe('resolveRoll', () => {
  it('matches the Evalbee roll number students already use', () => {
    const r = resolveRoll('00057', roster)
    expect(r.lwsId).toBe('LWS-057')
    expect(r.matchedBy).toBe('evalbee')
    expect(r.review).toBe(false)
  })

  it('ignores leading zeros, which students write inconsistently', () => {
    expect(resolveRoll('13', roster).lwsId).toBe('LWS-013')
    expect(resolveRoll('00013', roster).lwsId).toBe('LWS-013')
  })

  it('falls back to our own LWS id when no Evalbee roll exists', () => {
    const r = resolveRoll('00061', roster)
    expect(r.lwsId).toBe('LWS-061')
    expect(r.matchedBy).toBe('lwsId')
  })

  it('REFUSES when the two numbering schemes point at different students', () => {
    // Measured in the live roster: 7 cases inside a single batch where one
    // student's Evalbee roll equals ANOTHER student's LWS number. Preferring
    // Evalbee and returning would silently hand the sheet to the wrong person —
    // a student with no Evalbee roll writes their LWS number and gets someone
    // else's marks. Two readings, two students, no answer.
    const clash = [
      { lwsId: 'LWS-048', name: 'A', evalbeeRollNos: ['00099'] },
      { lwsId: 'LWS-099', name: 'B', evalbeeRollNos: [] },
    ]
    const r = resolveRoll('00099', clash)
    expect(r.lwsId).toBeNull()
    expect(r.review).toBe(true)
    expect(r.reason).toMatch(/two numbering schemes|disagree/i)
    expect(r.candidates.map(c => c.lwsId).sort()).toEqual(['LWS-048', 'LWS-099'])
  })

  it('still prefers Evalbee when the LWS number agrees or is unclaimed', () => {
    // LWS-057's own number is 57, so `00057` reads the same either way.
    expect(resolveRoll('00057', roster).matchedBy).toBe('evalbee')
    // and a roll nobody holds as an LWS number resolves cleanly
    const solo = [{ lwsId: 'LWS-200', name: 'A', evalbeeRollNos: ['00007'] }]
    expect(resolveRoll('00007', solo).lwsId).toBe('LWS-200')
  })

  it('REFUSES an ambiguous roll rather than picking a student', () => {
    const dup = [
      { lwsId: 'LWS-001', name: 'A', evalbeeRollNos: ['00007'] },
      { lwsId: 'LWS-002', name: 'B', evalbeeRollNos: ['00007'] },
    ]
    const r = resolveRoll('00007', dup)
    expect(r.lwsId).toBeNull()
    expect(r.review).toBe(true)
    expect(r.candidates.map(c => c.lwsId)).toEqual(['LWS-001', 'LWS-002'])
  })

  it('refuses a roll that is not on the roster at all', () => {
    const r = resolveRoll('00999', roster)
    expect(r.lwsId).toBeNull()
    expect(r.review).toBe(true)
    expect(r.reason).toMatch(/not on the roster/i)
  })

  it('is closed-set: a roll valid elsewhere is refused for this exam', () => {
    // The roster passed in is the EXAM's batch. Resolving against the whole
    // school would let a misread land on a real student from another batch,
    // which is the swap this is built to prevent.
    const r = resolveRoll('00048', roster.filter(s => s.lwsId !== 'LWS-048'))
    expect(r.lwsId).toBeNull()
    expect(r.review).toBe(true)
  })

  it('refuses nothing at all', () => {
    expect(resolveRoll(null, roster).review).toBe(true)
    expect(resolveRoll('', roster).review).toBe(true)
  })
})

describe('findDuplicateRolls', () => {
  it('flags two sheets claiming the same student, never last-write-wins', () => {
    const sheets = [
      { sheet: 1, lwsId: 'LWS-048' },
      { sheet: 2, lwsId: 'LWS-057' },
      { sheet: 3, lwsId: 'LWS-048' },
    ]
    const dups = findDuplicateRolls(sheets)
    expect(dups).toHaveLength(1)
    expect(dups[0].lwsId).toBe('LWS-048')
    expect(dups[0].sheets).toEqual([1, 3])
  })

  it('ignores unresolved sheets, which are already in review', () => {
    expect(findDuplicateRolls([
      { sheet: 1, lwsId: null }, { sheet: 2, lwsId: null },
    ])).toEqual([])
  })
})
