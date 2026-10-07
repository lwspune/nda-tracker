import { describe, it, expect } from 'vitest'
import {
  normalizeHolidayRow,
  isSunday,
  dayOffReason,
  makeDayOff,
  studentIndexFromProfiles,
  filterWorkingDays,
  filterWorkingDaysByStudent,
  holidaysInRange,
  formatHolidayList,
  buildHolidayRows,
  splitHolidays,
  MAX_HOLIDAY_SPAN_DAYS,
} from '../holidays'

const H = (over = {}) => ({
  id: 'h1', name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11',
  branch: 'APJ', batchNames: [], ...over,
})

const lws = { branch: 'LWS Pune', batches: ['LWS_NDA_2Y_(26-28)_A'] }
const apj = { branch: 'APJ', batches: ['APJ_NDA_12th_(26-27)'] }

describe('normalizeHolidayRow', () => {
  it('maps the snake_case row to the client shape', () => {
    expect(normalizeHolidayRow({
      id: 'x', name: 'Holi', from_date: '2026-03-03', to_date: '2026-03-04',
      branch: 'LWS Pune', batch_names: ['B1'], created_by: 'a@b',
    })).toEqual({
      id: 'x', name: 'Holi', fromDate: '2026-03-03', toDate: '2026-03-04',
      branch: 'LWS Pune', batchNames: ['B1'], createdBy: 'a@b',
    })
  })

  it('treats a null batch list as the whole branch', () => {
    expect(normalizeHolidayRow({ id: 'x', name: 'n', from_date: '2026-01-01', to_date: '2026-01-01', branch: 'APJ', batch_names: null }).batchNames).toEqual([])
  })
})

describe('isSunday', () => {
  it('reads the calendar date, not a UTC instant', () => {
    expect(isSunday('2026-10-04')).toBe(true)   // Sunday
    expect(isSunday('2026-10-05')).toBe(false)  // Monday
    expect(isSunday('2026-10-03')).toBe(false)  // Saturday
  })

  it('is false for anything that is not a YYYY-MM-DD date', () => {
    expect(isSunday('')).toBe(false)
    expect(isSunday(null)).toBe(false)
    expect(isSunday('04-10-2026')).toBe(false)
  })
})

describe('dayOffReason', () => {
  it('Sunday is off for every student, with or without a branch', () => {
    expect(dayOffReason([], lws, '2026-10-04')).toBe('Sunday')
    expect(dayOffReason([], apj, '2026-10-04')).toBe('Sunday')
    expect(dayOffReason([], null, '2026-10-04')).toBe('Sunday')
  })

  it('a whole-branch holiday covers every day of its range, both ends included', () => {
    const hs = [H()]
    expect(dayOffReason(hs, apj, '2026-11-09')).toBe('Diwali')
    expect(dayOffReason(hs, apj, '2026-11-10')).toBe('Diwali')
    expect(dayOffReason(hs, apj, '2026-11-11')).toBe('Diwali')
    expect(dayOffReason(hs, apj, '2026-11-12')).toBeNull()
    expect(dayOffReason(hs, apj, '2026-11-07')).toBeNull()
  })

  it('a holiday for one branch does not touch the other', () => {
    expect(dayOffReason([H()], lws, '2026-11-10')).toBeNull()
  })

  it('a batch-scoped holiday covers only the listed batches', () => {
    const hs = [H({ batchNames: ['APJ_NDA_12th_(26-27)'] })]
    expect(dayOffReason(hs, apj, '2026-11-10')).toBe('Diwali')
    expect(dayOffReason(hs, { branch: 'APJ', batches: ['APJ_NDA_11th_A'] }, '2026-11-10')).toBeNull()
  })

  it('a student in two batches is off only when BOTH batches are off', () => {
    const two = { branch: 'APJ', batches: ['APJ_NDA_12th_(26-27)', 'APJ_NDA_11th_A'] }
    expect(dayOffReason([H({ batchNames: ['APJ_NDA_12th_(26-27)'] })], two, '2026-11-10')).toBeNull()
    expect(dayOffReason([H({ batchNames: ['APJ_NDA_12th_(26-27)', 'APJ_NDA_11th_A'] })], two, '2026-11-10')).toBe('Diwali')
  })

  it('a batch-scoped holiday does not cover a student with no batch', () => {
    expect(dayOffReason([H({ batchNames: ['APJ_NDA_12th_(26-27)'] })], { branch: 'APJ', batches: [] }, '2026-11-10')).toBeNull()
  })

  it('a whole-branch holiday covers a student with no batch', () => {
    expect(dayOffReason([H()], { branch: 'APJ', batches: [] }, '2026-11-10')).toBe('Diwali')
  })

  it('a student with no branch gets Sundays only', () => {
    expect(dayOffReason([H()], { branch: '', batches: [] }, '2026-11-10')).toBeNull()
  })
})

describe('makeDayOff', () => {
  it('looks the student up by lws_id', () => {
    const idx = new Map([['S1', apj], ['S2', lws]])
    const off = makeDayOff([H()], idx)
    expect(off('S1', '2026-11-10')).toBe('Diwali')
    expect(off('S2', '2026-11-10')).toBeNull()
  })

  it('an unknown student still gets Sundays off', () => {
    const off = makeDayOff([H()], new Map())
    expect(off('ghost', '2026-10-04')).toBe('Sunday')
    expect(off('ghost', '2026-11-10')).toBeNull()
  })
})

describe('studentIndexFromProfiles', () => {
  it('indexes canonical profiles by lwsId and skips variant-keyed entries', () => {
    const profiles = {
      'Asha Patil':  { name: 'Asha Patil', lwsId: 'S1', branch: 'APJ', batches: ['B1'] },
      'Asha Patel':  { name: 'Asha Patil', lwsId: 'S1', branch: 'APJ', batches: ['B1'] }, // variant
      'Ravi Kumar':  { name: 'Ravi Kumar', lwsId: 'S2', branch: 'LWS Pune' },
      'No Id':       { name: 'No Id', branch: 'APJ' },
    }
    const idx = studentIndexFromProfiles(profiles)
    expect([...idx.keys()]).toEqual(['S1', 'S2'])
    expect(idx.get('S2')).toEqual({ branch: 'LWS Pune', batches: [] })
  })
})

describe('filterWorkingDays', () => {
  it("drops one student's rows on Sundays and their holidays, keeping the rest", () => {
    const rows = [
      { date: '2026-11-07', status: 'P' },   // Sat
      { date: '2026-11-08', status: 'A' },   // Sun
      { date: '2026-11-09', status: 'A' },   // Diwali
      { date: '2026-11-12', status: 'A' },
    ]
    expect(filterWorkingDays(rows, [H()], apj).map(r => r.date)).toEqual(['2026-11-07', '2026-11-12'])
  })
})

describe('filterWorkingDaysByStudent', () => {
  it('drops rows per student, so a branch holiday leaves the other branch alone', () => {
    const idx = new Map([['S1', apj], ['S2', lws]])
    const rows = [
      { lws_id: 'S1', date: '2026-11-10', status: 'A' },
      { lws_id: 'S2', date: '2026-11-10', status: 'A' },
    ]
    expect(filterWorkingDaysByStudent(rows, makeDayOff([H()], idx))).toEqual([rows[1]])
  })

  it('takes the date from the caller when the rows are for one day and carry none', () => {
    const idx = new Map([['S1', apj], ['S2', lws]])
    const rows = [{ lws_id: 'S1', status: 'A' }, { lws_id: 'S2', status: 'A' }]
    expect(filterWorkingDaysByStudent(rows, makeDayOff([H()], idx), '2026-11-10')).toEqual([rows[1]])
  })
})

describe('holidaysInRange', () => {
  it("lists the student's holidays that overlap the range, clipped to it, in date order", () => {
    const hs = [
      H({ id: 'b', name: 'Diwali', fromDate: '2026-10-30', toDate: '2026-11-02' }),
      H({ id: 'a', name: 'Dasara', fromDate: '2026-10-20', toDate: '2026-10-20' }),
      H({ id: 'c', name: 'Other branch', branch: 'LWS Pune', fromDate: '2026-10-21', toDate: '2026-10-21' }),
      H({ id: 'd', name: 'Before', fromDate: '2026-09-01', toDate: '2026-09-02' }),
    ]
    expect(holidaysInRange(hs, apj, '2026-10-01', '2026-10-31')).toEqual([
      { name: 'Dasara', fromDate: '2026-10-20', toDate: '2026-10-20' },
      { name: 'Diwali', fromDate: '2026-10-30', toDate: '2026-10-31' },
    ])
  })

  it('collapses two rows that describe the same holiday', () => {
    const hs = [H({ id: 'a' }), H({ id: 'b' })]
    expect(holidaysInRange(hs, apj, '2026-11-01', '2026-11-30')).toHaveLength(1)
  })
})

describe('formatHolidayList', () => {
  it('prints one day, a range in one month, and a range across months', () => {
    expect(formatHolidayList([
      { name: 'Independence Day', fromDate: '2026-08-15', toDate: '2026-08-15' },
      { name: 'Ganesh', fromDate: '2026-09-25', toDate: '2026-09-26' },
      { name: 'Break', fromDate: '2026-09-30', toDate: '2026-10-02' },
    ])).toBe('15 Aug Independence Day, 25-26 Sep Ganesh, 30 Sep-2 Oct Break')
  })

  it('can leave the names out (the PDF cannot print some scripts)', () => {
    expect(formatHolidayList([{ name: 'दिवाळी', fromDate: '2026-11-09', toDate: '2026-11-09' }], { names: false }))
      .toBe('9 Nov')
  })

  it('is empty for no holidays', () => {
    expect(formatHolidayList([])).toBe('')
  })
})

describe('buildHolidayRows', () => {
  const base = {
    name: ' Diwali ', fromDate: '2026-11-09', toDate: '2026-11-11',
    scopes: [{ branch: 'APJ', batchNames: [] }, { branch: 'LWS Pune', batchNames: ['B1', 'B2'] }],
  }

  it('makes one row per branch, trimming the name', () => {
    expect(buildHolidayRows(base)).toEqual({
      rows: [
        { name: 'Diwali', from_date: '2026-11-09', to_date: '2026-11-11', branch: 'APJ', batch_names: [] },
        { name: 'Diwali', from_date: '2026-11-09', to_date: '2026-11-11', branch: 'LWS Pune', batch_names: ['B1', 'B2'] },
      ],
    })
  })

  it('a missing "to" date means a one-day holiday', () => {
    expect(buildHolidayRows({ ...base, toDate: '' }).rows[0].to_date).toBe('2026-11-09')
  })

  it.each([
    [{ name: '  ' }, /name/i],
    [{ fromDate: '' }, /date/i],
    [{ fromDate: '09-11-2026' }, /date/i],
    [{ fromDate: '2026-02-30', toDate: '2026-02-30' }, /date/i],
    [{ toDate: '2026-11-08' }, /before/i],
    [{ toDate: '2027-03-01' }, new RegExp(String(MAX_HOLIDAY_SPAN_DAYS))],
    [{ scopes: [] }, /branch/i],
    [{ scopes: [{ branch: 'APJ', batchNames: [] }, { branch: 'APJ', batchNames: ['B1'] }] }, /twice/i],
  ])('refuses %o', (over, msg) => {
    const out = buildHolidayRows({ ...base, ...over })
    expect(out.rows).toBeUndefined()
    expect(out.error).toMatch(msg)
  })
})

describe('splitHolidays', () => {
  it('upcoming (incl. one in progress) soonest first; past most recent first', () => {
    const hs = [
      H({ id: 'past1', fromDate: '2026-08-15', toDate: '2026-08-15' }),
      H({ id: 'now',   fromDate: '2026-10-06', toDate: '2026-10-08' }),
      H({ id: 'later', fromDate: '2026-11-09', toDate: '2026-11-11' }),
      H({ id: 'past2', fromDate: '2026-09-25', toDate: '2026-09-26' }),
    ]
    const { upcoming, past } = splitHolidays(hs, '2026-10-07')
    expect(upcoming.map(h => h.id)).toEqual(['now', 'later'])
    expect(past.map(h => h.id)).toEqual(['past2', 'past1'])
  })
})
