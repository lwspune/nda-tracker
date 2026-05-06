// One-time migration: seeds data/faculty-data.json → Supabase faculty_state table.
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_to_supabase.js

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  console.error('Get it from: Supabase dashboard → Project Settings → API → service_role key')
  process.exit(1)
}

let data
try {
  data = JSON.parse(readFileSync('data/faculty-data.json', 'utf8'))
} catch (e) {
  console.error('Could not read data/faculty-data.json:', e.message)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, key, {
  auth: { persistSession: false },
})

const { error } = await supabase
  .from('faculty_state')
  .update({ data, updated_at: new Date().toISOString() })
  .eq('id', 1)

if (error) {
  console.error('Migration failed:', error.message)
  process.exit(1)
}

console.log('Done — faculty-data.json seeded into Supabase faculty_state.')
