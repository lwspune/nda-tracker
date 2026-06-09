import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { quizQuestionComplete } from '../src/lib/quiz.js'
import { buildQuizRow } from '../src/store/slices/quizSupabase.js'

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
