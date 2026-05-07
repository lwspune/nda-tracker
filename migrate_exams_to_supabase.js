// Re-runnable migration: faculty-data.json exams[] → Supabase normalised tables.
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_exams_to_supabase.js
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

  let data
  try {
    data = JSON.parse(readFileSync('data/faculty-data.json', 'utf8'))
  } catch (e) {
    console.error('Could not read data/faculty-data.json:', e.message)
    process.exit(1)
  }

  const exams = data.exams || []
  console.log(`Migrating ${exams.length} exams…`)

  const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

  const { exams: examCount, results: resultCount } = await migrateExams(supabase, exams)
  console.log(`\nDone — ${examCount} exams, ${resultCount} student results migrated to Supabase.`)
}
