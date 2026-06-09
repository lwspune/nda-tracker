import { supabase } from '../../lib/supabase'
import { upsertExam, deleteExamById, updateExamQuestions } from './examSupabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createExamsSlice = (set, get) => ({
  // opts.syncAbsences (default true): flag rostered no-shows as absent + enable
  // the absence WhatsApp flow. Offline exams pass false by default so a totals
  // upload doesn't unexpectedly message parents (faculty opts in via a checkbox).
  addExam(exam, opts = {}) {
    const { syncAbsences = true } = opts
    const normalised = { ...exam, batch: exam.batch || null, branch: exam.branch || null }
    set(s => ({ exams: [...s.exams, normalised] }))
    get()._save()
    if (syncAbsences) get().syncExamAbsences?.(normalised.id)
    getSession().then(session => {
      if (session) upsertExam(supabase, normalised, get().studentProfiles).catch(e => console.error('[exams] addExam Supabase write failed:', e))
    })
  },

  replaceExam(id, exam, opts = {}) {
    const { syncAbsences = true } = opts
    set(s => ({ exams: s.exams.map(e => e.id === id ? exam : e) }))
    get()._save()
    if (syncAbsences) get().syncExamAbsences?.(id)
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
