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
// A full pull (no --id) also:
//   - clears inbox folders whose submission is already graded, held, rejected
//     or replaced, and hand-compare packs with nothing left waiting (GRADING.md
//     routine step 9). Waiting folders, and folders the database does not
//     know, are never removed.
//   - writes grading-inbox/_queue.json: the waiting submissions grouped by
//     homework, each homework's fingerprint (paper, key, marks), and the order
//     one student's hand-ins must be graded in. Names no student.
//
// Then grade each submission by scripts/grading/GRADING.md and
// run npm run grading:commit -- <id>.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, arg, fail } from './_client.js'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'
import { buildHomeworkBrief, gradeTemplate, savedGradeFile } from '../../src/lib/assignments/brief.js'
import { buildGradingQueue, homeworkFingerprint, planTidy } from '../../src/lib/assignments/gradingQueue.js'
import { runPages } from './_marking.js'

async function download(db, bucket, path, to) {
  const { data, error } = await db.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`${bucket}/${path}: ${error?.message ?? 'empty'}`)
  writeFileSync(to, Buffer.from(await data.arrayBuffer()))
}

const pad = i => String(i + 1).padStart(2, '0')
const ext = path => path.split('.').pop()
const sha = buf => createHash('sha256').update(buf).digest('hex')
const listDir = dir => (existsSync(dir) ? readdirSync(dir).sort() : [])
const hashes = dir => listDir(dir).map(f => sha(readFileSync(join(dir, f))))

function sizeOf(path) {
  const st = statSync(path)
  if (!st.isDirectory()) return st.size
  return readdirSync(path).reduce((n, f) => n + sizeOf(join(path, f)), 0)
}

// Routine step 9, done for the grader: clear what is already in the database.
async function tidy(db, waitingHomeworks) {
  const folders = listDir(INBOX).filter(f => !f.startsWith('_') && statSync(join(INBOX, f)).isDirectory())
  const statusById = {}
  for (let i = 0; i < folders.length; i += 100) {
    const { data, error } = await db.from('homework_submissions').select('id, status').in('id', folders.slice(i, i + 100))
    if (error) throw new Error(`tidy: ${error.message}`)
    for (const r of data) statusById[r.id] = r.status
  }
  const handFolders = listDir(join(INBOX, '_hand'))
  const plan = planTidy({ folders, statusById, handFolders, waitingHomeworks })
  const doomed = [...plan.remove.map(f => join(INBOX, f)), ...plan.removeHand.map(h => join(INBOX, '_hand', h))]
  const freed = doomed.reduce((n, p) => n + sizeOf(p), 0)
  for (const p of doomed) rmSync(p, { recursive: true, force: true })
  if (doomed.length) console.log(`Cleared ${plan.remove.length} finished folder(s), ${plan.removeHand.length} hand-compare pack(s): ${(freed / 1048576).toFixed(1)} MB freed.`)
  for (const f of plan.unknown) console.log(`  ${f}  not in the database: left alone, check it by hand`)
}

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

  if (!only) await tidy(db, [...new Set(queue.map(s => s.assignment_id))])

  const assignments = new Map()
  const assignmentFor = async id => {
    if (!assignments.has(id)) {
      const { data, error: aErr } = await db.from('homework_assignments').select('*').eq('id', id).single()
      if (aErr) throw new Error(`assignment ${id}: ${aErr.message}`)
      assignments.set(id, data)
    }
    return assignments.get(id)
  }
  const entries = []
  const queueEntry = (s, a, dir) => entries.push({
    submissionId: s.id, homeworkId: a.id, title: a.title,
    studentKey: sha(String(s.lws_id)).slice(0, 12),
    dueAt: a.due_at, submittedAt: s.submitted_at,
    pages: listDir(join(dir, 'pages')).length,
    hasReference: listDir(join(dir, 'reference')).length > 0,
    maxMarks: a.max_marks == null ? null : Number(a.max_marks),
    breakdown: (a.questions ?? []).map(q => ({ label: q.label, marks: Number(q.marks) })),
    fingerprint: homeworkFingerprint({ assignment: a, paperHashes: hashes(join(dir, 'paper')), keyHashes: hashes(join(dir, 'key')) }),
  })

  const now = Date.now()
  console.log(`${queue.length} submission(s) ${only ? 'requested' : 'waiting'}.`)
  for (const s of queue) {
    const dir = join(INBOX, s.id)
    const hours = s.submitted_at ? Math.floor((now - Date.parse(s.submitted_at)) / 3_600_000) : 0
    if (existsSync(join(dir, 'brief.md')) && !force) {
      console.log(`  ${s.id}  already pulled  (${hours} h waiting)`)
      queueEntry(s, await assignmentFor(s.assignment_id), dir)
      continue
    }
    if (s.scans_deleted_at) throw new Error(`${s.id}: its pages were deleted after grading; it cannot be regraded`)

    const a = await assignmentFor(s.assignment_id)

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
    queueEntry(s, a, dir)
  }

  // A pull of one submission (--id) is a regrade outside the run: the queue
  // describes waiting work only, so it is left as it was.
  if (only) return
  const q = buildGradingQueue(entries)
  writeFileSync(join(INBOX, '_queue.json'), `${JSON.stringify(q, null, 2)}
`)
  console.log(`Queue: ${q.homeworks.length} homework(s) -> grading-inbox/_queue.json`)
  for (const h of q.homeworks.filter(x => x.fingerprintConflict)) {
    console.log(`  ${h.homeworkId}  ${h.title}: pulled folders hold DIFFERENT papers or keys. Re-pull with --force before grading.`)
  }
}

main().catch(fail)
