// npm run grading:commit -- <submission id> — check a filled grade.json and save
// it. The student sees it in their portal at once (auto-release) — UNLESS the
// handwriting check is a mismatch: then it is saved HELD, and reaches the
// student only when the homework's teacher or an admin releases it.
//
//   npm run grading:commit -- <id>          # check, then save
//   npm run grading:commit -- <id> --dry    # check only, write nothing
//   npm run grading:commit -- <id> --reject="Pages 2 and 3 are too dark to read. Retake them in daylight."
//
// The check (src/lib/assignments/grade.js + pageMarks.js) prints EVERY problem;
// nothing is saved unless it passes AND the marks were previewed as they stand
// (grading:preview's stamp). Then the pages AS DRAWN in the preview and the
// report PDF are uploaded to <submission>/marked/ (the student sees exactly
// what the grader looked at) and homework_grade_commit saves the grade and its
// page marks together, checks they cover the homework's marks and sums the total
// itself. A regrade is the same command after `grading:pull -- --id=<id>`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, arg, fail } from './_client.js'
import { commitRows } from '../../src/lib/assignments/brief.js'
import { SUBMISSIONS_BUCKET, markedPagePath, reportPdfPath } from '../../src/lib/assignments/upload.js'
import { loadSubmission, checkGradeFile, printErrors } from './_marking.js'

function previewStamp(dir) {
  const path = join(dir, 'preview', 'stamp.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).stamp : null
}

async function main() {
  const id = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!id) throw new Error('Usage: npm run grading:commit -- <submission id> [--dry] [--reject="reason"]')
  const dry = process.argv.includes('--dry')
  const reject = arg('reject')?.trim()
  const db = serviceClient()

  const { s, a, hasReference } = await loadSubmission(db, id)
  // The student swapped it for a newer hand-in before it was marked; the new
  // one is a different submission, waiting in the queue.
  if (s.status === 'replaced') {
    throw new Error(`${id} was replaced by the student with a newer hand-in, so it is not marked. Delete grading-inbox/${id}/ and run npm run grading:pull for the new one.`)
  }

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

  const dir = join(INBOX, id)
  const maxMarks = Number(a.max_marks)
  const check = checkGradeFile({ dir, id, a, hasReference })
  if (!check.ok) { printErrors(check.errors); process.exit(1) }
  // The marks as they stand must be the ones last drawn and looked at.
  if (previewStamp(dir) !== check.stamp) {
    console.error(`The marks have not been previewed as they stand. Run npm run grading:preview -- ${id} and look at every page first.`)
    process.exit(1)
  }
  const { grade } = check
  console.log(`Check passed: ${grade.totalAwarded} / ${maxMarks} over ${grade.rows.length} question(s), ${check.marks.length} mark(s) on ${check.pageCount} page(s). Handwriting: ${grade.handwriting.check}.`)
  if (grade.handwriting.holds) console.log('This grade will be HELD: the student will not see it until their teacher releases it.')
  if (dry) return

  // The marked pages as previewed, then the report. Upserted, so a regrade or
  // a retry after a failed save overwrites rather than duplicates.
  const uploads = [
    ...Array.from({ length: check.pageCount }, (_, i) => ({
      from: join(dir, 'preview', `${String(i + 1).padStart(2, '0')}.jpg`),
      to: markedPagePath(s.assignment_id, s.lws_id, id, i), type: 'image/jpeg',
    })),
    { from: join(dir, 'preview', 'report.pdf'), to: reportPdfPath(s.assignment_id, s.lws_id, id), type: 'application/pdf' },
  ]
  for (const u of uploads) {
    if (!existsSync(u.from)) throw new Error(`${u.from} is missing. Run npm run grading:preview -- ${id} again.`)
    const { error: upErr } = await db.storage.from(SUBMISSIONS_BUCKET)
      .upload(u.to, readFileSync(u.from), { contentType: u.type, upsert: true })
    if (upErr) throw new Error(`upload ${u.to}: ${upErr.message}`)
  }

  const { data: saved, error: cErr } = await db.rpc('homework_grade_commit', {
    p_submission: id,
    p_grades: commitRows(grade.rows),
    p_went_well: grade.wentWell,
    p_next_steps: grade.nextSteps,
    p_grader: 'session',
    p_hand_check: grade.handwriting.check,
    p_hand_note: grade.handwriting.note,
    p_marked_pages: check.pageCount,
    p_marks: check.marks,
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
