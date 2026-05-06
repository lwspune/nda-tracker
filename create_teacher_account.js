/**
 * create_teacher_account.js
 *
 * Creates (or updates) a Supabase teacher account with role='teacher' in user_metadata.
 * Run once per teacher. Re-running with the same email updates the password.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node create_teacher_account.js <email> <password>
 *
 * Example:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node create_teacher_account.js teacher@lwspune.com pass123
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf-8')
        .split('\n')
        .map(l => l.match(/^([A-Z_]+)=(.*)/))
        .filter(Boolean)
        .map(m => [m[1], m[2].trim()])
    )
  } catch { return {} }
}

const [,, email, password] = process.argv
if (!email || !password) {
  console.error('Usage: node create_teacher_account.js <email> <password>')
  process.exit(1)
}

const env = readEnvLocal()
const supabaseUrl  = env.VITE_SUPABASE_URL          || process.env.VITE_SUPABASE_URL          || ''
const serviceKey   = env.SUPABASE_SERVICE_ROLE_KEY   || process.env.SUPABASE_SERVICE_ROLE_KEY   || ''

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Check if user already exists
const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers()
if (listErr) { console.error('Failed to list users:', listErr.message); process.exit(1) }

const existing = users.find(u => u.email === email)

if (existing) {
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    user_metadata: { role: 'teacher' },
  })
  if (error) { console.error('Update failed:', error.message); process.exit(1) }
  console.log(`Updated teacher account: ${email} (id: ${existing.id})`)
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'teacher' },
  })
  if (error) { console.error('Create failed:', error.message); process.exit(1) }
  console.log(`Created teacher account: ${email} (id: ${data.user.id})`)
}
