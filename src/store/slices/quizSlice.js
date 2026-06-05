import { supabase } from '../../lib/supabase'
import { upsertQuiz, deleteQuizById } from './quizSupabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Quiz CRUD. Dual-path, but deliberately different from examsSlice in one way:
// it calls `_save()` ONLY in the no-session (dev/local) branch. Quizzes live in
// their own `quizzes` table, so when a session exists we write there directly and
// must NOT call `_save()` — that would round-trip the whole faculty_state blob and,
// because teachers (an authenticated, normally read-only role) can author quizzes,
// could clobber admin-owned faculty_state. In dev there is no session, so `_save()`
// is how quizzes persist to data/faculty-data.json.
export const createQuizSlice = (set, get) => ({
  addQuiz(quiz) {
    set(s => ({ quizzes: [...s.quizzes, quiz] }))
    getSession().then(session => {
      if (session) upsertQuiz(supabase, quiz).catch(e => console.error('[quiz] addQuiz Supabase write failed:', e))
      else get()._save()
    })
  },

  updateQuiz(id, patch) {
    set(s => ({ quizzes: s.quizzes.map(q => q.id === id ? { ...q, ...patch } : q) }))
    getSession().then(session => {
      const updated = get().quizzes.find(q => q.id === id)
      if (!updated) return
      if (session) upsertQuiz(supabase, updated).catch(e => console.error('[quiz] updateQuiz Supabase write failed:', e))
      else get()._save()
    })
  },

  deleteQuiz(id) {
    set(s => ({ quizzes: s.quizzes.filter(q => q.id !== id) }))
    getSession().then(session => {
      if (session) deleteQuizById(supabase, id).catch(e => console.error('[quiz] deleteQuiz Supabase write failed:', e))
      else get()._save()
    })
  },

  // ── Attempt reads (admin/teacher response dashboard + per-student history) ──
  // Session-gated: students have no Supabase session and read their own attempts
  // via /api/student-quizzes instead. Returns [] in dev (no session, no attempts).
  async getQuizAttempts(quizId) {
    const session = await getSession()
    if (!session || !quizId) return []
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('quiz_id, lws_id, student_name, answers, score, correct, incorrect, not_attempted, submitted_at')
      .eq('quiz_id', quizId)
    if (error) { console.error('[quiz] getQuizAttempts failed:', error); return [] }
    return (data || []).map(mapAttempt)
  },

  async getQuizAttemptsForStudent(lwsId) {
    const session = await getSession()
    if (!session || !lwsId) return []
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('quiz_id, lws_id, student_name, answers, score, correct, incorrect, not_attempted, submitted_at')
      .eq('lws_id', lwsId)
    if (error) { console.error('[quiz] getQuizAttemptsForStudent failed:', error); return [] }
    return (data || []).map(mapAttempt)
  },
})

function mapAttempt(r) {
  return {
    quizId:       r.quiz_id,
    lwsId:        r.lws_id,
    studentName:  r.student_name,
    answers:      r.answers ?? {},
    score:        r.score,
    correct:      r.correct,
    incorrect:    r.incorrect,
    notAttempted: r.not_attempted,
    submittedAt:  r.submitted_at,
  }
}
