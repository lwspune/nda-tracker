import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { gradeQuizAttempt } from '../src/lib/quiz.js'

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

// Student quiz submission. Mobile-based identity (same trust model as student-login),
// service-role client. Grades SERVER-SIDE against the answer key the student never
// received, enforces the close-time window, and relies on the UNIQUE(quiz_id, lws_id)
// constraint (plus a pre-check) to make one-attempt-per-student.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { mobile, quizId, answers } = req.body || {}
  if (!mobile || !quizId) {
    res.status(400).json({ error: 'mobile and quizId are required' })
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

  // ── 1. Identify the student by mobile ────────────────────────────────────
  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('canonical_name, lws_id, mobile')
  if (studentsErr || !students) {
    res.status(500).json({ error: 'Could not load student data' })
    return
  }
  const student = students.find(s => normMobile(s.mobile) === normalized)
  if (!student) {
    res.status(404).json({ error: 'Mobile number not found. Please contact LWS Pune.' })
    return
  }

  // ── 2. Load the quiz (with its answer key) ───────────────────────────────
  const { data: quizRows, error: quizErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', quizId)
  if (quizErr) {
    res.status(500).json({ error: 'Could not load quiz' })
    return
  }
  const quiz = (quizRows || [])[0]
  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found' })
    return
  }

  // ── 3. Enforce the open window ───────────────────────────────────────────
  if (quiz.status !== 'published') {
    res.status(403).json({ error: 'This quiz is not open.' })
    return
  }
  const closesMs = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  if (closesMs !== null && Date.now() >= closesMs) {
    res.status(403).json({ error: 'This quiz has closed.' })
    return
  }

  // ── 4. One attempt per student ───────────────────────────────────────────
  const { data: existing } = await supabase
    .from('quiz_attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('lws_id', student.lws_id)
  if (existing && existing.length > 0) {
    res.status(409).json({ error: 'You have already submitted this quiz.', alreadySubmitted: true })
    return
  }

  // ── 5. Grade server-side + persist ───────────────────────────────────────
  const graded = gradeQuizAttempt(quiz.questions || [], answers || {}, quiz.marking)
  const { error: insErr } = await supabase.from('quiz_attempts').insert({
    quiz_id:       quizId,
    lws_id:        student.lws_id,
    student_name:  student.canonical_name,
    answers:       answers || {},
    score:         graded.score,
    correct:       graded.correct,
    incorrect:     graded.incorrect,
    not_attempted: graded.notAttempted,
    submitted_at:  new Date().toISOString(),
  })
  if (insErr) {
    // UNIQUE(quiz_id, lws_id) violation = a racing double-submit slipped past step 4.
    res.status(409).json({ error: 'Could not save your attempt — it may already be submitted.', detail: insErr.message })
    return
  }

  res.status(200).json({
    score:        graded.score,
    correct:      graded.correct,
    incorrect:    graded.incorrect,
    notAttempted: graded.notAttempted,
    total:        (quiz.questions || []).length,
    review:       quiz.questions || [], // now safe to reveal the answer key
    myAnswers:    answers || {},
    marking:      quiz.marking,
  })
}
