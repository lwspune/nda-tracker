import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { stripAnswerKey } from '../src/lib/quiz.js'

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

function normMobile(m) {
  if (!m) return null
  let s = String(m).replace(/\D/g, '')
  if (s.startsWith('0') && s.length === 11) s = '91' + s.slice(1)
  if (s.length === 10) s = '91' + s
  if (s.startsWith('91') && s.length === 12) return s
  return null
}

function quizBatches(batchStr) {
  if (!batchStr) return []
  return String(batchStr).split(',').map(b => b.trim()).filter(Boolean)
}

// Returns the quizzes a student can take or review.
//   state:'open' → published, within window, not yet attempted → questions have NO answer key.
//   state:'done' → already attempted → full questions (with key) + their answers + result, for review.
// Closed-and-unattempted quizzes are omitted (nothing the student can do).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { mobile } = req.body || {}
  if (!mobile) {
    res.status(400).json({ error: 'mobile is required' })
    return
  }

  const normalized = normMobile(String(mobile))
  if (!normalized) {
    res.status(400).json({ error: 'Invalid mobile number — must be a 10-digit Indian number' })
    return
  }

  const env = readEnvLocal()
  const supabaseUrl = env.VITE_SUPABASE_URL        || process.env.VITE_SUPABASE_URL        || ''
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase not configured on server' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // ── 1. Identify the student + their batches ──────────────────────────────
  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('canonical_name, lws_id, mobile, account_status, student_batches(batch_name)')
  if (studentsErr || !students) {
    res.status(500).json({ error: 'Could not load student data' })
    return
  }
  const student = students.find(s => normMobile(s.mobile) === normalized)
  if (!student) {
    res.status(404).json({ error: 'Mobile number not found. Please contact LWS Pune.' })
    return
  }
  const myBatches = (student.student_batches || []).map(b => b.batch_name)

  // ── 2. Published quizzes + this student's attempts ───────────────────────
  const { data: quizRows, error: quizErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('status', 'published')
  if (quizErr) {
    res.status(500).json({ error: 'Could not load quizzes' })
    return
  }

  const { data: attemptRows, error: attErr } = await supabase
    .from('quiz_attempts')
    .select('quiz_id, answers, score, correct, incorrect, not_attempted, submitted_at')
    .eq('lws_id', student.lws_id)
  if (attErr) {
    res.status(500).json({ error: 'Could not load quiz attempts' })
    return
  }
  const attemptByQuiz = new Map((attemptRows || []).map(a => [a.quiz_id, a]))

  // ── 3. Filter to this student's batch + shape the response ───────────────
  const now = Date.now()
  const quizzes = []
  for (const q of quizRows || []) {
    if (q.status !== 'published') continue // defensive (query already filters)
    const batches = quizBatches(q.batch)
    const targeted = batches.length === 0 || batches.some(b => myBatches.includes(b))
    if (!targeted) continue

    const attempt = attemptByQuiz.get(q.id)
    const closesMs = q.closes_at ? new Date(q.closes_at).getTime() : null
    const closed = closesMs !== null && now >= closesMs

    if (attempt) {
      quizzes.push({
        id: q.id, title: q.title, subject: q.subject, marking: q.marking,
        closesAt: q.closes_at, state: 'done',
        questions: q.questions || [],          // review reveals the key (already submitted)
        myAnswers: attempt.answers || {},
        result: {
          score: attempt.score, correct: attempt.correct,
          incorrect: attempt.incorrect, notAttempted: attempt.not_attempted,
          submittedAt: attempt.submitted_at,
        },
      })
    } else if (!closed) {
      quizzes.push({
        id: q.id, title: q.title, subject: q.subject, marking: q.marking,
        closesAt: q.closes_at, state: 'open',
        questions: stripAnswerKey(q.questions || []), // key hidden until submit
      })
    }
    // closed && !attempt → omitted
  }

  res.status(200).json({ quizzes })
}
