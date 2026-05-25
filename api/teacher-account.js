// Admin-only endpoint to manage Supabase auth accounts for teachers.
//
// Single POST endpoint, action-routed:
//   list   → { emails }                returns lowercase emails of users with user_metadata.role==='teacher'
//   create → { email, password, name? } creates an instant-active auth user with role='teacher'
//   delete → { email }                  removes the auth user
//   reset  → { email, newPassword }     sets a new password on the auth user
//
// Two clients are constructed: an anon client (verifies the caller's JWT and
// blocks teacher accounts from privilege-escalating) and a service-role client
// (the actual auth.admin.* operations). SUPABASE_SERVICE_ROLE_KEY must be set
// in Vercel env — never ships to the browser bundle.

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' })
    return
  }

  const env = readEnvLocal()
  const supabaseUrl  = env.VITE_SUPABASE_URL          || process.env.VITE_SUPABASE_URL          || ''
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY     || process.env.VITE_SUPABASE_ANON_KEY     || ''
  const serviceKey   = env.SUPABASE_SERVICE_ROLE_KEY  || process.env.SUPABASE_SERVICE_ROLE_KEY  || ''

  if (!serviceKey) {
    res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured. Set it in Vercel env (Project → Settings → Environment Variables).' })
    return
  }

  // Caller verification — anon client + JWT from Authorization header.
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }

  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const { data: { user } } = await anonClient.auth.getUser(jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  if (user.user_metadata?.role === 'teacher') {
    res.status(403).json({ ok: false, error: 'Forbidden — teacher accounts cannot manage auth accounts' })
    return
  }

  // Admin operations — service-role client.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { action, email, password, newPassword, name } = req.body || {}

  if (action === 'list') {
    const { data, error } = await admin.auth.admin.listUsers()
    if (error) { res.status(500).json({ ok: false, error: error.message }); return }
    const emails = (data?.users || [])
      .filter(u => u.user_metadata?.role === 'teacher' && u.email)
      .map(u => u.email.toLowerCase())
    res.status(200).json({ ok: true, emails })
    return
  }

  if (action === 'create') {
    if (!email || !password) { res.status(400).json({ ok: false, error: 'email and password are required' }); return }
    const user_metadata = name ? { role: 'teacher', full_name: name } : { role: 'teacher' }
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata,
    })
    if (error) { res.status(400).json({ ok: false, error: error.message }); return }
    res.status(200).json({ ok: true, id: data?.user?.id })
    return
  }

  if (action === 'delete' || action === 'reset') {
    if (!email) { res.status(400).json({ ok: false, error: 'email is required' }); return }
    if (action === 'reset' && !newPassword) {
      res.status(400).json({ ok: false, error: 'newPassword is required' }); return
    }
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers()
    if (listErr) { res.status(500).json({ ok: false, error: listErr.message }); return }
    const target = (listData?.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!target) { res.status(404).json({ ok: false, error: 'No auth account found for this email' }); return }

    if (action === 'delete') {
      const { error } = await admin.auth.admin.deleteUser(target.id)
      if (error) { res.status(400).json({ ok: false, error: error.message }); return }
      res.status(200).json({ ok: true })
      return
    }

    // reset
    const { error } = await admin.auth.admin.updateUserById(target.id, { password: newPassword })
    if (error) { res.status(400).json({ ok: false, error: error.message }); return }
    res.status(200).json({ ok: true })
    return
  }

  res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
}
