// One-time (and re-runnable) migration: students_db.json → Supabase normalised tables.
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_students_to_supabase.js
//
// Tables populated:
//   students           — core profile fields
//   student_batches    — many-to-many batch memberships
//   student_attendance — per-student attendance records
//   students_meta      — top-level metadata (exam_tags, rejected_pairs)
//
// students_db.exams[] is intentionally dropped — confirmed dead data (nothing reads it).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  process.exit(1)
}

let db
try {
  db = JSON.parse(readFileSync('students_db.json', 'utf8'))
} catch (e) {
  console.error('Could not read students_db.json:', e.message)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

const { students, version, last_updated, total_students, exam_tags, rejected_pairs } = db

console.log(`Migrating ${students.length} students…`)

// ── 1. Upsert students ────────────────────────────────────────────────────────
const studentRows = students.map(s => ({
  lws_id:            s.lws_id,
  canonical_name:    s.canonical_name || s.name || '',
  mobile:            s.mobile || '',
  dob:               s.dob || '',
  gender:            s.gender || '',
  email:             s.email || '',
  eis_reg_no:        s.eis_reg_no || '',
  registration_date: s.registration_date || '',
  branch:            s.branch || '',
  account_status:    s.account_status || '',
  coming_status:     s.coming_status || '',
  quit_date:         s.quit_date || '',
  name_variants:     s.name_variants || [],
  evalbee_roll_nos:  s.evalbee_roll_nos || [],
  match_signatures:  s.match_signatures || [],
  parent_mobiles:    s.parent_mobiles || [],
  fees:              s.fees || {},
  updated_at:        new Date().toISOString(),
}))

// Upsert in batches of 100 to avoid request size limits
const BATCH = 100
for (let i = 0; i < studentRows.length; i += BATCH) {
  const chunk = studentRows.slice(i, i + BATCH)
  const { error } = await supabase.from('students').upsert(chunk, { onConflict: 'lws_id' })
  if (error) { console.error('students upsert failed:', error.message); process.exit(1) }
  process.stdout.write(`  students: ${Math.min(i + BATCH, studentRows.length)}/${studentRows.length}\r`)
}
console.log('\n  students: done')

// ── 2. Replace student_batches ────────────────────────────────────────────────
// Delete all then insert fresh — simpler than diffing.
const { error: delErr } = await supabase.from('student_batches').delete().neq('lws_id', '')
if (delErr) { console.error('student_batches delete failed:', delErr.message); process.exit(1) }

const batchRows = students.flatMap(s =>
  (s.batches || []).map(batch_name => ({ lws_id: s.lws_id, batch_name }))
)
for (let i = 0; i < batchRows.length; i += BATCH) {
  const chunk = batchRows.slice(i, i + BATCH)
  const { error } = await supabase.from('student_batches').insert(chunk)
  if (error) { console.error('student_batches insert failed:', error.message); process.exit(1) }
}
console.log(`  student_batches: ${batchRows.length} rows`)

// ── 3. Replace student_attendance ─────────────────────────────────────────────
const { error: delAttErr } = await supabase.from('student_attendance').delete().neq('lws_id', '')
if (delAttErr) { console.error('student_attendance delete failed:', delAttErr.message); process.exit(1) }

const attendanceRows = students.flatMap(s =>
  (s.attendance || []).map(a => ({
    lws_id:     s.lws_id,
    date:       a.date || '',
    batch:      a.batch || '',
    status:     a.status || '',
    eis_reg_no: a.eis_reg_no || '',
  }))
)
for (let i = 0; i < attendanceRows.length; i += BATCH) {
  const chunk = attendanceRows.slice(i, i + BATCH)
  const { error } = await supabase.from('student_attendance').insert(chunk)
  if (error) { console.error('student_attendance insert failed:', error.message); process.exit(1) }
  process.stdout.write(`  attendance: ${Math.min(i + BATCH, attendanceRows.length)}/${attendanceRows.length}\r`)
}
console.log(`\n  attendance: ${attendanceRows.length} rows`)

// ── 4. Upsert students_meta ───────────────────────────────────────────────────
const { error: metaErr } = await supabase.from('students_meta').upsert({
  id: 1,
  version:        version || 1,
  last_updated:   last_updated || '',
  total_students: total_students || students.length,
  exam_tags:      exam_tags || {},
  rejected_pairs: rejected_pairs || [],
}, { onConflict: 'id' })
if (metaErr) { console.error('students_meta upsert failed:', metaErr.message); process.exit(1) }
console.log('  students_meta: done')

console.log(`\nDone — ${students.length} students migrated to Supabase.`)
