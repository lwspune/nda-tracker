// What a grading session reads and fills in (scripts/grading/pull.js). PURE.
// Imported by Node scripts, so relative imports carry their .js extension.
//
// The brief names no student: a grading transcript should hold the work, not
// the identity. The template's rows start with an EMPTY outcome (or no rows at
// all), which the checker refuses, so nothing passes unread.
import { fmtDeadline } from './editor.js'

const num = v => (v === null || v === undefined ? null : Number(v))
const marks = m => `${m} mark${m === 1 ? '' : 's'}`

// files: paths RELATIVE to the submission's inbox folder.
export function buildHomeworkBrief({ submission, assignment: a, files }) {
  const max = num(a.max_marks)
  const breakdown = (a.questions ?? []).map(q => ({ label: q.label, marks: num(q.marks) }))
  const out = [
    `# ${a.title}`,
    '',
    `Submission: ${submission.id}`,
    `Subject: ${a.subject} · out of ${max} · due ${fmtDeadline(a.due_at)} · submitted ${fmtDeadline(submission.submitted_at)}`,
    '',
    'Grade by scripts/grading/GRADING.md and fill grade.json in this folder.',
    '',
    '## What the teacher set',
    '',
    a.instructions?.trim() ? a.instructions.trim() : '(no description)',
    '',
  ]

  if (files.questions.length) {
    out.push('Question paper (read it first):', ...files.questions.map(f => `- ${f}`), '')
  } else {
    out.push(
      'There is NO question paper. The questions are whatever the description above names;',
      'take each question\'s wording from the student\'s pages (they usually copy it) and say so in',
      '`earned`/`missing` where the wording matters.', '',
    )
  }
  if (files.key.length) {
    out.push('Answer key (the teacher\'s; check it, do not trust it blindly):', ...files.key.map(f => `- ${f}`), '')
  } else {
    out.push('There is no answer key: work each answer out yourself before marking.', '')
  }

  out.push('## Marks', '')
  if (breakdown.length) {
    out.push('The teacher set these questions and marks. grade.json must use exactly these labels and maximums:', '')
    for (const q of breakdown) out.push(`- ${q.label} — ${marks(q.marks)}`)
    out.push('')
  } else {
    out.push(
      `No per-question marks were set. Split the ${marks(max)} across the questions as the work`,
      'naturally divides (equal shares unless some questions are clearly bigger), and write one',
      'grade row per question. The maximums must add up to the total.', '',
    )
  }

  out.push(`## The student's work (${files.scans.length} page${files.scans.length === 1 ? '' : 's'}, in order)`, '')
  for (const f of files.scans) out.push(`- ${f}`)
  out.push('')

  // The handwriting check (2026-10-13). Never changes the marks; a mismatch
  // keeps the grade from the student until faculty release it.
  const reference = files.reference ?? []
  out.push('## Handwriting check', '')
  if (reference.length) {
    out.push(
      'Compare the student\'s pages with their reference (their first graded homework), BEFORE marking:',
      '', ...reference.map(f => `- ${f}`), '',
      'Set `handwriting.check` in grade.json to match, mismatch or unclear. A mismatch is held from',
      'the student until their teacher releases it, so say in `handwriting.note` exactly what differs.', '',
    )
  } else {
    out.push(
      'This student has no reference yet. Record `no_reference` — or `mismatch`, with a note, if the',
      'class-wide comparison (npm run grading:hand-compare) found this hand on another submission.',
      'Once this grade is saved (and not held), this homework becomes the student\'s reference.', '',
    )
  }
  return out.join('\n')
}

export function gradeTemplate(submissionId, assignment) {
  return {
    submissionId,
    wentWell: '',
    nextSteps: '',
    handwriting: { check: '', note: '' },
    grades: (assignment.questions ?? []).map(q => ({
      label: q.label, max: num(q.marks), outcome: '', awarded: null, earned: '', missing: '',
    })),
  }
}

// A graded submission's saved grade, as grade.json — the starting point for a
// regrade. null when there is nothing saved.
// A grade saved before the handwriting check existed comes back with an empty
// check, which the checker refuses: a regrade records one.
export function savedGradeFile(submission) {
  if (submission.status !== 'graded' && submission.status !== 'held') return null
  return {
    submissionId: submission.id,
    wentWell: submission.went_well ?? '',
    nextSteps: submission.next_steps ?? '',
    handwriting: { check: submission.hand_check ?? '', note: submission.hand_note ?? '' },
    grades: [...(submission.homework_grades ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(g => ({
        label: g.label, max: num(g.max_marks), outcome: g.outcome, awarded: num(g.awarded),
        earned: g.earned ?? '', missing: g.missing ?? '',
      })),
  }
}

// validateGrade's rows → the JSON homework_grade_commit reads.
export function commitRows(rows) {
  return rows.map(r => ({
    position: r.position, label: r.label, maxMarks: r.maxMarks, outcome: r.outcome,
    awarded: r.awarded, earned: r.earned, missing: r.missing,
  }))
}
