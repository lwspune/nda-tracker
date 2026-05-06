// Downloads student data from Supabase normalised tables → students_db.json.
// Run before send_results.py / send_results_whatsapp.py when students_db.json may be stale.
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node sync_students_from_supabase.js

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

console.log('Syncing students from Supabase…')

// Load students with their batches in one query
const { data: students, error: sErr } = await supabase
  .from('students')
  .select('*, student_batches(batch_name)')
  .order('lws_id')

if (sErr) { console.error('students select failed:', sErr.message); process.exit(1) }

// Load meta
const { data: meta } = await supabase.from('students_meta').select('*').eq('id', 1).single()

// Reconstruct students_db.json format
const studentRows = students.map(s => {
  const { student_batches, ...rest } = s
  return {
    ...rest,
    batches:    (student_batches || []).map(b => b.batch_name),
    attendance: [],  // attendance not synced back (read-only from Python perspective)
    exams:      [],  // always empty — confirmed dead data
  }
})

const db = {
  version:        meta?.version || 1,
  last_updated:   new Date().toISOString().split('T')[0],
  total_students: students.length,
  exam_tags:      meta?.exam_tags || {},
  rejected_pairs: meta?.rejected_pairs || [],
  students:       studentRows,
}

// Read existing file to preserve attendance and exams fields (not stored in Supabase)
let existing = {}
try {
  existing = JSON.parse(readFileSync('students_db.json', 'utf8'))
} catch { /* fresh sync */ }

const existingByLwsId = Object.fromEntries((existing.students || []).map(s => [s.lws_id, s]))

// Merge: use Supabase data for profile fields, keep local attendance/exams
db.students = studentRows.map(s => ({
  ...s,
  attendance: existingByLwsId[s.lws_id]?.attendance || [],
  exams:      [],
}))

writeFileSync('students_db.json', JSON.stringify(db, null, 2), 'utf8')
console.log(`Done — ${students.length} students synced to students_db.json.`)
