// One date format for the whole app.
//
//   fmtDate('2026-09-12')      -> '12 Sep 2026'
//   fmtDateShort('2026-09-12') -> '12 Sep'
//
// Twelve hand-written `fmtDate` copies existed before 2026-09-12, in three
// formats: seven rendered `12 Sep 2026`, three `12 Sep`, and
// chapterAccordionHelpers rendered US-order `Sep 12, 2026`. Empty input gave
// '', '—', null, or the raw input echoed back, depending which copy you hit.
//
// Two deliberate choices:
//
// 1. NOT toLocaleDateString. Its output depends on the runtime's ICU data, so
//    the same date can render differently in a browser, in jsdom, and under
//    Node. api/_wabridge.js already hand-rolls its month names so the message
//    sent to a parent is byte-stable; screen and message now agree by
//    construction rather than by coincidence.
//
// 2. The digits are READ, not parsed into a Date. A 'YYYY-MM-DD' string is a
//    calendar date, not an instant — `new Date('2026-09-12')` is UTC midnight,
//    which renders as the 11th anywhere west of Greenwich. Reading the digits
//    removes the whole class of bug.
//
// The HOSTEL subsystem is deliberately NOT a caller: it displays DD-MM-YYYY to
// match its own storage format and the date picker sitting above the list.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'YYYY-MM-DD' or a full timestamp -> { d, mon, y }, or null when unreadable.
function parts(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1]), mon = Number(m[2]), d = Number(m[3])
  if (mon < 1 || mon > 12 || d < 1 || d > 31) return null
  return { d, mon, y }
}

/**
 * '12 Sep 2026'. Returns '' for missing or unreadable input, so a caller
 * wanting a placeholder writes `fmtDate(x) || '—'`.
 */
export function fmtDate(value) {
  const p = parts(value)
  return p ? `${p.d} ${MONTHS[p.mon - 1]} ${p.y}` : ''
}

/**
 * '12 Sep' — for dense lists that only ever show recent dates (the attendance
 * and homework logs, recent incidents). Anything dated or historical should
 * use fmtDate so the year is on the page.
 */
export function fmtDateShort(value) {
  const p = parts(value)
  return p ? `${p.d} ${MONTHS[p.mon - 1]}` : ''
}

const IST_OFFSET_MS = 5.5 * 3600 * 1000

/**
 * '12 Sep 2026' for a TIMESTAMP (`created_at` and friends) rather than a
 * calendar date.
 *
 * Not the same operation as fmtDate, and not interchangeable with it. A
 * timestamptz is an instant: an incident logged at 20:00 UTC on the 12th
 * happened at 01:30 IST on the 13th, so reading its digits the way fmtDate does
 * would print the wrong day. Shift into IST first, then read.
 *
 * IST is hardcoded (+05:30, no DST) rather than taken from the browser's local
 * zone, which makes the output deterministic and testable and matches the
 * istToday()/istDateString() pattern already used server-side. Every user of
 * this app is in one timezone; a Pune institute's records should read in Pune
 * time wherever they are opened.
 */
export function fmtTimestamp(value) {
  if (!value) return ''
  const ms = Date.parse(String(value))
  if (Number.isNaN(ms)) return ''
  return fmtDate(new Date(ms + IST_OFFSET_MS).toISOString())
}
