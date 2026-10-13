// npm run grading:hand-compare -- --assignment=<id> — gather page 1 of every
// submission waiting to be graded for one homework, each beside page 1 of that
// student's handwriting reference, into grading-inbox/_hand/<assignment>/.
//
// Run it BEFORE grading a homework that two or more students handed in, in a
// session that does NOT grade: it is how one person writing for two students is
// caught (no reference is needed for that). Files are named by submission id
// only. Findings go into each submission's grade.json `handwriting` when it is
// graded (scripts/grading/GRADING.md).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, arg, fail } from './_client.js'
import { SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'
import { handComparePlan } from '../../src/lib/assignments/handwriting.js'

async function main() {
  const assignmentId = arg('assignment')
  if (!assignmentId) throw new Error('Usage: npm run grading:hand-compare -- --assignment=<homework id>')
  const db = serviceClient()

  const { data: subs, error } = await db
    .from('homework_submissions')
    .select('id, lws_id, files')
    .eq('assignment_id', assignmentId)
    .eq('status', 'submitted')
    .order('submitted_at')
  if (error) throw new Error(`submissions: ${error.message}`)
  if (subs.length < 2) { console.log(`${subs.length} submission(s) waiting: nothing to compare.`); return }

  const { data: refs, error: refErr } = await db
    .from('homework_hand_references')
    .select('lws_id, submission_id, homework_submissions(files, scans_deleted_at)')
    .in('lws_id', subs.map(s => s.lws_id))
  if (refErr) throw new Error(`references: ${refErr.message}`)

  const plan = handComparePlan({
    submissions: subs,
    references: refs.map(r => ({
      lws_id: r.lws_id, submission_id: r.submission_id,
      files: r.homework_submissions?.files ?? [], scans_deleted_at: r.homework_submissions?.scans_deleted_at ?? null,
    })),
  })

  const dir = join(INBOX, '_hand', assignmentId)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const p of plan) {
    const { data, error: dErr } = await db.storage.from(SUBMISSIONS_BUCKET).download(p.path)
    if (dErr || !data) throw new Error(`${p.path}: ${dErr?.message ?? 'empty'}`)
    writeFileSync(join(dir, p.to), Buffer.from(await data.arrayBuffer()))
  }
  writeFileSync(join(dir, 'README.md'), [
    `# Handwriting comparison — homework ${assignmentId}`,
    '',
    'Page 1 of each waiting submission (`<submission>.<ext>`), and of that student\'s reference',
    'beside it where one exists (`<submission>.reference.<ext>`). Do NOT grade here.',
    '',
    'Look for the SAME hand under two submission ids. For each pair found, record a `mismatch` in',
    'both submissions\' grade.json `handwriting` with a note ("Same handwriting as another submission',
    'for this homework.") when grading them.',
    '',
  ].join('\n'))
  console.log(`${subs.length} submission(s), ${plan.length} page(s) → ${dir}`)
}

main().catch(fail)
