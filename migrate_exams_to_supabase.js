// Re-runnable migration: faculty-data.json exams[] → Supabase normalised tables.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_exams_to_supabase.js
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_exams_to_supabase.js --cleanup
//
// --cleanup  After verifying seed counts match, removes the stale exams key from
//            the faculty_state JSONB blob. Only runs if seeded count === source count.
//            Do NOT pass --cleanup until you have confirmed the app reads from tables.
//
// Source priority:
//   1. data/faculty-data.json  (if exams.length > 0)
//   2. Supabase faculty_state JSONB  (fallback when local file is empty)
//
// Tables populated:
//   exams        — exam metadata + questions (questions stored as JSONB)
//   exam_results — one row per student per exam (responses stored as JSONB)
//
// Safe to re-run: both tables use upsert (onConflict).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const BATCH = 50

export function buildExamRow(exam) {
  return {
    id:         exam.id,
    name:       exam.name,
    date:       exam.date,
    subject:    exam.subject   || null,
    batch:      exam.batch     || null,
    branch:     exam.branch    || null,
    marking:    exam.marking   ?? { correct: 4, wrong: -1 },
    questions:  exam.questions ?? [],
    created_at: exam.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export function buildResultRows(exam) {
  return (exam.students || []).map(s => ({
    exam_id:       exam.id,
    student_name:  s.name,
    roll_no:       s.rollNo        ?? '',
    total_marks:   s.totalMarks    ?? 0,
    correct:       s.correct       ?? 0,
    incorrect:     s.incorrect     ?? 0,
    not_attempted: s.notAttempted  ?? 0,
    responses:     s.responses     ?? {},
  }))
}

export async function migrateExams(supabase, exams) {
  if (exams.length === 0) return { exams: 0, results: 0 }

  let totalExams = 0
  let totalResults = 0

  for (let i = 0; i < exams.length; i += BATCH) {
    const chunk = exams.slice(i, i + BATCH)
    const examRows = chunk.map(buildExamRow)
    const { error } = await supabase.from('exams').upsert(examRows, { onConflict: 'id' })
    if (error) throw new Error(`exams upsert failed: ${error.message}`)
    totalExams += chunk.length
    process.stdout.write(`  exams: ${totalExams}/${exams.length}\r`)
  }

  for (let i = 0; i < exams.length; i += BATCH) {
    const chunk = exams.slice(i, i + BATCH)
    const resultRows = chunk.flatMap(buildResultRows)
    if (resultRows.length === 0) continue
    const { error } = await supabase
      .from('exam_results')
      .upsert(resultRows, { onConflict: 'exam_id,student_name' })
    if (error) throw new Error(`exam_results upsert failed: ${error.message}`)
    totalResults += resultRows.length
    process.stdout.write(`  results: ${totalResults}\r`)
  }

  return { exams: totalExams, results: totalResults }
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

  // ── Load source exams ───────────────────────────────────────────────────────
  let exams = []
  let source = ''

  try {
    const data = JSON.parse(readFileSync('data/faculty-data.json', 'utf8'))
    if ((data.exams || []).length > 0) {
      exams = data.exams
      source = 'data/faculty-data.json'
    }
  } catch { /* file absent or unreadable — fall through to Supabase */ }

  if (exams.length === 0) {
    console.log('Local file empty or absent — loading exams from Supabase faculty_state…')
    const { data: row, error } = await supabase
      .from('faculty_state').select('data').eq('id', 1).single()
    if (error) {
      console.error('Could not load faculty_state from Supabase:', error.message)
      process.exit(1)
    }
    exams = row?.data?.exams || []
    source = 'Supabase faculty_state JSONB'
  }

  if (exams.length === 0) {
    console.error('Error: 0 exams found in both local file and Supabase JSONB. Aborting — nothing to migrate.')
    process.exit(1)
  }

  console.log(`Source: ${source}`)
  console.log(`Migrating ${exams.length} exams…`)

  const { exams: examCount, results: resultCount } = await migrateExams(supabase, exams)

  // ── Verify seeded counts match source ───────────────────────────────────────
  const { count: seededExams } = await supabase
    .from('exams').select('*', { count: 'exact', head: true })
  const { count: seededResults } = await supabase
    .from('exam_results').select('*', { count: 'exact', head: true })

  const sourceResults = exams.reduce((n, e) => n + (e.students?.length ?? 0), 0)

  console.log(`\nSeeded:  ${examCount} exams, ${resultCount} results`)
  console.log(`Tables:  ${seededExams} exams, ${seededResults} results in Supabase`)

  if (seededExams < exams.length) {
    console.error(`\nVerification FAILED — expected ${exams.length} exams in table, got ${seededExams}. Aborting cleanup.`)
    process.exit(1)
  }

  console.log('\nVerification passed ✓')

  // ── Optional cleanup ────────────────────────────────────────────────────────
  if (runCleanup) {
    // Verify the JSONB still has exams before printing cleanup SQL
    const { data: row } = await supabase
      .from('faculty_state').select('data').eq('id', 1).single()
    if (!(row?.data?.exams)) {
      console.log('faculty_state.data.exams already absent — nothing to clean up.')
    } else {
      console.log('\nVerification passed. Run this in the Supabase SQL editor to remove the stale key:')
      console.log("  UPDATE faculty_state SET data = data - 'exams' WHERE id = 1;")
    }
  } else {
    console.log('\nNext step: once you have confirmed the app is reading from tables correctly,')
    console.log('re-run with --cleanup to get the SQL that removes the stale exams key from faculty_state:')
    console.log('  SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_exams_to_supabase.js --cleanup')
  }
}
