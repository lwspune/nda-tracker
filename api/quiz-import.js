import { createClient } from '@supabase/supabase-js'
import { quizQuestionComplete } from '../src/lib/quiz.js'
import { buildQuizRow } from '../src/store/slices/quizSupabase.js'
import { isTeacherUser } from './_authRole.js'
import { bearerFrom, getUserOrNull } from './_auth.js'
import { readEnvLocal } from './_env.js'

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

  // ── INBOUND: a finished paper pushed FROM PYQ Vault ───────────────────────
  // Dispatched before the QUIZ_IMPORT_SECRET gate because it authenticates on
  // VAULT_SYNC_SECRET instead — the SAME per-institute secret we present when
  // hydrating, used in the opposite direction. One secret per tracker
  // deployment, both ways, so provisioning an institute is one value not two.
  // Folded into this file for the same reason as above: 12/12 Hobby functions.
  if ((req.body || {}).kind === 'paper') {
    await handlePaperPush(req, res, env)
    return
  }

  const importSecret = env.QUIZ_IMPORT_SECRET || process.env.QUIZ_IMPORT_SECRET || ''
  if (!importSecret) {
    res.status(500).json({ error: 'Quiz import is not configured on the server' })
    return
  }
  // Same header parse, different authority: this token is compared to a shared
  // secret, not resolved to a user. The COMPARISON stays inline — only the
  // parsing is shared.
  const token = bearerFrom(req)
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

  const jwt = bearerFrom(req)
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, anonKey)
  const user = await getUserOrNull(anonClient, jwt)
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

// ── Paper push: PYQ Vault → a DRAFT exam here ───────────────────────────────
//
// The vault builds the paper, we receive it WITH ITS DIAGRAMS — the enrichment
// the tagged .xlsx cannot carry. This does NOT replace the tags-file flow, which
// stays live and remains the proven path; a push that fails costs nothing,
// because the paper is still deliverable as Tags + docx.
//
// Contract: CROSS_APP_SYNC.md §2.
async function handlePaperPush(req, res, env) {
  // Auth: the per-institute secret, the same value we send when hydrating.
  const vaultSecret = env.VAULT_SYNC_SECRET || process.env.VAULT_SYNC_SECRET || ''
  if (!vaultSecret) {
    res.status(500).json({ ok: false, error: 'Paper push is not configured — set VAULT_SYNC_SECRET.' })
    return
  }
  // Same header parse, different authority: this token is compared to a shared
  // secret, not resolved to a user. The COMPARISON stays inline — only the
  // parsing is shared.
  const token = bearerFrom(req)
  if (!token || token !== vaultSecret) {
    res.status(401).json({ ok: false, error: 'Unauthorized' })
    return
  }

  const body = req.body || {}
  const paperId = String(body.paperId || '').trim()
  const title = String(body.title || '').trim()
  const questions = Array.isArray(body.questions) ? body.questions : []
  // Which CONDUCT of the paper. Absent = 1, so a pre-sittings vault deploys
  // unchanged. One paper is routinely run for several batches on several days;
  // each is its own exam, because a sitting owns its own date, batch and
  // results and none of those can be shared.
  const sittingNo = body.sittingNo === undefined ? 1 : Number(body.sittingNo)
  if (!paperId) { res.status(400).json({ ok: false, error: 'paperId is required' }); return }
  if (!Number.isInteger(sittingNo) || sittingNo < 1) {
    // Refuse rather than coerce: a bad value would file the paper under an exam
    // id the vault never recorded, which nothing downstream would notice.
    res.status(400).json({ ok: false, error: 'sittingNo must be a positive integer' })
    return
  }
  if (!title) { res.status(400).json({ ok: false, error: 'title is required' }); return }
  if (questions.length === 0) { res.status(400).json({ ok: false, error: 'questions[] is empty' }); return }

  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Supabase is not configured on the server' })
    return
  }
  const supabase = createClient(url, serviceKey)

  // Deterministic + namespaced, so a re-push of THIS SITTING updates its own
  // exam rather than creating a second one, and a vault exam can never collide
  // with a hand-made exam_<timestamp>.
  //
  // SITTING 1 KEEPS THE ORIGINAL ID, unsuffixed. Nine drafts are live in
  // production on `exam_vault_<paperId>` (RESULTS_REUPLOAD.md section 1);
  // suffixing them would orphan every one. Only a second conduct gets `_s<N>`.
  const examId = sittingNo === 1
    ? `exam_vault_${paperId}`
    : `exam_vault_${paperId}_s${sittingNo}`

  // GUARD 1 — never rewrite an exam that already has results.
  // Students sat those questions; swapping them rewrites history and
  // invalidates every per-question analytic already computed. Same posture as
  // the quiz delete, which refuses to remove a published quiz.
  const { count: resultCount, error: countErr } = await supabase
    .from('exam_results')
    .select('exam_id', { count: 'exact', head: true })
    .eq('exam_id', examId)
  if (countErr) {
    res.status(500).json({ ok: false, error: 'Could not check existing results', detail: countErr.message })
    return
  }
  if ((resultCount || 0) > 0) {
    res.status(409).json({
      ok: false,
      // The CODE is what lets the vault turn this from a dead end into an
      // offer: "this was already conducted -- push it as a new sitting?".
      // Without it the caller sees only a sentence and cannot branch.
      code: 'has_results',
      error: `"${title}" already has ${resultCount} result row(s) in the tracker — refusing to overwrite a conducted exam. Push it as a NEW SITTING if you are conducting it again, or delete its results first if you really mean to replace this one.`,
      examId,
      sittingNo,
      resultCount,
    })
    return
  }

  // GUARD 2 — a re-push must not wipe what faculty already filled in.
  // The vault knows nothing about date, batch, branch or marking, so on an
  // update we PRESERVE whatever is there and replace only what the vault owns
  // (name + questions + subject). Only a brand-new exam gets defaults.
  const { data: existing, error: readErr } = await supabase
    .from('exams')
    .select('id, date, batch, branch, marking, subject, created_at, created_by, source, max_marks')
    .eq('id', examId)
    .maybeSingle()
  if (readErr) {
    res.status(500).json({ ok: false, error: 'Could not read the existing exam', detail: readErr.message })
    return
  }

  // `date` and `source` are NOT NULL here (measured 2026-09-11), so they cannot
  // simply be omitted the way the spec assumed. The tracker supplies its own
  // defaults rather than letting the vault invent an exam date it cannot know —
  // faculty correct them on the draft.
  const today = new Date().toISOString().slice(0, 10)
  const row = {
    id:         examId,
    name:       title,
    date:       existing?.date ?? today,
    subject:    body.subject || existing?.subject || null,
    batch:      existing?.batch ?? null,
    branch:     existing?.branch ?? null,
    marking:    existing?.marking ?? { correct: 4, wrong: -1 },
    questions,
    max_marks:  existing?.max_marks ?? null,
    created_by: existing?.created_by ?? 'PYQ Vault',
    // CHECK-constrained to admin|teacher — a vault push is neither, and 'teacher'
    // drives a parent-facing "Written Quiz" tag a pushed paper must not get.
    source:     existing?.source ?? 'admin',
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error: upsertErr } = await supabase.from('exams').upsert(row, { onConflict: 'id' })
  if (upsertErr) {
    res.status(500).json({ ok: false, error: 'Could not save the pushed paper', detail: upsertErr.message })
    return
  }

  res.status(200).json({
    ok: true,
    examId,
    questionCount: questions.length,
    updated: !!existing,
    warning: existing
      ? 'Updated an existing draft — its date, batch and marking were preserved.'
      : undefined,
  })
}
