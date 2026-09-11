import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { quizQuestionComplete } from '../src/lib/quiz.js'
import { buildQuizRow } from '../src/store/slices/quizSupabase.js'
import { isTeacherUser } from './_authRole.js'

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

// Cross-app quiz import. PYQ Vault (question-bank) harvests Level-1 recall MCQs
// from the /notes content and POSTs them here as a quiz. Shared-secret auth, same
// trust model as the WhatsApp endpoints. The quiz always lands as a DRAFT — a
// teacher reviews it, picks the batch + close time, and publishes by hand. Nothing
// goes live through this endpoint.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const env = readEnvLocal()

  // ── OUTBOUND: pull question content FROM PYQ Vault ────────────────────────
  // Dispatched before the shared-secret gate below because the auth model is
  // the OPPOSITE way round: the quiz path is the vault calling US with the
  // shared secret; this is our own admin calling us with their Supabase
  // session, and the secret never leaves the server. Folded into this file
  // because Vercel's Hobby plan hard-fails the build above 12 api/*.js and we
  // are at 12 — see project_vercel_function_cap.
  if ((req.body || {}).kind === 'hydrate-questions') {
    await handleHydrateQuestions(req, res, env)
    return
  }

  const importSecret = env.QUIZ_IMPORT_SECRET || process.env.QUIZ_IMPORT_SECRET || ''
  if (!importSecret) {
    res.status(500).json({ error: 'Quiz import is not configured on the server' })
    return
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token !== importSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const quiz = req.body || {}

  // Cross-app DELETE: PYQ Vault deleted this quiz; remove the orphaned DRAFT here.
  // NEVER delete a published quiz (it may have student attempts) — the status
  // filter makes that a no-op (deleted: 0).
  if (quiz.action === 'delete') {
    const delId = String(quiz.id || '').trim()
    if (!delId) {
      res.status(400).json({ error: 'id is required for delete' })
      return
    }
    const sbUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
    const svcKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (!sbUrl || !svcKey) {
      res.status(500).json({ error: 'Supabase not configured on server' })
      return
    }
    const db = createClient(sbUrl, svcKey)
    const { error: delErr, count } = await db
      .from('quizzes')
      .delete({ count: 'exact' })
      .eq('id', delId)
      .eq('status', 'draft')
    if (delErr) {
      res.status(500).json({ error: 'Could not delete the quiz', detail: delErr.message })
      return
    }
    res.status(200).json({ ok: true, action: 'delete', id: delId, deleted: count || 0 })
    return
  }

  if (!quiz.title || !String(quiz.title).trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  const complete = (quiz.questions || []).filter(quizQuestionComplete)
  if (complete.length === 0) {
    res.status(400).json({ error: 'no complete questions (each needs text + 4 options + a correct answer A–D)' })
    return
  }

  const supabaseUrl = env.VITE_SUPABASE_URL        || process.env.VITE_SUPABASE_URL        || ''
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase not configured on server' })
    return
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  // Force draft regardless of what the caller sent — publishing is a human action.
  const row = buildQuizRow({ ...quiz, status: 'draft' })
  const { error } = await supabase.from('quizzes').upsert(row, { onConflict: 'id' })
  if (error) {
    res.status(500).json({ error: 'Could not save the imported quiz', detail: error.message })
    return
  }

  res.status(200).json({ ok: true, id: row.id, title: row.title, questionCount: complete.length })
}

// Fetch full question content from PYQ Vault by bank id — the questions the
// text-only Tags sheet could never carry, above all the DIAGRAMS.
//
// Returns the vault's `missing[]` UNTOUCHED. A stem repair there is a
// delete-and-re-commit that mints a new uuid, so an exam can hold a dead id
// through nobody's error; collapsing that into "no content" would hide a
// repaired question. Likewise a vault failure is a 502, never an empty result —
// "the bank is unreachable" and "the bank has nothing" must not look alike.
async function handleHydrateQuestions(req, res, env) {
  const supabaseUrl = env.VITE_SUPABASE_URL      || process.env.VITE_SUPABASE_URL      || ''
  const anonKey     = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !anonKey) {
    res.status(500).json({ ok: false, error: 'Supabase is not configured on the server' })
    return
  }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, anonKey)
  const { data: { user } } = await anonClient.auth.getUser(jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  // Teachers hold real sessions for /school-attendance capture, so a valid
  // session does not imply admin (mirrors the send endpoints).
  if (isTeacherUser(user)) { res.status(403).json({ ok: false, error: 'Forbidden' }); return }

  const ids = (req.body || {}).ids
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ ok: false, error: 'ids[] is required' })
    return
  }

  const vaultUrl = (env.VAULT_API_URL || process.env.VAULT_API_URL || '').replace(/\/$/, '')
  const vaultSecret = env.VAULT_SYNC_SECRET || process.env.VAULT_SYNC_SECRET || ''
  if (!vaultUrl || !vaultSecret) {
    res.status(500).json({ ok: false, error: 'PYQ Vault sync is not configured. Set VAULT_API_URL and VAULT_SYNC_SECRET in Vercel env.' })
    return
  }

  const query = ids.map(id => encodeURIComponent(String(id))).join(',')
  try {
    const r = await fetch(`${vaultUrl}/api/questions/by-ids?ids=${query}`, {
      headers: { Authorization: `Bearer ${vaultSecret}` },
    })
    if (!r.ok) {
      let detail = ''
      try { detail = (await r.json())?.error || '' } catch { /* non-JSON body */ }
      res.status(502).json({ ok: false, error: `PYQ Vault returned ${r.status}`, detail })
      return
    }
    const data = await r.json()
    res.status(200).json({
      ok: true,
      questions: Array.isArray(data.questions) ? data.questions : [],
      missing: Array.isArray(data.missing) ? data.missing : [],
    })
  } catch (e) {
    res.status(502).json({ ok: false, error: 'Could not reach PYQ Vault', detail: e.message })
  }
}
