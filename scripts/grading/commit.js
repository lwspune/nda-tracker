// npm run grading:commit -- <submission id> — check a filled grade.json and save
// it. The student sees it in their portal at once (auto-release) — UNLESS the
// handwriting check is a mismatch: then it is saved HELD, and reaches the
// student only when the homework's teacher or an admin releases it.
//
//   npm run grading:commit -- <id>          # check, then save
//   npm run grading:commit -- <id> --dry    # check only, write nothing
//   npm run grading:commit -- <id> --reject="Pages 2 and 3 are too dark to read. Retake them in daylight."
//
// The check (src/lib/assignments/grade.js) prints EVERY problem; nothing is saved
// unless it passes. homework_grade_commit then saves the rows, checks they cover
// the homework's marks and sums the total itself. A regrade is the same command
// after `grading:pull -- --id=<id>`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, arg, fail } from './_client.js'
import { validateGrade } from '../../src/lib/assignments/grade.js'
import { commitRows } from '../../src/lib/assignments/brief.js'

async function main() {
  const id = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!id) throw new Error('Usage: npm run grading:commit -- <submission id> [--dry] [--reject="reason"]')
  const dry = process.argv.includes('--dry')
  const reject = arg('reject')?.trim()
  const db = serviceClient()

  const { data: s, error } = await db
    .from('homework_submissions')
    .select('id, lws_id, status, assignment_id, homework_assignments(max_marks, questions, due_at)')
    .eq('id', id)
    .single()
  if (error) throw new Error(`submission ${id}: ${error.message}`)
  const a = s.homework_assignments

  if (reject !== undefined) {
    if (reject.length < 10) throw new Error('--reject needs a reason the student can act on (10+ characters).')
    if (s.status !== 'submitted') throw new Error(`${id} is ${s.status}; only a submission waiting to be graded can be rejected.`)
    if (Date.parse(a.due_at) <= Date.now()) {
      console.log('NOTE: the deadline has passed, so the student cannot hand it in again. Grade what can be read if you can.')
    }
    if (dry) { console.log(`Would reject ${id}: ${reject}`); return }
    const { error: rErr } = await db.rpc('homework_submission_reject', { p_submission: id, p_reason: reject })
    if (rErr) throw new Error(`reject: ${rErr.message}`)
    console.log(`Rejected ${id}. The student sees the reason in their portal.`)
    return
  }

  const file = JSON.parse(readFileSync(join(INBOX, id, 'grade.json'), 'utf8'))
  if (file.submissionId !== id) throw new Error(`grade.json is for ${file.submissionId}, not ${id}.`)
  const maxMarks = Number(a.max_marks)
  // Whether there is a reference to have compared against (the database checks
  // this again; asking here names the problem before anything is written).
  const { data: ref, error: refErr } = await db
    .from('homework_hand_references').select('submission_id').eq('lws_id', s.lws_id).maybeSingle()
  if (refErr) throw new Error(`reference: ${refErr.message}`)
  const hasReference = Boolean(ref && ref.submission_id !== id)
  const check = validateGrade({
    maxMarks, hasReference, file,
    questions: (a.questions ?? []).map(q => ({ ...q, marks: Number(q.marks) })),
  })
  if (!check.ok) {
    console.error(`grade.json has ${check.errors.length} problem(s):`)
    for (const e of check.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(`Check passed: ${check.totalAwarded} / ${maxMarks} over ${check.rows.length} question(s). Handwriting: ${check.handwriting.check}.`)
  if (check.handwriting.holds) console.log('This grade will be HELD: the student will not see it until their teacher releases it.')
  if (dry) return

  const { data: saved, error: cErr } = await db.rpc('homework_grade_commit', {
    p_submission: id,
    p_grades: commitRows(check.rows),
    p_went_well: check.wentWell,
    p_next_steps: check.nextSteps,
    p_grader: 'session',
    p_hand_check: check.handwriting.check,
    p_hand_note: check.handwriting.note,
  })
  if (cErr) throw new Error(`save: ${cErr.message}`)
  const regrade = s.status === 'graded' || s.status === 'held' ? ' (regrade)' : ''
  if (saved.status === 'held') {
    console.log(`Saved HELD: ${Number(saved.total)} / ${maxMarks}${regrade}. The student sees "waiting to be graded" until their teacher releases it on the Homework page.`)
  } else {
    console.log(`Saved: ${Number(saved.total)} / ${maxMarks}${regrade}. The student can see it now.`)
  }
}

main().catch(fail)
