// npm run grading:preview -- <submission id> — draw grade.json's marks onto the
// student's pages, for the grader to LOOK AT before committing.
//
// Writes grading-inbox/<id>/preview/NN.jpg (the pages as the student will see
// them), preview/report.pdf (the marked-paper report the student downloads and
// is emailed) and preview/stamp.json. grading:commit refuses unless the stamp matches
// the current grade.json: change a mark, or a mark's score, and the preview must
// be drawn and looked at again. Read every preview page; move any mark that is
// not where it belongs, then run this again.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, fail } from './_client.js'
import { loadSubmission, checkGradeFile, printErrors, runPages, reportJson } from './_marking.js'

async function main() {
  const id = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!id) throw new Error('Usage: npm run grading:preview -- <submission id>')
  const dir = join(INBOX, id)
  const { s, a, hasReference } = await loadSubmission(serviceClient(), id)

  const check = checkGradeFile({ dir, id, a, hasReference })
  if (!check.ok) { printErrors(check.errors); process.exit(1) }

  const out = join(dir, 'preview')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out)
  writeFileSync(join(out, 'marks.json'), check.payloadJson)
  const drawn = runPages('draw', dir)
  writeFileSync(join(out, 'report.json'), reportJson({ s, a, check }))
  runPages('report', dir)
  writeFileSync(join(out, 'stamp.json'), `${JSON.stringify({ stamp: check.stamp }, null, 2)}\n`)

  console.log(`Drew ${check.marks.length} mark(s) on ${drawn.length} page(s). Read EVERY page before committing:`)
  for (let n = 1; n <= drawn.length; n++) console.log(`  grading-inbox/${id}/preview/${String(n).padStart(2, '0')}.jpg`)
  console.log(`The student's report (summary + these pages): grading-inbox/${id}/preview/report.pdf`)
  console.log('A mark in the wrong place: fix its x/y in grade.json and run this again.')
}

main().catch(fail)
