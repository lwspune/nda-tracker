// Re-runnable migration: faculty-data.json savedInsights → Supabase normalised tables.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_insights_to_supabase.js
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_insights_to_supabase.js --cleanup
//
// --cleanup  After verifying the app reads from class_reports/student_plans, prints
//            the SQL to drop savedInsights from faculty_state.data.
//            Do NOT pass --cleanup until you have confirmed the app works.
//
// Source priority:
//   1. data/faculty-data.json  (if savedInsights present)
//   2. Supabase faculty_state JSONB  (fallback when local file is empty)
//
// Tables populated:
//   class_reports  — one row per (legacy) class report. Preserves original generatedAt.
//   student_plans  — one row per student plan. lws_id resolved from students_db.json by canonical name.
//
// Safe to re-run: both tables have unique constraints — duplicate inserts are skipped.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const GENERATED_BY = 'legacy-import'

// Builds a name → lws_id lookup from students_db.json (canonical name + every name variant).
export function buildNameLookup(studentsDb) {
  const map = new Map()
  for (const s of studentsDb.students ?? []) {
    if (!s.lws_id) continue
    if (s.canonical_name) map.set(s.canonical_name, s.lws_id)
    for (const v of s.name_variants ?? []) map.set(v, s.lws_id)
  }
  return map
}

// Inserts a single row; treats "duplicate key" (unique constraint) as a no-op.
async function safeInsert(supabase, table, row) {
  const { error } = await supabase.from(table).insert(row)
  if (error) {
    if (error.code === '23505') return 'skipped'  // unique_violation — already migrated
    throw new Error(`${table} insert failed: ${error.message}`)
  }
  return 'inserted'
}

export async function migrateInsights(supabase, savedInsights, nameLookup) {
  const result = { classReportInserted: 0, classReportSkipped: 0, plansInserted: 0, plansSkipped: 0, unresolved: [] }

  if (savedInsights.classReport?.text) {
    const status = await safeInsert(supabase, 'class_reports', {
      text: savedInsights.classReport.text,
      generated_at: savedInsights.classReport.generatedAt ?? new Date().toISOString(),
      generated_by: GENERATED_BY,
      exam_id: null,
    })
    if (status === 'inserted') result.classReportInserted++
    else                       result.classReportSkipped++
  }

  for (const [name, plan] of Object.entries(savedInsights.studentPlans ?? {})) {
    if (!plan?.text) continue
    const lwsId = nameLookup.get(name) ?? null
    if (!lwsId) result.unresolved.push(name)

    const status = await safeInsert(supabase, 'student_plans', {
      student_name: name,
      text: plan.text,
      generated_at: plan.generatedAt ?? new Date().toISOString(),
      generated_by: GENERATED_BY,
      lws_id: lwsId,
    })
    if (status === 'inserted') result.plansInserted++
    else                       result.plansSkipped++
  }

  return result
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
    process.exit(1)
  }

  const runCleanup = process.argv.includes('--cleanup')
  const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

  // ── Load source insights ────────────────────────────────────────────────────
  let savedInsights = null
  let source = ''

  try {
    const data = JSON.parse(readFileSync('data/faculty-data.json', 'utf8'))
    if (data.savedInsights && (data.savedInsights.classReport || Object.keys(data.savedInsights.studentPlans ?? {}).length)) {
      savedInsights = data.savedInsights
      source = 'data/faculty-data.json'
    }
  } catch { /* file absent or unreadable — fall through to Supabase */ }

  if (!savedInsights) {
    console.log('Local file empty or no insights — loading from Supabase faculty_state…')
    const { data: row, error } = await supabase
      .from('faculty_state').select('data').eq('id', 1).single()
    if (error) {
      console.error('Could not load faculty_state from Supabase:', error.message)
      process.exit(1)
    }
    savedInsights = row?.data?.savedInsights ?? null
    source = 'Supabase faculty_state JSONB'
  }

  if (!savedInsights || (!savedInsights.classReport && !Object.keys(savedInsights.studentPlans ?? {}).length)) {
    console.log('No insights found in source. Nothing to migrate.')
    process.exit(0)
  }

  // ── Build name → lws_id lookup ──────────────────────────────────────────────
  let nameLookup = new Map()
  try {
    const studentsDb = JSON.parse(readFileSync('students_db.json', 'utf8'))
    nameLookup = buildNameLookup(studentsDb)
    console.log(`Name lookup: ${nameLookup.size} entries from students_db.json`)
  } catch (e) {
    console.warn(`Warning: could not load students_db.json — all plans will have lws_id=null. (${e.message})`)
  }

  console.log(`Source: ${source}`)
  const planCount = Object.keys(savedInsights.studentPlans ?? {}).length
  console.log(`Migrating: ${savedInsights.classReport ? 1 : 0} class report + ${planCount} student plans`)

  const result = await migrateInsights(supabase, savedInsights, nameLookup)

  console.log(`\nResult:`)
  console.log(`  class_reports: ${result.classReportInserted} inserted, ${result.classReportSkipped} skipped (already present)`)
  console.log(`  student_plans: ${result.plansInserted} inserted, ${result.plansSkipped} skipped (already present)`)

  if (result.unresolved.length > 0) {
    console.log(`\nNames not matched to an lws_id (lws_id=null in DB — fix by adding name variants in students_db.json):`)
    for (const n of result.unresolved) console.log(`  - ${n}`)
  }

  // ── Verify row counts in DB ─────────────────────────────────────────────────
  const { count: reportRows } = await supabase
    .from('class_reports').select('*', { count: 'exact', head: true })
  const { count: planRows } = await supabase
    .from('student_plans').select('*', { count: 'exact', head: true })
  console.log(`\nIn DB: ${reportRows} class_reports, ${planRows} student_plans rows total (across all history).`)

  // ── Optional cleanup ────────────────────────────────────────────────────────
  if (runCleanup) {
    const { data: row } = await supabase
      .from('faculty_state').select('data').eq('id', 1).single()
    if (!(row?.data?.savedInsights)) {
      console.log('\nfaculty_state.data.savedInsights already absent — nothing to clean up.')
    } else {
      console.log('\nVerification passed. Run this in the Supabase SQL editor to remove the stale key:')
      console.log("  UPDATE faculty_state SET data = data - 'savedInsights' WHERE id = 1;")
    }
  } else {
    console.log('\nNext step: once you have confirmed the Insights page reads from tables correctly,')
    console.log('re-run with --cleanup to get the SQL that removes the stale savedInsights key from faculty_state:')
    console.log('  SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_insights_to_supabase.js --cleanup')
  }
}
