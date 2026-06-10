import { describe, it, expect } from 'vitest'
import { getTodaysLectures, getSubjectHoursByBatch } from '../timetable'

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
