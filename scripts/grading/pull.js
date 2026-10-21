// npm run grading:pull — fetch every homework submission waiting to be graded
// into grading-inbox/ (git-ignored: it holds students' pages).
//
//   npm run grading:pull                 # every waiting submission not already pulled
//   npm run grading:pull -- --force      # re-pull, overwriting brief + files (never grade.json)
//   npm run grading:pull -- --id=<uuid>  # one submission in ANY state (a regrade):
//                                        # a graded one's grade.json is its saved grade
//   npm run grading:pull -- --id=<uuid> --fresh  # a re-mark: an empty template instead,
//                                        # so the new marking is not anchored to the old
//
// Per submission, grading-inbox/<submission id>/ gets:
//   paper/   the question paper (if any)        key/  the answer key (if any)
//   scans/   the student's files, as handed in   brief.md  what to read and how it's marked
//   pages/   the pages to read: upright, PDFs split into pages (scripts/grading/pages.py)
//   grid/    the same pages under a labelled 0-100 grid, to place marks by
//   reference/  the student's handwriting reference (their first graded homework), if any
//   grade.json  the template to fill — its outcomes start empty, which the checker
//               refuses, so nothing passes unread
//
// Then grade each submission by scripts/grading/GRADING.md and
// run npm run grading:commit -- <id>.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, arg, fail } from './_client.js'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'
import { buildHomeworkBrief, gradeTemplate, savedGradeFile } from '../../src/lib/assignments/brief.js'
import { runPages } from './_marking.js'

async function download(db, bucket, path, to) {
  const { data, error } = await db.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`${bucket}/${path}: ${error?.message ?? 'empty'}`)
  writeFileSync(to, Buffer.from(await data.arrayBuffer()))
}

const pad = i => String(i + 1).padStart(2, '0')
const ext = path => path.split('.').pop()

async function main() {
  const only = arg('id')
  const force = process.argv.includes('--force') || !!only
  const fresh = process.argv.includes('--fresh')
  if (fresh && !only) throw new Error('--fresh needs --id=<uuid>: it replaces that submission\'s grade.json')
  const db = serviceClient()
  mkdirSync(INBOX, { recursive: true })

  let query = db.from('homework_submissions').select('*, homework_grades(*), homework_page_marks(*)')
  query = only ? query.eq('id', only) : query.eq('status', 'submitted').order('submitted_at')
  const { data: queue, error } = await query
  if (error) throw new Error(`queue: ${error.message}`)
  if (only && !queue?.length) throw new Error(`submission ${only} not found`)

  const now = Date.now()
  console.log(`${queue.length} submission(s) ${only ? 'requested' : 'waiting'}.`)
  for (const s of queue) {
    const dir = join(INBOX, s.id)
    const hours = s.submitted_at ? Math.floor((now - Date.parse(s.submitted_at)) / 3_600_000) : 0
    if (existsSync(join(dir, 'brief.md')) && !force) {
      console.log(`  ${s.id}  already pulled  (${hours} h waiting)`)
      continue
    }
    if (s.scans_deleted_at) throw new Error(`${s.id}: its pages were deleted after grading; it cannot be regraded`)

    const { data: a, error: aErr } = await db.from('homework_assignments').select('*').eq('id', s.assignment_id).single()
    if (aErr) throw new Error(`assignment ${s.assignment_id}: ${aErr.message}`)

    // The handwriting reference: the student's first graded homework, unless
    // this IS it (a regrade of the reference has nothing to compare against).
    const { data: ref, error: refErr } = await db
      .from('homework_hand_references')
      .select('submission_id, homework_submissions(files, scans_deleted_at)')
      .eq('lws_id', s.lws_id)
      .maybeSingle()
    if (refErr) throw new Error(`reference for ${s.id}: ${refErr.message}`)
    const refPaths = ref && ref.submission_id !== s.id && !ref.homework_submissions?.scans_deleted_at
      ? ref.homework_submissions?.files ?? []
      : []

    const files = { questions: [], key: [], scans: [], reference: [] }
    for (const [folder, list, bucket, paths] of [
      ['paper', files.questions, ASSIGNMENT_FILES_BUCKET, (a.question_files ?? []).map(f => f.path)],
      ['key', files.key, ASSIGNMENT_FILES_BUCKET, (a.answer_key_files ?? []).map(f => f.path)],
      ['scans', files.scans, SUBMISSIONS_BUCKET, s.files ?? []],
      ['reference', files.reference, SUBMISSIONS_BUCKET, refPaths],
    ]) {
      if (!paths.length) continue
      mkdirSync(join(dir, folder), { recursive: true })
      for (let i = 0; i < paths.length; i++) {
        const rel = `${folder}/${pad(i)}.${ext(paths[i])}`
        await download(db, bucket, paths[i], join(dir, rel))
        list.push(rel)
      }
    }

    // The pages the grader reads and marks. A preview drawn before this pull is
    // stale; grading:commit refuses until a fresh one is drawn.
    rmSync(join(dir, 'preview'), { recursive: true, force: true })
    const prepared = runPages('prepare', dir)
    files.pages = prepared.map(p => `pages/${pad(p.page - 1)}.jpg`)
    files.grid = prepared.map(p => `grid/${pad(p.page - 1)}.jpg`)

    writeFileSync(join(dir, 'brief.md'), buildHomeworkBrief({ submission: s, assignment: a, files }))
    const gradePath = join(dir, 'grade.json')
    const saved = only && !fresh ? savedGradeFile(s) : null
    if (saved) writeFileSync(gradePath, `${JSON.stringify(saved, null, 2)}\n`)
    else if (fresh || !existsSync(gradePath)) writeFileSync(gradePath, `${JSON.stringify(gradeTemplate(s.id, a), null, 2)}\n`)

    const refNote = files.reference.length ? `  reference ${files.reference.length} page(s)` : '  no reference'
    console.log(`  ${s.id}  ${a.title}  ${files.pages.length} page(s)${refNote}  (${hours} h waiting)${saved ? '  [saved grade loaded]' : ''}${fresh ? '  [fresh template: re-mark]' : ''}`)
  }
}

main().catch(fail)
