// npm run grading:best -- <homework id or exact title> — the best answer to each
// question of a homework, for staff to share with the class (2026-10-24).
// Runbook: scripts/grading/BEST_ANSWERS.md.
//
//   npm run grading:best -- <homework>            # shortlist + pages + best.json template
//   npm run grading:best -- <homework> --preview  # check best.json, crop, build the PDF to LOOK AT
//   npm run grading:best -- <homework> --commit   # upload the previewed PDF (staff see it at once)
//
// grading-inbox/_best/<homework id>/ (git-ignored; pull's tidy skips _ folders):
//   pages/<submission>/NN.jpg  each shortlisted hand-in's marked pages (as the student sees them)
//   grid/<submission>/NN.jpg   the same under a labelled 0-100 grid, to read crop boxes off
//   shortlist.md               per question: the candidates and their files
//   best.json                  the picks to fill (never overwritten once it exists)
//   preview/                   crops, payload.json, best-answers.pdf, stamp.json
//
// Every mode re-reads the homework from the database and rebuilds the
// shortlist, so a regrade since the pull is checked against, never missed.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, fail } from './_client.js'
import { runPages, sha256 } from './_marking.js'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'
import { mapAssignmentRow, mapSubmissionRow } from '../../src/lib/assignments/editor.js'
import { fmtDate } from '../../src/lib/dates.js'
import {
  bestAnswersBlockers, shortlistBestAnswers, validateBestFile, bestFileTemplate, bestAnswersPdfPath,
} from '../../src/lib/assignments/bestAnswers.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pageFile = (sid, page) => `pages/${sid}/${String(page).padStart(2, '0')}.jpg`
const gridFile = (sid, page) => `grid/${sid}/${String(page).padStart(2, '0')}.jpg`

async function loadHomework(db, ref) {
  let q = db.from('homework_assignments').select('*')
  q = UUID.test(ref) ? q.eq('id', ref) : q.eq('title', ref)
  const { data, error } = await q
  if (error) throw new Error(`homework: ${error.message}`)
  if (!data?.length) throw new Error(`No homework ${UUID.test(ref) ? 'with id' : 'titled'} "${ref}".`)
  if (data.length > 1) throw new Error(`${data.length} homeworks are titled "${ref}": use the id (${data.map(a => a.id).join(', ')}).`)
  const assignment = mapAssignmentRow(data[0])

  const { data: rows, error: sErr } = await db.from('homework_submissions').select('*, homework_grades(*)').eq('assignment_id', assignment.id)
  if (sErr) throw new Error(`submissions: ${sErr.message}`)
  const subs = rows.filter(r => r.status !== 'replaced').map(mapSubmissionRow)

  const graded = subs.filter(s => s.status === 'graded').map(s => s.id)
  const { data: marks, error: mErr } = graded.length
    ? await db.from('homework_page_marks').select('submission_id, label, page').in('submission_id', graded)
    : { data: [], error: null }
  if (mErr) throw new Error(`page marks: ${mErr.message}`)
  const pageMarks = marks.map(m => ({ submissionId: m.submission_id, label: m.label, page: m.page }))

  return { assignment, subs, shortlist: shortlistBestAnswers(assignment.questions, subs, pageMarks) }
}

async function download(db, path, to) {
  const { data, error } = await db.storage.from(SUBMISSIONS_BUCKET).download(path)
  if (error || !data) throw new Error(`${path}: ${error?.message ?? 'empty'}`)
  writeFileSync(to, Buffer.from(await data.arrayBuffer()))
}

function shortlistMd(assignment, shortlist) {
  const out = [`# Best answers: ${assignment.title}`, '',
    'For each question, read every candidate on its grid page and pick the best for accuracy, thoroughness and',
    'presentation (scripts/grading/BEST_ANSWERS.md). Pages marked * carry this question\'s marks.', '']
  for (const q of shortlist) {
    const what = { full: 'full marks, nothing missing', best_attempt: 'nobody got full marks: the highest mark', none: 'nobody scored' }[q.kind]
    out.push(`## ${q.label} (${q.max} marks): ${what}`)
    for (const c of q.candidates) {
      const pages = Array.from({ length: c.pageCount }, (_, i) => i + 1)
        .map(p => `${gridFile(c.submissionId, p)}${c.pages.includes(p) ? ' *' : ''}`)
      out.push(`- ${c.studentName} · ${c.awarded}/${q.max}${c.missing ? ` · missing: ${c.missing}` : ''}`)
      out.push(`  submissionId ${c.submissionId}`)
      out.push(`  ${pages.join('  ')}`)
    }
    out.push('')
  }
  return out.join('\n')
}

async function pull(db, dir, { assignment, subs, shortlist }) {
  const blockers = bestAnswersBlockers(assignment, subs)
  if (blockers.length) throw new Error(blockers.join('\n'))

  const wanted = new Map()
  for (const q of shortlist) for (const c of q.candidates) wanted.set(c.submissionId, c.pageCount)
  const byId = new Map(subs.map(s => [s.id, s]))
  for (const [sid, count] of wanted) {
    mkdirSync(join(dir, 'pages', sid), { recursive: true })
    for (let p = 1; p <= count; p++) await download(db, byId.get(sid).markedPages[p - 1], join(dir, pageFile(sid, p)))
  }
  rmSync(join(dir, 'grid'), { recursive: true, force: true })
  const grids = wanted.size ? runPages('best-grid', dir) : 0

  writeFileSync(join(dir, 'shortlist.md'), shortlistMd(assignment, shortlist))
  const bestPath = join(dir, 'best.json')
  if (!existsSync(bestPath)) writeFileSync(bestPath, `${JSON.stringify(bestFileTemplate(assignment.id, shortlist), null, 2)}\n`)

  const kinds = k => shortlist.filter(q => q.kind === k).length
  console.log(`${assignment.title}: ${shortlist.length} question(s) · ${kinds('full')} with full-mark answers · ${kinds('best_attempt')} best attempt only · ${kinds('none')} with no answer`)
  console.log(`${wanted.size} hand-in(s), ${grids} page(s) downloaded to grading-inbox/_best/${assignment.id}/`)
  console.log(`Read shortlist.md, fill best.json, then: npm run grading:best -- ${assignment.id} --preview`)
}

function check(dir, { assignment, shortlist }) {
  const bestPath = join(dir, 'best.json')
  if (!existsSync(bestPath)) throw new Error(`No best.json. Run npm run grading:best -- ${assignment.id} first.`)
  const r = validateBestFile(JSON.parse(readFileSync(bestPath, 'utf8')), { assignmentId: assignment.id, shortlist })
  if (!r.ok) {
    console.error(`best.json has ${r.errors.length} problem(s):`)
    for (const e of r.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const payload = {
    title: assignment.title,
    subtitle: `${assignment.subject} · ${assignment.batchNames.join(', ')} · due ${fmtDate(assignment.dueAt.slice(0, 10))}`,
    picks: r.picks.map(p => ({ ...p, crops: p.crops.map(c => ({ image: pageFile(p.submissionId, c.page), x: c.x, y: c.y, w: c.w, h: c.h })) })),
  }
  for (const p of payload.picks) for (const c of p.crops) {
    if (!existsSync(join(dir, c.image))) throw new Error(`${p.label}: ${c.image} is not downloaded. Run npm run grading:best -- ${assignment.id} again.`)
  }
  const payloadJson = JSON.stringify(payload)
  return { payloadJson, stamp: sha256(payloadJson) }
}

async function preview(dir, loaded) {
  const { payloadJson, stamp } = check(dir, loaded)
  const out = join(dir, 'preview')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out)
  writeFileSync(join(out, 'payload.json'), payloadJson)
  const built = runPages('best', dir)
  writeFileSync(join(out, 'stamp.json'), `${JSON.stringify({ stamp }, null, 2)}\n`)
  console.log('LOOK AT every crop (is the whole answer in it, and nothing else?), then the PDF:')
  for (const c of built.crops) console.log(`  grading-inbox/_best/${loaded.assignment.id}/${c}`)
  console.log(`  grading-inbox/_best/${loaded.assignment.id}/preview/best-answers.pdf`)
  console.log(`Then: npm run grading:best -- ${loaded.assignment.id} --commit`)
}

async function commit(db, dir, loaded) {
  const { stamp } = check(dir, loaded)
  const stampPath = join(dir, 'preview', 'stamp.json')
  const previewed = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')).stamp : null
  if (previewed !== stamp) throw new Error(`best.json (or a grade) changed since the preview. Run npm run grading:best -- ${loaded.assignment.id} --preview and look again.`)
  const pdf = readFileSync(join(dir, 'preview', 'best-answers.pdf'))
  const path = bestAnswersPdfPath(loaded.assignment.id)
  const { error } = await db.storage.from(ASSIGNMENT_FILES_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`upload: ${error.message}`)
  console.log(`Saved ${ASSIGNMENT_FILES_BUCKET}/${path} (${(pdf.length / 1048576).toFixed(1)} MB). Staff see "Best answers (PDF)" on the homework's Submissions screen.`)
}

async function main() {
  const ref = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!ref) throw new Error('Usage: npm run grading:best -- <homework id or exact title> [--preview | --commit]')
  const db = serviceClient()
  const loaded = await loadHomework(db, ref)
  const dir = join(INBOX, '_best', loaded.assignment.id)
  mkdirSync(dir, { recursive: true })
  if (process.argv.includes('--commit')) return commit(db, dir, loaded)
  if (process.argv.includes('--preview')) return preview(dir, loaded)
  return pull(db, dir, loaded)
}

main().catch(fail)
