import { supabase } from '../../lib/supabase'
import { getExamAbsentees } from '../../lib/analytics'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createExamAbsenceSlice = (_set, get) => ({
  // Recomputes the absentee set for an exam from in-memory state and reconciles
  // it with `exam_absences`. Rows for students who turn out to have attended
  // (re-upload correction) are DELETEd; new absentees are INSERTed. Rows for
  // students who remain absent are LEFT IN PLACE — preserving `notified_at`
  // across re-uploads so the audit trail isn't lost.
  //
  // Returns { added, removed, kept } so the caller can log / surface a banner.
  async syncExamAbsences(examId) {
    const noop = { added: 0, removed: 0, kept: 0 }
    if (!examId) return noop
    const state = get()
    const exam  = (state.exams || []).find(e => e.id === examId)
    if (!exam) return noop

    const session = await getSession()
    if (!session) return noop

    // Compute the target absentee set from the in-memory store.
    const target = getExamAbsentees(exam, state.studentProfiles || {})
    const targetIds = new Set(target.map(p => p.lwsId).filter(Boolean))

    // Read current Supabase rows for this exam.
    const { data: existing, error: readError } = await supabase
      .from('exam_absences')
      .select('lws_id')
      .eq('exam_id', examId)
    if (readError) {
      console.error('[examAbsence] read failed:', readError)
      return noop
    }
    const currentIds = new Set((existing ?? []).map(r => r.lws_id))

    const toRemove = [...currentIds].filter(id => !targetIds.has(id))
    const toAdd    = [...targetIds].filter(id => !currentIds.has(id))
    const kept     = [...targetIds].filter(id =>  currentIds.has(id)).length

    if (toRemove.length > 0) {
      const { error } = await supabase
        .from('exam_absences')
        .delete()
        .eq('exam_id', examId)
        .in('lws_id', toRemove)
      if (error) console.error('[examAbsence] delete failed:', error)
    }

    if (toAdd.length > 0) {
      const rows = toAdd.map(lws_id => ({
        exam_id: examId,
        lws_id,
        marked_by: 'upload',
      }))
      const { error } = await supabase.from('exam_absences').insert(rows)
      if (error) console.error('[examAbsence] insert failed:', error)
    }

    return { added: toAdd.length, removed: toRemove.length, kept }
  },

  // Per-exam read — used by ExamAbsencePreviewModal to show "Notified" status
  // and by future audit views.
  async getExamAbsencesForExam(examId) {
    if (!examId) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('exam_absences')
      .select('exam_id, lws_id, marked_at, notified_at')
      .eq('exam_id', examId)
    if (error) {
      console.error('[examAbsence] getForExam failed:', error)
      return []
    }
    return data ?? []
  },

  // Per-student read — used by StudentView's ExamHistoryTable and RecentIncidents.
  // `sinceDate` (ISO timestamp) bounds the window; pass null for full history.
  async getExamAbsencesForStudent(lwsId, sinceDate = null) {
    if (!lwsId) return []
    const session = await getSession()
    if (!session) return []
    let query = supabase
      .from('exam_absences')
      .select('exam_id, lws_id, marked_at, notified_at')
      .eq('lws_id', lwsId)
    if (sinceDate) query = query.gte('marked_at', sinceDate)
    query = query.order('marked_at', { ascending: false })
    const { data, error } = await query
    if (error) {
      console.error('[examAbsence] getForStudent failed:', error)
      return []
    }
    return data ?? []
  },

  // Sets notified_at = now() for the given (examId, lwsIds[]). Called by the
  // absence-alert flow on successful WhatsApp send. Empty lwsIds is a no-op.
  async markExamAbsencesNotified(examId, lwsIds) {
    if (!examId) return false
    if (!Array.isArray(lwsIds) || lwsIds.length === 0) return true
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('exam_absences')
      .update({ notified_at: new Date().toISOString() })
      .eq('exam_id', examId)
      .in('lws_id', lwsIds)
    if (error) {
      console.error('[examAbsence] mark notified failed:', error)
      return false
    }
    return true
  },
})
