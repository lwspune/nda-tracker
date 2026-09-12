// The single reader of the send endpoints' `lines[]` transcript.
//
// Every api/send-*.js returns a human-readable transcript alongside its counts.
// The client parses it back to work out who was NOT reached, stores that as
// `failedNames`, and treats everyone else as notified (the pending-aware model
// behind "Resend N failed"). A name this parser misses is therefore a student
// silently recorded as notified who never got a message.
//
// This lives next to nothing — the format is PRODUCED in api/send-*.js, and the
// literals below are copied from those lines.push() calls. Changing a format
// string there means changing this file and src/lib/__tests__/sendLog.test.js.
// That coupling is the point: it used to be three divergent regex pairs
// (Attendance/index.jsx plus two in Exams.jsx), and the Exams pair matched only
// the student leg, so a send that failed on the PARENT leg alone was recorded
// as a success.

// Lines that name a staff recipient rather than a student. The monitoring copy
// is a sample sent to faculty; capturing "monitor 9198…" as a student name
// inflates the failed count with someone who does not exist.
const MONITOR = /^(?:FAIL → |SKIP )monitor\b/

// "FAIL → <name> (student → …)" / "(parent → …)". Non-greedy up to the leg
// marker, so a name containing " (" cannot swallow it.
const FAIL_LEG = /^FAIL → (.+?) \((?:student|parent) → /

// "SKIP <name> — <reason>" and "SKIP <name> parent <number> — unrecognised
// format". The parent variant must be tried as an alternative to the dash, not
// after it: anchoring on the dash alone captures "<name> parent 98765".
const SKIP = /^SKIP (.+?) (?:—|parent )/

/**
 * Student names that were NOT fully reached by a send.
 *
 * Includes deliberate suppressions (`— on leave`): the consumer marks everyone
 * absent from this set as notified, and a suppressed student was not notified.
 *
 * @param {string[]} lines transcript from a send endpoint's `lines[]`
 * @returns {string[]} unique names, in first-seen order
 */
export function parseFailedNames(lines) {
  if (!Array.isArray(lines)) return []
  const out = new Set()
  for (const raw of lines) {
    if (typeof raw !== 'string') continue
    const line = raw.trim()
    if (MONITOR.test(line)) continue
    const m = line.match(FAIL_LEG) || line.match(SKIP)
    if (m) out.add(m[1].trim())
  }
  return [...out]
}
