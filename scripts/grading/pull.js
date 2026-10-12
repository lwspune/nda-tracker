// npm run grading:pull — fetch every homework submission waiting to be graded
// into grading-inbox/ (git-ignored: it holds students' pages).
//
//   npm run grading:pull                 # every waiting submission not already pulled
//   npm run grading:pull -- --force      # re-pull, overwriting brief + files (never grade.json)
//   npm run grading:pull -- --id=<uuid>  # one submission in ANY state (a regrade):
//                                        # a graded one's grade.json is its saved grade
//
// Per submission, grading-inbox/<submission id>/ gets:
//   paper/   the question paper (if any)        key/  the answer key (if any)
//   scans/   the student's pages, in order       brief.md  what to read and how it's marked
//   grade.json  the template to fill — its outcomes start empty, which the checker
//               refuses, so nothing passes unread
//
// Then grade ONE submission per fresh session by scripts/grading/GRADING.md and
// run npm run grading:commit -- <id>.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, arg, fail } from './_client.js'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'
import { buildHomeworkBrief, gradeTemplate, savedGradeFile } from '../../src/lib/assignments/brief.js'

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
  const db = serviceClient()
  mkdirSync(INBOX, { recursive: true })

  let query = db.from('homework_submissions').select('*, homework_grades(*)')
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

    const files = { questions: [], key: [], scans: [] }
    for (const [folder, list, bucket, paths] of [
      ['paper', files.questions, ASSIGNMENT_FILES_BUCKET, (a.question_files ?? []).map(f => f.path)],
      ['key', files.key, ASSIGNMENT_FILES_BUCKET, (a.answer_key_files ?? []).map(f => f.path)],
      ['scans', files.scans, SUBMISSIONS_BUCKET, s.files ?? []],
    ]) {
      if (!paths.length) continue
      mkdirSync(join(dir, folder), { recursive: true })
      for (let i = 0; i < paths.length; i++) {
        const rel = `${folder}/${pad(i)}.${ext(paths[i])}`
        await download(db, bucket, paths[i], join(dir, rel))
        list.push(rel)
      }
    }

    writeFileSync(join(dir, 'brief.md'), buildHomeworkBrief({ submission: s, assignment: a, files }))
    const gradePath = join(dir, 'grade.json')
    const saved = only ? savedGradeFile(s) : null
    if (saved) writeFileSync(gradePath, `${JSON.stringify(saved, null, 2)}\n`)
    else if (!existsSync(gradePath)) writeFileSync(gradePath, `${JSON.stringify(gradeTemplate(s.id, a), null, 2)}\n`)

    console.log(`  ${s.id}  ${a.title}  ${files.scans.length} page(s)  (${hours} h waiting)${saved ? '  [saved grade loaded]' : ''}`)
  }
}

main().catch(fail)
