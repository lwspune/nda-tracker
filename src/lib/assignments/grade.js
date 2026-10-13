// The grade checker for a homework submission. PURE.
//
// Every grade passes through this before a student sees it, whoever wrote it:
// today a Claude Code session (scripts/grading/, GRADING.md), later an
// automatic API call. Grades are auto-released, so this IS the review. It names
// every problem at once, so a whole grade file can be fixed in one pass.
//
// The database repeats the per-question bounds and sums the total itself
// (homework_grade_commit); a test pins the shared constants together.
//
// Adapted from PYQ Vault's src/lib/answerSheets/grade.ts. Homework has no OR
// choices, so there is no `not_counted`.
//
// 2026-10-13: every grade also carries a handwriting check (./handwriting.js).
// It never changes the marks; a mismatch holds the grade from the student.

import { validateHandwriting, holdsGrade } from './handwriting.js'

export const OUTCOMES = ['scored', 'not_attempted']
export const GRADERS = ['session', 'api']

export const MAX_LABEL_CHARS = 40
export const MAX_FEEDBACK_CHARS = 1000
export const MAX_SUMMARY_CHARS = 1500

const text = v => (typeof v === 'string' ? v.trim() : '')
const isHalf = n => Math.round(n * 2) === n * 2
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)

// { maxMarks, questions?: [{label, marks}], file, hasReference? } →
//   { ok: true, rows, totalAwarded, wentWell, nextSteps, handwriting } | { ok: false, errors }
//
// `file` is { wentWell, nextSteps, handwriting: { check, note }, grades: [{ label, max, outcome, awarded, earned, missing }] }.
// hasReference: whether the student has a handwriting reference (see validateHandwriting).
// Rows come back numbered 1..n: in the teacher's question order when a
// breakdown was set, else in the grade file's order.
export function validateGrade({ maxMarks, questions, file, hasReference }) {
  if (!isObject(file) || !Array.isArray(file.grades)) {
    return { ok: false, errors: ['The grade file needs a `grades` list.'] }
  }
  const errors = []

  const wentWell = text(file.wentWell)
  const nextSteps = text(file.nextSteps)
  if (!wentWell) errors.push('`wentWell` is empty: name what the student did well.')
  if (!nextSteps) errors.push('`nextSteps` is empty: name what to work on next.')
  if (wentWell.length > MAX_SUMMARY_CHARS) errors.push(`\`wentWell\` is over ${MAX_SUMMARY_CHARS} characters.`)
  if (nextSteps.length > MAX_SUMMARY_CHARS) errors.push(`\`nextSteps\` is over ${MAX_SUMMARY_CHARS} characters.`)
  const hand = validateHandwriting(file.handwriting, { hasReference })
  if (!hand.ok) errors.push(...hand.errors)

  const rows = []
  const seen = new Set()
  file.grades.forEach((raw, i) => {
    const at = `Grade ${i + 1}`
    if (!isObject(raw)) { errors.push(`${at} is not an object.`); return }
    const label = text(raw.label)
    if (!label) { errors.push(`${at} has no \`label\`.`); return }
    if (label.length > MAX_LABEL_CHARS) { errors.push(`${label}: the label is over ${MAX_LABEL_CHARS} characters.`); return }
    if (seen.has(label)) { errors.push(`${label} is graded twice.`); return }
    seen.add(label)

    const max = raw.max
    if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0 || !isHalf(max)) {
      errors.push(`${label}: \`max\` must be a positive number in halves.`)
      return
    }
    const outcome = raw.outcome
    if (!OUTCOMES.includes(outcome)) {
      errors.push(`${label}: outcome must be one of ${OUTCOMES.join(', ')}.`)
      return
    }
    const earned = text(raw.earned)
    const missing = text(raw.missing)
    if (earned.length > MAX_FEEDBACK_CHARS || missing.length > MAX_FEEDBACK_CHARS) {
      errors.push(`${label}: feedback is over ${MAX_FEEDBACK_CHARS} characters.`)
    }

    let awarded = null
    if (outcome === 'scored') {
      const a = raw.awarded
      if (typeof a !== 'number' || !Number.isFinite(a)) {
        errors.push(`${label}: a scored question needs numeric \`awarded\`.`)
        return
      }
      if (a < 0) errors.push(`${label}: marks cannot be negative.`)
      if (a > max) errors.push(`${label}: ${a} is more than its ${max} mark${max === 1 ? '' : 's'}.`)
      if (!isHalf(a)) errors.push(`${label}: marks go in halves (${a}).`)
      if (a < max && !missing) errors.push(`${label}: marks were lost, so say what was missing.`)
      if (a > 0 && !earned) errors.push(`${label}: marks were given, so say what earned them.`)
      awarded = a
    } else if (raw.awarded !== null && raw.awarded !== undefined) {
      errors.push(`${label}: \`awarded\` must be null when the question is ${outcome}.`)
    }

    rows.push({
      label, maxMarks: max, outcome, awarded,
      earned: outcome === 'scored' ? (earned || null) : null,
      missing: outcome === 'scored' ? (missing || null) : null,
    })
  })

  // Against the teacher's breakdown: the same questions, at the same marks.
  const breakdown = Array.isArray(questions) && questions.length > 0 ? questions : null
  if (breakdown) {
    const byLabel = new Map(rows.map(r => [r.label, r]))
    const setLabels = new Set(breakdown.map(q => text(q.label)))
    for (const q of breakdown) {
      const r = byLabel.get(text(q.label))
      if (!r) errors.push(`${text(q.label)} has no grade.`)
      else if (r.maxMarks !== q.marks) errors.push(`${r.label} is worth ${q.marks} marks in this assignment, not ${r.maxMarks}.`)
    }
    for (const r of rows) if (!setLabels.has(r.label)) errors.push(`${r.label} is not a question in this assignment.`)
    const order = new Map(breakdown.map((q, i) => [text(q.label), i]))
    rows.sort((a, b) => (order.get(a.label) ?? 1e9) - (order.get(b.label) ?? 1e9))
  }

  // The breakdown must cover the whole assignment, or a skipped question would
  // hand back a total that looks like a full score.
  const sumMax = rows.reduce((s, r) => s + r.maxMarks, 0)
  if (rows.length > 0 && sumMax !== maxMarks) {
    errors.push(`The questions' maximums add up to ${sumMax}, but the assignment is out of ${maxMarks}.`)
  }

  const scored = rows.filter(r => r.outcome === 'scored')
  if (rows.length > 0 && scored.length === 0) {
    errors.push('Nothing is scored. A submission with no gradable answer is a rejection: use --reject with a reason.')
  }
  if (rows.length === 0 && file.grades.length === 0) errors.push('The `grades` list is empty.')

  if (errors.length > 0) return { ok: false, errors }
  const totalAwarded = scored.reduce((s, r) => s + r.awarded, 0)
  return {
    ok: true,
    rows: rows.map((r, i) => ({ position: i + 1, ...r })),
    totalAwarded,
    wentWell,
    nextSteps,
    handwriting: { ...hand.value, holds: holdsGrade(hand.value.check) },
  }
}
