// What grading:preview and grading:commit share: loading a submission, checking
// grade.json (the grades AND the page marks), and the drawing payload whose
// hash is the preview stamp. ONE copy, so the commit compares against exactly
// what the preview drew.
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { validateGrade } from '../../src/lib/assignments/grade.js'
import { validateMarks, drawingPayload } from '../../src/lib/assignments/pageMarks.js'
import { buildPaperReport } from '../../src/lib/assignments/paperReport.js'
import { fmtTimestamp } from '../../src/lib/dates.js'

const PAGES_SCRIPT = join('scripts', 'grading', 'pages.py')

// scripts/grading/pages.py prepare|draw <dir>. -E -P, not -I: isolated mode
// hides PyMuPDF on this machine.
export function runPages(command, dir) {
  const r = spawnSync('python', ['-E', '-P', PAGES_SCRIPT, command, dir], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`pages.py ${command}: ${(r.stderr || r.error?.message || 'failed').trim()}`)
  return JSON.parse(r.stdout)
}

export async function loadSubmission(db, id) {
  const { data: s, error } = await db
    .from('homework_submissions')
    .select('id, lws_id, student_name, status, assignment_id, homework_assignments(max_marks, questions, due_at, title, subject)')
    .eq('id', id)
    .single()
  if (error) throw new Error(`submission ${id}: ${error.message}`)
  // Whether there is a reference to have compared against (the database checks
  // this again; asking here names the problem before anything is written).
  const { data: ref, error: refErr } = await db
    .from('homework_hand_references').select('submission_id').eq('lws_id', s.lws_id).maybeSingle()
  if (refErr) throw new Error(`reference: ${refErr.message}`)
  return { s, a: s.homework_assignments, hasReference: Boolean(ref && ref.submission_id !== id) }
}

export function preparedPageCount(dir, id) {
  const path = join(dir, 'pages', 'pages.json')
  if (!existsSync(path)) {
    throw new Error(`The pages were not prepared. Run npm run grading:pull -- --id=${id} (it keeps grade.json).`)
  }
  return JSON.parse(readFileSync(path, 'utf8')).length
}

export const sha256 = text => createHash('sha256').update(text).digest('hex')

// grade.json → { ok: true, grade, marks, pageCount, payloadJson, stamp } | { ok: false, errors }
export function checkGradeFile({ dir, id, a, hasReference }) {
  const file = JSON.parse(readFileSync(join(dir, 'grade.json'), 'utf8'))
  if (file.submissionId !== id) throw new Error(`grade.json is for ${file.submissionId}, not ${id}.`)
  const grade = validateGrade({
    maxMarks: Number(a.max_marks), hasReference, file,
    questions: (a.questions ?? []).map(q => ({ ...q, marks: Number(q.marks) })),
  })
  if (!grade.ok) return { ok: false, errors: [...grade.errors, '(The page marks are checked once the grades pass.)'] }

  const pageCount = preparedPageCount(dir, id)
  const marks = validateMarks({ marks: file.marks, pageCount, rows: grade.rows })
  if (!marks.ok) return { ok: false, errors: marks.errors }

  const payloadJson = JSON.stringify({ pageCount, ...drawingPayload({ marks: marks.marks, rows: grade.rows }) })
  return { ok: true, grade, marks: marks.marks, pageCount, payloadJson, stamp: sha256(payloadJson) }
}

// What scripts/grading/pages.py `report` lays out: the header facts, every
// question's line, and buildPaperReport (the same builder the app shows).
export function reportJson({ s, a, check }) {
  const { grade } = check
  return JSON.stringify({
    title: a.title, subject: a.subject, student: s.student_name,
    gradedOn: fmtTimestamp(new Date().toISOString()),
    pageCount: check.pageCount, wentWell: grade.wentWell, nextSteps: grade.nextSteps,
    grades: grade.rows.map(r => ({ label: r.label, maxMarks: r.maxMarks, outcome: r.outcome, awarded: r.awarded, missing: r.missing })),
    report: buildPaperReport(grade.rows),
  })
}

export function printErrors(errors) {
  console.error(`grade.json has ${errors.length} problem(s):`)
  for (const e of errors) console.error(`  - ${e}`)
}
