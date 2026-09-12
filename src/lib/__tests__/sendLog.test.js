import { describe, it, expect } from 'vitest'
import { parseFailedNames } from '../sendLog'

// The send endpoints return a human-readable `lines[]` transcript; the client
// parses it back to work out who was NOT reached, and stores that as
// `failedNames` while treating everyone else as notified. So a name this misses
// is a student silently marked "notified" who never got a message.
//
// It existed as three divergent regex pairs — Attendance/index.jsx, plus two in
// Exams.jsx — until 2026-09-12. The Exams copy matched only the STUDENT leg, so
// a send that failed on the parent leg alone was recorded as a success; it also
// captured the monitor and malformed-parent lines as if they named students.
//
// Every literal below is copied from an `api/send-*.js` lines.push() call. If
// one of those format strings changes, this file is where it must be updated.

describe('parseFailedNames', () => {
  it('catches a failure on the student leg', () => {
    expect(parseFailedNames(['  FAIL → Asha Patil (student → 919876543210): timeout']))
      .toEqual(['Asha Patil'])
  })

  // The bug this module was extracted to fix. api/send-whatsapp.js:245 emits
  // this line, and the Exams copy of the parser did not match it — the student
  // was counted as reached.
  it('catches a failure on the PARENT leg', () => {
    expect(parseFailedNames(['  FAIL → Asha Patil (parent → 919876543210): timeout']))
      .toEqual(['Asha Patil'])
  })

  it('reports a student once when both legs fail', () => {
    expect(parseFailedNames([
      '  FAIL → Asha Patil (student → 919876543210): timeout',
      '  FAIL → Asha Patil (parent → 919812345678): timeout',
    ])).toEqual(['Asha Patil'])
  })

  it('catches every SKIP reason the endpoints emit', () => {
    expect(parseFailedNames([
      '  SKIP Asha Patil — no mobile',
      '  SKIP Rahul Deshmukh — no parent mobile',
      '  SKIP Sana Shaikh — no items',
      '  SKIP Omkar Jadhav — no subjects',
    ])).toEqual(['Asha Patil', 'Rahul Deshmukh', 'Sana Shaikh', 'Omkar Jadhav'])
  })

  // The name is followed by the raw parent number here, not by the dash, so a
  // pattern anchored on "name — " captures "Asha Patil parent 98765".
  it('stops at the name on a malformed-parent SKIP', () => {
    expect(parseFailedNames(['  SKIP Asha Patil parent 98765 — unrecognised format']))
      .toEqual(['Asha Patil'])
  })

  // Deliberate suppression, not a delivery failure — but the consumer treats
  // everyone absent from this set as notified, and an on-leave student was not
  // notified. They belong in the set.
  it('counts an on-leave suppression as not-reached', () => {
    expect(parseFailedNames(['  SKIP Asha Patil — on leave'])).toEqual(['Asha Patil'])
  })

  // The monitoring copy is a staff sample, not a student. Both prior parsers
  // captured "monitor 9198…" as a student name, inflating the "Resend N failed"
  // count with a person who does not exist.
  it('ignores the monitor legs entirely', () => {
    expect(parseFailedNames([
      '  FAIL → monitor 919876543210: timeout',
      '  SKIP monitor 98765 — unrecognised format',
      '  MONITOR → 919876543210 (sample: Asha Patil)',
    ])).toEqual([])
  })

  it('ignores successes and the summary lines', () => {
    expect(parseFailedNames([
      '  SENT → Asha Patil (student → 919876543210)',
      '  SENT → Asha Patil (parent → 919812345678)',
      'Excluded 2 blocked/inactive student(s).',
      'Done. Sent: 4  Skipped: 0',
    ])).toEqual([])
  })

  it('reads a realistic mixed transcript', () => {
    expect(parseFailedNames([
      '  SENT → Asha Patil (student → 919876543210)',
      '  FAIL → Asha Patil (parent → 919812345678): rate limited',
      '  SENT → Rahul Deshmukh (student → 919811111111)',
      '  SENT → Rahul Deshmukh (parent → 919822222222)',
      '  SKIP Sana Shaikh — no mobile',
      '  MONITOR → 919833333333 (sample: Asha Patil)',
      'Done. Sent: 3  Skipped: 2',
    ])).toEqual(['Asha Patil', 'Sana Shaikh'])
  })

  it('tolerates names with punctuation and non-Latin scripts', () => {
    expect(parseFailedNames([
      "  FAIL → D'Souza, Maria (student → 919876543210): timeout",
      '  SKIP आशा पाटील — no mobile',
    ])).toEqual(["D'Souza, Maria", 'आशा पाटील'])
  })

  // Carried over from the old Attendance-local test: the order is the order the
  // endpoint reported, not alphabetical — it is rendered as a failure list.
  it('returns names in first-seen order', () => {
    expect(parseFailedNames([
      '  FAIL → Z Latecomer (student → 919876543210): x',
      '  FAIL → A Latecomer (parent → 919876543211): x',
    ])).toEqual(['Z Latecomer', 'A Latecomer'])
  })

  it('returns an empty array for absent, empty or non-array input', () => {
    expect(parseFailedNames(undefined)).toEqual([])
    expect(parseFailedNames(null)).toEqual([])
    expect(parseFailedNames([])).toEqual([])
    expect(parseFailedNames('not an array')).toEqual([])
  })

  it('skips non-string entries rather than throwing', () => {
    expect(parseFailedNames([null, 42, '  SKIP Asha Patil — no mobile']))
      .toEqual(['Asha Patil'])
  })
})
