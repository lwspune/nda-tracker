// The service-role Supabase client for the grading scripts. Reads .env.local
// through the same reader every endpoint uses (api/_env.js). Service role,
// because submissions and grades have no write policy: these scripts and the
// student endpoint are the only writers.
import { createClient } from '@supabase/supabase-js'
import { join } from 'node:path'
import { readEnvLocal } from '../../api/_env.js'

export const INBOX = join(process.cwd(), 'grading-inbox')

export function serviceClient() {
  const env = readEnvLocal()
  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  return createClient(url, key, { auth: { persistSession: false } })
}

export function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

export function fail(e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
