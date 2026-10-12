// npm run grading:purge — delete students' pages 30 days after grading. The
// grade stays. Also clears uploads abandoned for 2+ days (started, never sent)
// and the local grading-inbox/<id>/ copy of every purged submission.
//
//   npm run grading:purge             # DRY RUN: what would go
//   npm run grading:purge -- --apply  # delete
//
// Idempotent: a purged submission carries scans_deleted_at and is skipped.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient, INBOX, fail } from './_client.js'
import { SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'

const KEEP_DAYS = 30
const ABANDONED_DAYS = 2
const DAY = 86_400_000

async function removeFiles(db, paths) {
  if (!paths?.length) return 0
  const { error } = await db.storage.from(SUBMISSIONS_BUCKET).remove(paths)
  if (error) throw new Error(`remove: ${error.message}`)
  return paths.length
}

async function main() {
  const apply = process.argv.includes('--apply')
  const db = serviceClient()
  const keepCutoff = new Date(Date.now() - KEEP_DAYS * DAY).toISOString()
  const abandonedCutoff = new Date(Date.now() - ABANDONED_DAYS * DAY).toISOString()

  const { data: done, error } = await db
    .from('homework_submissions')
    .select('id, files')
    .in('status', ['graded', 'rejected'])
    .is('scans_deleted_at', null)
    .lt('graded_at', keepCutoff)
    .limit(1000)
  if (error) throw new Error(error.message)
  const { data: abandoned, error: abErr } = await db
    .from('homework_submissions')
    .select('id, files')
    .eq('status', 'uploading')
    .lt('created_at', abandonedCutoff)
    .limit(1000)
  if (abErr) throw new Error(abErr.message)

  console.log(`${done.length} graded submission(s) past ${KEEP_DAYS} days; ${abandoned.length} abandoned upload(s).`)
  if (!apply) { console.log('Dry run. Add -- --apply to delete.'); return }

  for (const s of done) {
    const n = await removeFiles(db, s.files)
    const { error: upErr } = await db.from('homework_submissions')
      .update({ scans_deleted_at: new Date().toISOString() }).eq('id', s.id)
    if (upErr) throw new Error(upErr.message)
    const local = join(INBOX, s.id)
    if (existsSync(local)) rmSync(local, { recursive: true, force: true })
    console.log(`  ${s.id}: ${n} page(s) deleted`)
  }
  for (const s of abandoned) {
    await removeFiles(db, s.files)
    const { error: delErr } = await db.from('homework_submissions').delete().eq('id', s.id).eq('status', 'uploading')
    if (delErr) throw new Error(delErr.message)
    console.log(`  ${s.id}: abandoned upload removed`)
  }
}

main().catch(fail)
