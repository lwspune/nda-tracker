import { describe, it, expect } from 'vitest'
import { getTodaysLectures, getSubjectHoursByBatch, getTeacherDayHours, getWeekDates, fmtDayDate } from '../timetable'

// Helper: build a minimal timetable shape matching what timetableSlice produces.
function makeTimetable({ timeSlots = [], grid = {} } = {}) {
  return { id: 'tt1', branch: 'LWS Pune', batchName: 'LWS_NDA_2Y_(25-27)_A', timeSlots, grid }
}

const MAPPINGS = [
  { id: 'm-maths', label: 'Maths · Mr A', subject: 'Maths', teacherId: 't1' },
  { id: 'm-phy',   label: 'Physics · Mr B', subject: 'Physics', teacherId: 't2' },
  { id: 'm-eng',   label: 'English · Ms C', subject: 'English', teacherId: 't3' },
  { id: 'm-gat',   label: 'GAT · Mr D', subject: 'GAT', teacherId: 't4' },
]

// 2026-05-21 is a Thursday in IST.
// 2026-05-24 is a Sunday.
// 2026-05-22 is a Friday.
const THURSDAY = '2026-05-21'
const SUNDAY   = '2026-05-24'
const FRIDAY   = '2026-05-22'

describe('getTodaysLectures', () => {
  it('returns [] when timetable is null', () => {
    expect(getTodaysLectures(null, THURSDAY, MAPPINGS)).toEqual([])
  })

  it('returns [] when timetable is undefined', () => {
    expect(getTodaysLectures(undefined, THURSDAY, MAPPINGS)).toEqual([])
  })

  it('returns [] when date falls on a Sunday', () => {
    const tt = makeTimetable({
      timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }],
      grid: { s1: { Sunday: { type: 'class', mappingId: 'm-maths' } } },
    })
    expect(getTodaysLectures(tt, SUNDAY, MAPPINGS)).toEqual([])
  })

  it('returns [] when timeSlots is empty', () => {
    expect(getTodaysLectures(makeTimetable(), THURSDAY, MAPPINGS)).toEqual([])
  })

  it('returns class entries for the matching day, in time order', () => {
    const tt = makeTimetable({
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
        { id: 's3', startTime: '11:00 AM', endTime: '12:00 PM' },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
        s2: { Thursday: { type: 'class', mappingId: 'm-phy'   } },
        s3: { Thursday: { type: 'class', mappingId: 'm-eng'   } },
      },
    })
    const result = getTodaysLectures(tt, THURSDAY, MAPPINGS)
    expect(result.map(r => r.subject)).toEqual(['Maths', 'Physics', 'English'])
    expect(result[0]).toMatchObject({
      slotId: 's1',
      startTime: '9:00 AM',
      endTime: '10:00 AM',
      subject: 'Maths',
      mappingId: 'm-maths',
      label: 'Maths · Mr A',
    })
  })

  it('sorts by start time when timeSlots is given in arbitrary order', () => {
    const tt = makeTimetable({
      timeSlots: [
        { id: 's3', startTime: '11:00 AM', endTime: '12:00 PM' },
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
        s2: { Thursday: { type: 'class', mappingId: 'm-phy'   } },
        s3: { Thursday: { type: 'class', mappingId: 'm-eng'   } },
      },
    })
    const result = getTodaysLectures(tt, THURSDAY, MAPPINGS)
    expect(result.map(r => r.subject)).toEqual(['Maths', 'Physics', 'English'])
  })

  it('skips break cells', () => {
    const tt = makeTimetable({
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '10:00 AM', endTime: '10:15 AM' },
        { id: 's3', startTime: '10:15 AM', endTime: '11:15 AM' },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
        s2: { Thursday: { type: 'break', label: 'Tea' } },
        s3: { Thursday: { type: 'class', mappingId: 'm-phy'   } },
      },
    })
    const result = getTodaysLectures(tt, THURSDAY, MAPPINGS)
    expect(result.map(r => r.subject)).toEqual(['Maths', 'Physics'])
  })

  it('skips __span rows entirely (e.g. lunch break)', () => {
    const tt = makeTimetable({
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '1:00 PM',  endTime: '2:00 PM' },
        { id: 's3', startTime: '2:00 PM',  endTime: '3:00 PM' },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
        s2: { __span: { type: 'span', label: 'Lunch' }, Thursday: { type: 'class', mappingId: 'm-phy' } },
        s3: { Thursday: { type: 'class', mappingId: 'm-eng' } },
      },
    })
    const result = getTodaysLectures(tt, THURSDAY, MAPPINGS)
    // s2 should be skipped because __span owns the row, even though a Thursday cell exists.
    expect(result.map(r => r.subject)).toEqual(['Maths', 'English'])
  })

  it('skips class cells whose mapping no longer exists', () => {
    const tt = makeTimetable({
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-deleted' } },
        s2: { Thursday: { type: 'class', mappingId: 'm-maths'   } },
      },
    })
    const result = getTodaysLectures(tt, THURSDAY, MAPPINGS)
    expect(result.map(r => r.subject)).toEqual(['Maths'])
  })

  it('skips slots that have no entry for the target day', () => {
    const tt = makeTimetable({
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
        s2: { Friday: { type: 'class', mappingId: 'm-phy' } }, // not Thursday
      },
    })
    expect(getTodaysLectures(tt, THURSDAY, MAPPINGS).map(r => r.subject)).toEqual(['Maths'])
    expect(getTodaysLectures(tt, FRIDAY,   MAPPINGS).map(r => r.subject)).toEqual(['Physics'])
  })

  it('accepts a Date object as well as an ISO date string', () => {
    const tt = makeTimetable({
      timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }],
      grid: { s1: { Thursday: { type: 'class', mappingId: 'm-maths' } } },
    })
    const asString = getTodaysLectures(tt, THURSDAY, MAPPINGS)
    const asDate   = getTodaysLectures(tt, new Date(2026, 4, 21), MAPPINGS) // May 21 2026 local
    expect(asString.map(r => r.subject)).toEqual(['Maths'])
    expect(asDate.map(r => r.subject)).toEqual(['Maths'])
  })

  it('falls back to mappings = [] without throwing', () => {
    const tt = makeTimetable({
      timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }],
      grid: { s1: { Thursday: { type: 'class', mappingId: 'm-maths' } } },
    })
    // No mapping found → entry is skipped (defensive)
    expect(getTodaysLectures(tt, THURSDAY, [])).toEqual([])
    expect(getTodaysLectures(tt, THURSDAY, undefined)).toEqual([])
  })
})

// ── getSubjectHoursByBatch ────────────────────────────────
describe('getSubjectHoursByBatch', () => {
  const MAPS = [
    { id: 'm-maths', label: 'Maths · A', subject: 'Maths', teacherId: 't1' },
    { id: 'm-maths2', label: 'Maths PYQs', subject: 'Maths', teacherId: 't2' },
    { id: 'm-phy',   label: 'Physics', subject: 'Physics', teacherId: 't3' },
    { id: 'm-nosub', label: 'Mystery', subject: null, teacherId: null },
  ]

  // batch A: Maths Mon+Tue (1h each) + Maths PYQs Wed (1h) = Maths 3h; Physics Mon (1h)
  const ttA = {
    id: 'ttA', branch: 'APJ', batchName: 'APJ_10th',
    timeSlots: [
      { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
      { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
    ],
    grid: {
      s1: {
        Monday:    { type: 'class', mappingId: 'm-maths' },
        Tuesday:   { type: 'class', mappingId: 'm-maths' },
        Wednesday: { type: 'class', mappingId: 'm-maths2' },
      },
      s2: {
        Monday: { type: 'class', mappingId: 'm-phy' },
      },
    },
  }
  // batch B: Physics Mon+Tue (1h each) = 2h
  const ttB = {
    id: 'ttB', branch: 'APJ', batchName: 'APJ_11th',
    timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }],
    grid: {
      s1: {
        Monday:  { type: 'class', mappingId: 'm-phy' },
        Tuesday: { type: 'class', mappingId: 'm-phy' },
      },
    },
  }
  // batch C in a different branch: Maths Mon (0.5h)
  const ttC = {
    id: 'ttC', branch: 'LWS Pune', batchName: 'LWS_2Y',
    timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '9:30 AM' }],
    grid: { s1: { Monday: { type: 'class', mappingId: 'm-maths' } } },
  }

  it('pivots subject hours across batches as columns', () => {
    const r = getSubjectHoursByBatch([ttA, ttB], MAPS)
    expect(r.batches.map(b => b.id)).toEqual(['ttA', 'ttB'])
    expect(r.cell.Maths.ttA).toBe(3)
    expect(r.cell.Physics.ttA).toBe(1)
    expect(r.cell.Physics.ttB).toBe(2)
    expect(r.cell.Maths.ttB ?? 0).toBe(0)
  })

  it('sorts subjects by total hours desc, then name asc', () => {
    const r = getSubjectHoursByBatch([ttA, ttB], MAPS)
    // Maths total 3, Physics total 3 → tie broken by name (Maths before Physics)
    expect(r.subjects).toEqual(['Maths', 'Physics'])
  })

  it('computes per-batch totals, per-subject totals and grand total', () => {
    const r = getSubjectHoursByBatch([ttA, ttB], MAPS)
    expect(r.batchTotals.ttA).toBe(4)   // Maths 3 + Physics 1
    expect(r.batchTotals.ttB).toBe(2)   // Physics 2
    expect(r.subjectTotals.Maths).toBe(3)
    expect(r.subjectTotals.Physics).toBe(3)
    expect(r.grandTotal).toBe(6)
  })

  it('counts fractional-hour slots correctly', () => {
    const r = getSubjectHoursByBatch([ttC], MAPS)
    expect(r.cell.Maths.ttC).toBe(0.5)
    expect(r.grandTotal).toBe(0.5)
  })

  it('filters columns to a single branch when branch opt is given', () => {
    const r = getSubjectHoursByBatch([ttA, ttB, ttC], MAPS, { branch: 'APJ' })
    expect(r.batches.map(b => b.id)).toEqual(['ttA', 'ttB'])
    // ttC (LWS) excluded → its 0.5h Maths must not be in totals
    expect(r.subjectTotals.Maths).toBe(3)
  })

  it('groups granular labels under their shared subject', () => {
    // m-maths and m-maths2 are different labels but both subject "Maths"
    const r = getSubjectHoursByBatch([ttA], MAPS)
    expect(r.cell.Maths.ttA).toBe(3)        // 2h plain + 1h PYQs collapsed
    expect(r.subjects).toContain('Maths')
  })

  it('excludes breaks, __span rows and unresolved mappings', () => {
    const tt = {
      id: 'ttX', branch: 'APJ', batchName: 'X',
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
        { id: 's3', startTime: '11:00 AM', endTime: '12:00 PM' },
      ],
      grid: {
        s1: { Monday: { type: 'break', label: 'Tea' } },
        s2: { __span: { type: 'span', label: 'Lunch' }, Monday: { type: 'class', mappingId: 'm-maths' } },
        s3: { Monday: { type: 'class', mappingId: 'm-deleted' } },
      },
    }
    const r = getSubjectHoursByBatch([tt], MAPS)
    expect(r.grandTotal).toBe(0)
    expect(r.subjects).toEqual([])
  })

  it('buckets a class whose mapping has no subject under "Unspecified"', () => {
    const tt = {
      id: 'ttN', branch: 'APJ', batchName: 'N',
      timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }],
      grid: { s1: { Monday: { type: 'class', mappingId: 'm-nosub' } } },
    }
    const r = getSubjectHoursByBatch([tt], MAPS)
    expect(r.cell.Unspecified.ttN).toBe(1)
  })

  it('returns an empty shape for no timetables or bad input', () => {
    const empty = getSubjectHoursByBatch([], MAPS)
    expect(empty).toEqual({ batches: [], subjects: [], cell: {}, batchTotals: {}, subjectTotals: {}, grandTotal: 0 })
    expect(getSubjectHoursByBatch(null, MAPS).grandTotal).toBe(0)
    expect(getSubjectHoursByBatch(undefined, undefined).grandTotal).toBe(0)
  })
})

// ── getTeacherDayHours ────────────────────────────────────
// Operates on the grouped rows the Teacher Schedule view builds:
//   { startMinutes, endMinutes, days: [dayName] }
describe('getTeacherDayHours', () => {
  it('returns all six weekdays zeroed for empty / bad input', () => {
    const zero = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0 }
    expect(getTeacherDayHours([])).toEqual(zero)
    expect(getTeacherDayHours(null)).toEqual(zero)
    expect(getTeacherDayHours(undefined)).toEqual(zero)
  })

  it('sums each row’s duration into every day it runs', () => {
    // 9:00–10:45 = 1.75h on Mon+Fri; 10:00–11:00 = 1h on Mon+Tue+Wed
    const rows = [
      { startMinutes: 540, endMinutes: 645, days: ['Monday', 'Friday'] },
      { startMinutes: 600, endMinutes: 660, days: ['Monday', 'Tuesday', 'Wednesday'] },
    ]
    expect(getTeacherDayHours(rows)).toEqual({
      Monday: 2.75,   // 1.75 + 1
      Tuesday: 1,
      Wednesday: 1,
      Thursday: 0,
      Friday: 1.75,
      Saturday: 0,
    })
  })

  it('ignores rows with non-positive duration', () => {
    const rows = [
      { startMinutes: 600, endMinutes: 600, days: ['Monday'] }, // zero-length
      { startMinutes: 660, endMinutes: 600, days: ['Tuesday'] }, // negative
      { startMinutes: 540, endMinutes: 600, days: ['Wednesday'] }, // 1h
    ]
    const r = getTeacherDayHours(rows)
    expect(r.Monday).toBe(0)
    expect(r.Tuesday).toBe(0)
    expect(r.Wednesday).toBe(1)
  })

  it('ignores days outside Mon–Sat (e.g. Sunday)', () => {
    const rows = [{ startMinutes: 540, endMinutes: 600, days: ['Sunday', 'Monday'] }]
    const r = getTeacherDayHours(rows)
    expect(r.Monday).toBe(1)
    expect(r).not.toHaveProperty('Sunday')
  })

  it('tolerates rows with missing days array', () => {
    const rows = [{ startMinutes: 540, endMinutes: 600 }]
    expect(getTeacherDayHours(rows)).toEqual({
      Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0,
    })
  })
})

// ── getWeekDates ──────────────────────────────────────────
// Maps a "week of" anchor to a calendar date for each Mon–Sat column.
describe('getWeekDates', () => {
  // 2026-05-18 is a Monday; that week runs Mon 18 → Sat 23.
  it('maps each weekday to its calendar Date for a mid-week anchor', () => {
    const w = getWeekDates('2026-05-21') // Thursday
    expect(w.Monday).toEqual(new Date(2026, 4, 18))
    expect(w.Tuesday).toEqual(new Date(2026, 4, 19))
    expect(w.Wednesday).toEqual(new Date(2026, 4, 20))
    expect(w.Thursday).toEqual(new Date(2026, 4, 21))
    expect(w.Friday).toEqual(new Date(2026, 4, 22))
    expect(w.Saturday).toEqual(new Date(2026, 4, 23))
  })

  it('returns the same week when the anchor is the Monday itself', () => {
    const w = getWeekDates('2026-05-18')
    expect(w.Monday).toEqual(new Date(2026, 4, 18))
    expect(w.Saturday).toEqual(new Date(2026, 4, 23))
  })

  it('groups a Sunday anchor with the preceding Mon–Sat week (ISO)', () => {
    const w = getWeekDates('2026-05-24') // Sunday
    expect(w.Monday).toEqual(new Date(2026, 4, 18))
    expect(w.Saturday).toEqual(new Date(2026, 4, 23))
  })

  it('only includes the six grid weekdays (no Sunday)', () => {
    const w = getWeekDates('2026-05-21')
    expect(Object.keys(w)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  it('crosses a month boundary correctly', () => {
    // 2026-06-01 is a Monday; the prior week's anchor 2026-05-29 (Fri) → Mon 25 May
    const w = getWeekDates('2026-05-29')
    expect(w.Monday).toEqual(new Date(2026, 4, 25))
    expect(w.Saturday).toEqual(new Date(2026, 4, 30))
  })

  it('accepts a Date object as the anchor', () => {
    const w = getWeekDates(new Date(2026, 4, 21))
    expect(w.Monday).toEqual(new Date(2026, 4, 18))
  })

  it('returns null for falsy or invalid input', () => {
    expect(getWeekDates(null)).toBeNull()
    expect(getWeekDates(undefined)).toBeNull()
    expect(getWeekDates('')).toBeNull()
    expect(getWeekDates('not-a-date')).toBeNull()
    expect(getWeekDates(new Date('nope'))).toBeNull()
  })
})

// ── fmtDayDate ────────────────────────────────────────────
describe('fmtDayDate', () => {
  it('formats a Date as "D Mon"', () => {
    expect(fmtDayDate(new Date(2026, 4, 21))).toBe('21 May')
    expect(fmtDayDate(new Date(2026, 0, 1))).toBe('1 Jan')
    expect(fmtDayDate(new Date(2026, 11, 31))).toBe('31 Dec')
  })

  it('returns an empty string for non-Date or invalid input', () => {
    expect(fmtDayDate(null)).toBe('')
    expect(fmtDayDate('2026-05-21')).toBe('')
    expect(fmtDayDate(new Date('nope'))).toBe('')
  })
})
