import { supabase } from '../../lib/supabase'
import { upsertExam, deleteExamById, updateExamQuestions } from './examSupabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createExamsSlice = (set, get) => ({
  addExam(exam) {
    const normalised = { ...exam, batch: exam.batch || null, branch: exam.branch || null }
    set(s => ({ exams: [...s.exams, normalised] }))
    get()._save()
    get().syncExamAbsences?.(normalised.id)
    getSession().then(session => {
      if (session) upsertExam(supabase, normalised, get().studentProfiles).catch(e => console.error('[exams] addExam Supabase write failed:', e))
    })
  },

  replaceExam(id, exam) {
    set(s => ({ exams: s.exams.map(e => e.id === id ? exam : e) }))
    get()._save()
    get().syncExamAbsences?.(id)
    getSession().then(session => {
      if (session) upsertExam(supabase, exam, get().studentProfiles).catch(e => console.error('[exams] replaceExam Supabase write failed:', e))
    })
  },

  deleteExam(id) {
    set(s => ({ exams: s.exams.filter(e => e.id !== id) }))
    get()._save()
    getSession().then(session => {
      if (session) deleteExamById(supabase, id).catch(e => console.error('[exams] deleteExam Supabase write failed:', e))
    })
  },

  updateQuestion(examId, qNum, patch) {
    set(s => ({
      exams: s.exams.map(e => {
        if (e.id !== examId) return e
        return {
          ...e,
          questions: e.questions.map(q =>
            q.q === qNum ? { ...q, ...patch } : q
          )
        }
      })
    }))
    get()._save()
    getSession().then(session => {
      if (!session) return
      const updatedExam = get().exams.find(e => e.id === examId)
      if (updatedExam) {
        updateExamQuestions(supabase, examId, updatedExam.questions)
          .catch(e => console.error('[exams] updateQuestion Supabase write failed:', e))
      }
    })
  },
})
