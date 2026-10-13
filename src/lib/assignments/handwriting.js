// The handwriting check on a homework submission (2026-10-13). PURE.
// Imported by Node scripts, so relative imports carry their .js extension.
//
// Every grade records whether the pages are in the same hand as the student's
// REFERENCE: their first graded homework (homework_hand_references). The check
// is a grader comparing photographs by eye, so it is a lead for a teacher,
// never proof — it never changes the marks. A `mismatch` keeps the grade from
// the student (status `held`) until the homework's teacher or an admin releases
// it or sends it back. `unclear` is released with a note: holding a grade on
// every blurry photo would hold half the class.
//
// The database repeats these rules (homework_grade_commit); a test pins the
// shared constants together.

export const HAND_CHECKS = ['match', 'mismatch', 'unclear', 'no_reference']
export const MAX_HAND_NOTE_CHARS = 300

export const holdsGrade = check => check === 'mismatch'

const text = v => (typeof v === 'string' ? v.trim() : '')

// h: { check, note } from grade.json. hasReference: whether the student has a
// reference to compare against — when the caller does not say, only the shape
// is checked (the database applies the reference rule regardless).
// → { ok: true, value: { check, note } } | { ok: false, errors }
export function validateHandwriting(h, { hasReference } = {}) {
  if (typeof h !== 'object' || h === null || Array.isArray(h)) {
    return { ok: false, errors: ['`handwriting` is missing: compare the pages with the reference, or record no_reference.'] }
  }
  const errors = []
  const check = h.check
  const note = text(h.note)
  if (!HAND_CHECKS.includes(check)) {
    errors.push(`\`handwriting.check\` must be one of ${HAND_CHECKS.join(', ')}.`)
  } else {
    if ((check === 'mismatch' || check === 'unclear') && !note) {
      errors.push(`\`handwriting.note\` is empty: a ${check} needs a note saying what differs, for the teacher.`)
    }
    if (hasReference === true && check === 'no_reference') {
      errors.push('This student has a reference: compare against it instead of recording no_reference.')
    }
    if (hasReference === false && (check === 'match' || check === 'unclear')) {
      errors.push(`This student has no reference to compare against: record no_reference, or mismatch if the class-wide comparison found this hand on another submission (not ${check}).`)
    }
  }
  if (note.length > MAX_HAND_NOTE_CHARS) errors.push(`\`handwriting.note\` is over ${MAX_HAND_NOTE_CHARS} characters.`)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { check, note: note || null } }
}

// The 30-day page purge must never take a reference: it is kept until faculty
// delete it by hand.
export function withoutReferences(rows, referenceIds) {
  const keep = new Set(referenceIds ?? [])
  return (rows ?? []).filter(r => !keep.has(r.id))
}

const extOf = path => String(path).split('.').pop()

// The class-wide comparison (scripts/grading/hand-compare.js): page 1 of every
// submission, plus page 1 of that student's reference beside it, named by
// submission id ONLY so the folder carries no identity.
// submissions: [{ id, lws_id, files }]; references: [{ lws_id, submission_id, files, scans_deleted_at }]
// → [{ path, to }] (path in the submissions bucket; to = local file name)
export function handComparePlan({ submissions, references }) {
  const refByStudent = new Map((references ?? []).map(r => [r.lws_id, r]))
  const plan = []
  for (const s of submissions ?? []) {
    const first = s.files?.[0]
    if (!first) continue
    plan.push({ path: first, to: `${s.id}.${extOf(first)}` })
    const ref = refByStudent.get(s.lws_id)
    const refFirst = ref?.files?.[0]
    if (ref && ref.submission_id !== s.id && !ref.scans_deleted_at && refFirst) {
      plan.push({ path: refFirst, to: `${s.id}.reference.${extOf(refFirst)}` })
    }
  }
  return plan
}
