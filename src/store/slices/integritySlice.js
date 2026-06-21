import { supabase } from '../../lib/supabase'

// Academic-integrity incidents — a hand-recorded disciplinary event log. Created
// from the Exam Integrity panel after a teacher confronts a flagged student and
// the student ADMITS copying. One row per (student, exam); the counterpart (the
// other student in the flagged pair) is named. Evidence (shared-wrong / diff /
// both-answered) is SNAPSHOTTED on the row so the incident stays factual even if
// the exam is later re-uploaded or deleted. Surfaces in StudentView (and the
// student/parent portal via api/student-login). Session-gated like the other
// event-log slices; `integrity_incidents` RLS is authenticated-only.

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createIntegritySlice = (_set, _get) => ({
  // Upsert on (lws_id, exam_id) so re-logging the same student/exam updates
  // rather than duplicates. Returns true on success.
  async logIntegrityIncident(p) {
    if (!p || !p.lwsId || !p.examId) return false
    const session = await getSession()
    if (!session) return false

    const row = {
      lws_id:             p.lwsId,
      student_name:       p.studentName ?? '',
      exam_id:            p.examId,
      exam_name:          p.examName ?? null,
      exam_date:          p.examDate ?? null,
      counterpart_name:   p.counterpartName ?? null,
      counterpart_lws_id: p.counterpartLwsId ?? null,
      shared_wrong:       p.sharedWrong ?? null,
      same_correct:       p.sameCorrect ?? null,
      diff:               p.diff ?? null,
      both_answered:      p.bothAnswered ?? null,
      status:             p.status ?? 'admitted',
      note:               p.note ?? null,
      created_by:         session.user?.email ?? null,
    }
    const { error } = await supabase
      .from('integrity_incidents')
      .upsert(row, { onConflict: 'lws_id,exam_id' })
    if (error) {
      console.error('[integrity] log failed:', error)
      return false
    }
    return true
  },

  // Per-student read — StudentView's IntegrityIncidents card + RecentIncidents chip.
  async getIntegrityIncidentsForStudent(lwsId) {
    if (!lwsId) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('integrity_incidents')
      .select('*')
      .eq('lws_id', lwsId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[integrity] getForStudent failed:', error)
      return []
    }
    return data ?? []
  },

  // Per-exam read — drives the "✓ logged" badge in the Exam Integrity panel.
  async getIntegrityIncidentsForExam(examId) {
    if (!examId) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('integrity_incidents')
      .select('id, lws_id, student_name, counterpart_name')
      .eq('exam_id', examId)
    if (error) {
      console.error('[integrity] getForExam failed:', error)
      return []
    }
    return data ?? []
  },

  // Hard delete — admin-only (gated in the UI). Returns true on success.
  async deleteIntegrityIncident(id) {
    if (!id) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('integrity_incidents')
      .delete()
      .eq('id', id)
    if (error) {
      console.error('[integrity] delete failed:', error)
      return false
    }
    return true
  },
})
