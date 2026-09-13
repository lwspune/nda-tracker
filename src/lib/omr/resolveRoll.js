// Who does this sheet belong to?
//
// On a generic (photocopiable) sheet the student bubbles their own ID, so
// identity is READ rather than printed. An unreadable roll is harmless — it goes
// to review. The failure that matters is a misread landing on a DIFFERENT VALID
// STUDENT, silently swapping two people's marks, and everything here exists to
// make that impossible rather than unlikely:
//
//   1. the roster is a CLOSED SET — the exam's batch, not the whole school;
//   2. more than one candidate is a refusal, never a pick;
//   3. an unreadable column is a refusal, never a rounded-up guess;
//   4. two sheets claiming one student are both surfaced (`findDuplicateRolls`).
//
// TRANSITION: students keep writing the Evalbee roll number they already know,
// so `evalbee_roll_nos` is matched FIRST and beats our own LWS numbering. That
// column is vendor-named but load-bearing for exactly this reason — do not
// rename it while both schemes are in use.

import { decideQuestion } from './readBubbles'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * Read the roll-number block: one column per digit, ten bubbles each.
 *
 * @param {number[][]} columnScores  per column, ten scores (digit 0..9)
 * @param {object} cal               calibration from `calibrate`
 * @returns {{digits:string|null, review:boolean, reason:string|null, perColumn:object[]}}
 */
export function readRollDigits(columnScores, cal) {
  const perColumn = columnScores.map((scores, i) =>
    decideQuestion({ q: i, options: DIGITS, scores }, cal))

  if (perColumn.every(d => d.state === 'blank')) {
    // Seen in the wild: a sheet handed in with the roll block untouched.
    return { digits: null, review: true, reason: 'roll number left blank', perColumn }
  }
  const bad = perColumn.find(d => d.state !== 'single')
  if (bad) {
    const reason = bad.state === 'multi'
      ? 'multiple digits marked in one column'
      : bad.state === 'blank'
        ? 'a digit column was left blank'
        : 'ambiguous digit mark'
    return { digits: null, review: true, reason, perColumn }
  }
  return { digits: perColumn.map(d => d.choice).join(''), review: false, reason: null, perColumn }
}

/** Digits only, leading zeros dropped — students write `13`, `013` and `00013`. */
const normalise = v => {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits ? String(Number(digits)) : ''
}

/** The numeric tail of an LWS id, so `LWS-048` compares against `00048`. */
const lwsNumber = lwsId => {
  const m = String(lwsId ?? '').match(/(\d+)\s*$/)
  return m ? String(Number(m[1])) : ''
}

/**
 * Resolve a roll number to one student in the exam's roster.
 *
 * @param {string|null} roll
 * @param {{lwsId:string, name?:string, evalbeeRollNos?:string[]}[]} roster
 *        the EXAM's batch — passing the whole school defeats the closed set
 * @returns {{lwsId:string|null, matchedBy:string|null, candidates:object[], review:boolean, reason:string|null}}
 */
export function resolveRoll(roll, roster = []) {
  const key = normalise(roll)
  if (!key) {
    return { lwsId: null, matchedBy: null, candidates: [], review: true, reason: 'no roll number read' }
  }

  const byEvalbee = roster.filter(s =>
    (s.evalbeeRollNos || []).some(r => normalise(r) === key))
  const byLws = roster.filter(s => lwsNumber(s.lwsId) === key)

  // BOTH namespaces are consulted before answering. Returning on the first
  // Evalbee hit looks right — the student writes the number they know — but the
  // two schemes overlap: measured in the live roster, there are 7 cases INSIDE a
  // single batch where one student's Evalbee roll equals another's LWS number.
  // A student with no Evalbee roll writes their LWS number and would silently
  // collect someone else's marks. Two readings pointing at two students is not
  // a preference to resolve, it is a question for a human.
  const union = [...byEvalbee]
  for (const s of byLws) if (!union.includes(s)) union.push(s)

  if (union.length > 1) {
    const both = byEvalbee.length && byLws.length
    return {
      lwsId: null, matchedBy: null, candidates: union, review: true,
      reason: both
        ? `roll ${key} means different students under the two numbering schemes`
        : `roll ${key} matches ${union.length} students`,
    }
  }
  if (union.length === 1) {
    return {
      lwsId: union[0].lwsId,
      matchedBy: byEvalbee.length ? 'evalbee' : 'lwsId',
      candidates: union, review: false, reason: null,
    }
  }
  return {
    lwsId: null, matchedBy: null, candidates: [], review: true,
    reason: `roll ${key} is not on the roster for this exam`,
  }
}

/**
 * Sheets that resolved to the same student.
 *
 * Both are surfaced rather than the later one winning: one of them belongs to
 * somebody else, and quietly keeping the last would discard a real result.
 */
export function findDuplicateRolls(sheets) {
  const byStudent = new Map()
  for (const s of sheets) {
    if (!s.lwsId) continue          // already in review; not a duplicate
    if (!byStudent.has(s.lwsId)) byStudent.set(s.lwsId, [])
    byStudent.get(s.lwsId).push(s.sheet)
  }
  return [...byStudent.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([lwsId, list]) => ({ lwsId, sheets: list }))
}
