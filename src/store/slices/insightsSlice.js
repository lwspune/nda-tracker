import { supabase } from '../../lib/supabase'
import {
  insertClassReport,
  insertStudentPlan,
  deleteAllClassReports,
  deleteStudentPlansByName,
} from './insightsSupabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createInsightsSlice = (set, get) => ({
  // opts: { examId?, generatedBy? } — extras for the new chat-driven flow.
  async saveClassReport(text, opts = {}) {
    const generatedAt = new Date().toISOString()
    set(s => ({
      savedInsights: {
        ...s.savedInsights,
        classReport: { text, generatedAt }
      }
    }))
    get()._save()

    const session = await getSession()
    if (session) {
      try {
        await insertClassReport(supabase, {
          text,
          generatedAt,
          examId: opts.examId ?? null,
          generatedBy: opts.generatedBy ?? null,
        })
      } catch (e) {
        console.error('[insightsSlice] saveClassReport Supabase insert failed:', e.message)
      }
    }
  },

  // opts: { lwsId?, generatedBy? }
  async saveStudentPlan(name, text, opts = {}) {
    const generatedAt = new Date().toISOString()
    set(s => ({
      savedInsights: {
        ...s.savedInsights,
        studentPlans: {
          ...s.savedInsights.studentPlans,
          [name]: { text, generatedAt }
        }
      }
    }))
    get()._save()

    const session = await getSession()
    if (session) {
      try {
        await insertStudentPlan(supabase, {
          studentName: name,
          text,
          generatedAt,
          lwsId: opts.lwsId ?? null,
          generatedBy: opts.generatedBy ?? null,
        })
      } catch (e) {
        console.error('[insightsSlice] saveStudentPlan Supabase insert failed:', e.message)
      }
    }
  },

  async clearClassReport() {
    set(s => ({
      savedInsights: { ...s.savedInsights, classReport: null }
    }))
    get()._save()

    const session = await getSession()
    if (session) {
      try {
        await deleteAllClassReports(supabase)
      } catch (e) {
        console.error('[insightsSlice] clearClassReport Supabase delete failed:', e.message)
      }
    }
  },

  async clearStudentPlan(name) {
    set(s => {
      const plans = { ...s.savedInsights.studentPlans }
      delete plans[name]
      return { savedInsights: { ...s.savedInsights, studentPlans: plans } }
    })
    get()._save()

    const session = await getSession()
    if (session) {
      try {
        await deleteStudentPlansByName(supabase, name)
      } catch (e) {
        console.error('[insightsSlice] clearStudentPlan Supabase delete failed:', e.message)
      }
    }
  },
})
