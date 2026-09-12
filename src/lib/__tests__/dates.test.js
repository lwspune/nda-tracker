import { describe, it, expect } from 'vitest'
import { fmtDate, fmtDateShort, fmtTimestamp } from '../dates'

// One date format for the whole app (2026-09-12): `12 Sep 2026`, day-first,
// short month, no punctuation — plus a year-less `12 Sep` for dense lists that
// only ever show recent dates.
//
// Twelve hand-written fmtDate copies existed before this, in three formats:
// seven rendered `12 Sep 2026`, three `12 Sep`, and chapterAccordionHelpers
// rendered US-order `Sep 12, 2026`. Empty input produced '', '—', null, or the
// raw input echoed back, depending on which copy you hit.
//
// Deliberately NOT toLocaleDateString: its output depends on the runtime's ICU
// data, so the same date could render differently in a browser, in jsdom and
// under Node. The WhatsApp sender (api/_wabridge.js) already hand-rolls its
// month names for exactly this reason; screen and message now agree by
// construction rather than by coincidence.
//
// The HOSTEL subsystem is deliberately excluded — it displays DD-MM-YYYY to
// match its own storage format and its date picker.

describe('fmtDate', () => {
  it('renders day-first with a short month name and the year', () => {
    expect(fmtDate('2026-09-12')).toBe('12 Sep 2026')
    expect(fmtDate('2026-01-31')).toBe('31 Jan 2026')
    expect(fmtDate('2026-12-01')).toBe('1 Dec 2026')
  })

  // Not '04 Sep' — one of the twelve copies used a 2-digit day and the other
  // eleven did not. Numeric wins: it is what the majority rendered.
  it('does not zero-pad a single-digit day', () => {
    expect(fmtDate('2026-09-04')).toBe('4 Sep 2026')
  })

  it('accepts a full timestamp and ignores the time part', () => {
    expect(fmtDate('2026-09-12T18:30:00.000Z')).toBe('12 Sep 2026')
    expect(fmtDate('2026-09-12T00:00:00+05:30')).toBe('12 Sep 2026')
  })

  // A date string is a CALENDAR date, not an instant. Parsing '2026-09-12' via
  // `new Date()` treats it as UTC midnight, which in a negative-offset timezone
  // renders as the 11th. Reading the digits avoids the whole class of bug.
  it('never shifts the day across a timezone boundary', () => {
    expect(fmtDate('2026-01-01')).toBe('1 Jan 2026')
    expect(fmtDate('2026-12-31')).toBe('31 Dec 2026')
  })

  it('returns an empty string for missing or unreadable input', () => {
    expect(fmtDate('')).toBe('')
    expect(fmtDate(null)).toBe('')
    expect(fmtDate(undefined)).toBe('')
    expect(fmtDate('not a date')).toBe('')
    expect(fmtDate('2026-13-01')).toBe('')   // month 13
    expect(fmtDate('2026-00-10')).toBe('')   // month 0
    expect(fmtDate('2026-09-32')).toBe('')   // day 32
    expect(fmtDate('2026-09-00')).toBe('')   // day 0
  })

  // Callers that want a placeholder write `fmtDate(x) || '—'`, which is why ''
  // rather than null is the empty value — one of the twelve returned '—' and
  // another returned the input unchanged, both of which leak into tables.
  it('returns a falsy value callers can default from', () => {
    expect(fmtDate('') || '—').toBe('—')
    expect(fmtDate('2026-09-12') || '—').toBe('12 Sep 2026')
  })
})

describe('fmtDateShort', () => {
  it('drops the year', () => {
    expect(fmtDateShort('2026-09-12')).toBe('12 Sep')
    expect(fmtDateShort('2026-09-04')).toBe('4 Sep')
  })

  it('follows the same rules as fmtDate for bad input', () => {
    expect(fmtDateShort('')).toBe('')
    expect(fmtDateShort(null)).toBe('')
    expect(fmtDateShort('rubbish')).toBe('')
  })

  it('agrees with fmtDate on the day and month', () => {
    for (const iso of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      expect(fmtDate(iso).startsWith(fmtDateShort(iso))).toBe(true)
    }
  })
})

describe('fmtTimestamp', () => {
  // A timestamptz is an INSTANT, not a calendar date, so the digits cannot just
  // be read the way fmtDate reads them — that would print the UTC date. An
  // incident logged at 20:00 UTC on the 12th happened at 01:30 IST on the 13th,
  // and this is a Pune institute, so the 13th is the answer a user expects.
  //
  // IST is hardcoded (+05:30, no DST) rather than using the browser's local
  // zone: it makes the output deterministic and testable, and matches the
  // istToday()/istDateString() pattern already used server-side.
  it('renders an instant as its IST calendar date', () => {
    expect(fmtTimestamp('2026-09-12T20:00:00.000Z')).toBe('13 Sep 2026')
    expect(fmtTimestamp('2026-09-12T10:00:00.000Z')).toBe('12 Sep 2026')
  })

  it('rolls the month and year at the IST boundary', () => {
    expect(fmtTimestamp('2026-08-31T19:00:00.000Z')).toBe('1 Sep 2026')
    expect(fmtTimestamp('2026-12-31T19:00:00.000Z')).toBe('1 Jan 2027')
  })

  it('honours an explicit offset in the string', () => {
    expect(fmtTimestamp('2026-09-12T23:30:00+05:30')).toBe('12 Sep 2026')
  })

  it('returns an empty string for missing or unparseable input', () => {
    expect(fmtTimestamp('')).toBe('')
    expect(fmtTimestamp(null)).toBe('')
    expect(fmtTimestamp('rubbish')).toBe('')
  })
})
