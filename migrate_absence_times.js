// Freeze the clock time of historical `lecture_absences` rows.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_absence_times.js [flags]
//
// --dry-run   Fetch + plan but write nothing. Prints the exact per-slot updates.
// --all       Every batch. Default is the four APJ batches being restructured.
//
// WHY: a timetabled absence row stores no time — `buildAbsentRoster` re-derives
// one from the slot row on every render. Retime a slot and every past absence
// filed against it silently re-renders at the new time. Run this BEFORE any
// slot retime so history stays pinned to the time it actually ran at.
//
// Idempotent twice over: the planner skips rows that already carry a time, and
// every UPDATE is guarded `AND start_time IS NULL`. Safe to re-run.

import { createClient } from '@supabase/supabase-js'
import { buildSlotTimeIndex } from './src/lib/absentRoster.js'
import { planAbsenceTimeBackfill } from './src/lib/absenceTimeBackfill.js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')
const ALL_BATCHES  = process.argv.includes('--all')

// The four batches restructured from TT_Prototype_1.
const TARGET_BATCHES = [
  'APJ_NDA_9th_(26-27)',
  'APJ_NDA_10th_(26-27)',
  'APJ_NDA_11th_(26-27)_A',
  'APJ_NDA_11th_(26-27)_B',
]

if (!SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  // ── 1. Timetables → slotId → { startTime, endTime } ─────────────────────
  const { data: stateRow, error: stateErr } = await db
    .from('faculty_state').select('data').eq('id', 1).single()
  if (stateErr) throw stateErr

  const timetables = stateRow?.data?.timetables ?? []
  const scoped = ALL_BATCHES
    ? timetables
    : timetables.filter(t => TARGET_BATCHES.includes(t.batchName))

  if (!scoped.length) {
    console.error('Error: no timetables matched. Batch names may have been renamed.')
    process.exit(1)
  }
  const slotTimes = buildSlotTimeIndex(scoped)
  const slotIds = Object.keys(slotTimes)
  console.log(`Timetables in scope: ${scoped.length} (${slotIds.length} slots)`)
  for (const t of scoped) console.log(`  · ${t.batchName}`)

  // ── 2. Rows still relying on the slot lookup ────────────────────────────
  const { data: rows, error: rowsErr } = await db
    .from('lecture_absences')
    .select('lws_id, date, slot_id, start_time, end_time')
    .in('slot_id', slotIds)
    .is('start_time', null)
  if (rowsErr) throw rowsErr

  console.log(`\nRows relying on the slot lookup: ${rows.length}`)

  const { updates, orphans } = planAbsenceTimeBackfill(
    { rows, slotTimes }, { withReport: true },
  )
  if (orphans.length) {
    console.log(`\n⚠ ${orphans.length} slot id(s) referenced by rows but absent from the timetable:`)
    for (const id of orphans) console.log(`    ${id}`)
    console.log('  These rows keep rendering blank — no time exists to copy.')
  }
  if (!updates.length) {
    console.log('\nNothing to do — every row already carries its own time.')
    return
  }

  // ── 3. Group into one guarded UPDATE per slot ───────────────────────────
  // The drift is per-slot, so a single statement covers every row on it.
  const bySlot = new Map()
  for (const u of updates) {
    if (!bySlot.has(u.slot_id)) {
      bySlot.set(u.slot_id, { start_time: u.start_time, end_time: u.end_time, n: 0 })
    }
    bySlot.get(u.slot_id).n += 1
  }

  console.log(`\n${updates.length} row(s) across ${bySlot.size} slot(s) to freeze:`)
  for (const [slotId, v] of bySlot) {
    console.log(`  ${slotId.padEnd(20)} ${String(v.n).padStart(4)} rows → ${v.start_time} – ${v.end_time}`)
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  let written = 0
  for (const [slotId, v] of bySlot) {
    const { data, error } = await db
      .from('lecture_absences')
      .update({ start_time: v.start_time, end_time: v.end_time })
      .eq('slot_id', slotId)
      .is('start_time', null)   // guard: never re-stamp an already-frozen row
      .select('lws_id')
    if (error) {
      console.error(`  ✗ ${slotId}: ${error.message}`)
      continue
    }
    written += data.length
  }
  console.log(`\n✓ Froze ${written} row(s).`)
}

main().catch(err => {
  console.error('\nMigration failed:', err.message ?? err)
  process.exit(1)
})
