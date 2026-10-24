// npm run grading:scheme -- <homework id>          start (or restart) the marking scheme
// npm run grading:scheme -- <homework id> --check  is it fit to grade from?
//
// One marking scheme per homework, written once and graded against by every
// submission of it: grading-inbox/_scheme/<homework id>/scheme.md. It is
// stamped with the homework's fingerprint (paper, key, marks, description) from
// grading-inbox/_queue.json, so a changed paper makes it stale rather than
// silently wrong. Run grading:pull first. Reads no database: the queue holds
// everything it needs.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { INBOX, fail } from './_client.js'
import { checkScheme, schemeStatus, schemeTemplate } from '../../src/lib/assignments/gradingQueue.js'

function main() {
  const homeworkId = process.argv.slice(2).find(a => !a.startsWith('--'))
  const check = process.argv.includes('--check')
  if (!homeworkId) throw new Error('Usage: npm run grading:scheme -- <homework id> [--check]')

  const queuePath = join(INBOX, '_queue.json')
  if (!existsSync(queuePath)) throw new Error('No grading-inbox/_queue.json: run npm run grading:pull first.')
  const queue = JSON.parse(readFileSync(queuePath, 'utf8'))
  const homework = queue.homeworks.find(h => h.homeworkId === homeworkId)
  if (!homework) throw new Error(`Homework ${homeworkId} has nothing waiting in the queue.`)
  if (homework.fingerprintConflict) {
    throw new Error(`${homework.title}: its pulled folders hold different papers or keys. Re-pull with --force first.`)
  }

  const dir = join(INBOX, '_scheme', homeworkId)
  const path = join(dir, 'scheme.md')
  const text = existsSync(path) ? readFileSync(path, 'utf8') : null

  if (check) {
    const r = checkScheme(text, homework)
    if (r.ok) { console.log(`${homework.title}: scheme is current and complete.`); return }
    console.log(`${homework.title}: scheme is NOT ready.`)
    for (const p of r.problems) console.log(`  - ${p}`)
    process.exit(1)
  }

  const status = schemeStatus(text, homework.fingerprint)
  if (status === 'current') {
    console.log(`${homework.title}: scheme already current: ${path}`)
  } else {
    mkdirSync(dir, { recursive: true })
    // A stale scheme is kept beside the new one: most of it may still hold.
    if (status === 'stale') renameSync(path, join(dir, 'scheme.stale.md'))
    writeFileSync(path, schemeTemplate(homework))
    console.log(`${homework.title}: ${status === 'stale' ? 'paper, key or marks changed; old scheme kept as scheme.stale.md. ' : ''}template written: ${path}`)
  }
  // The paper and key, from the first pulled submission (all agree: no conflict).
  const source = join(INBOX, homework.submissions[0])
  console.log(`Write it from ${join(source, 'brief.md')} and that folder's paper/ and key/.`)
}

try { main() } catch (e) { fail(e) }
