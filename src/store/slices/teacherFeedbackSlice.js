import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

const TABLE = 'teacher_feedback'
const COLS = 'id, cycle, branch, submitted_at, teacher_name, clarity, engagement, support, feedback, pace, respect, organization, availability, comment'

// Teacher feedback is HR-sensitive: the table's RLS only admits a superadmin
// JWT claim, so these calls return [] / fail for any non-superadmin session even
// though the slice itself only gates on "a session exists". RLS is the real guard.
export const createTeacherFeedbackSlice = (_set, _get) => ({
  async loadTeacherFeedback() {
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from(TABLE).select(COLS).order('submitted_at', { ascending: false })
    if (error) { console.error('[teacherFeedback] load failed:', error); return [] }
    return data ?? []
  },

  // rows: pre-reshaped per-(response, teacher) objects from reshapeFeedbackMatrix.
  async importTeacherFeedback(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, inserted: 0, reason: 'empty' }
    const session = await getSession()
    if (!session) return { ok: false, inserted: 0, reason: 'no_session' }
    const createdBy = session.user?.email ?? null
    const payload = rows.map(r => ({
      cycle: r.cycle, branch: r.branch ?? null, submitted_at: r.submitted_at ?? null,
      teacher_name: r.teacher_name,
      clarity: r.clarity ?? null, engagement: r.engagement ?? null, support: r.support ?? null,
      feedback: r.feedback ?? null, pace: r.pace ?? null, respect: r.respect ?? null,
      organization: r.organization ?? null, availability: r.availability ?? null,
      comment: r.comment ?? null, created_by: createdBy,
    }))
    const { error } = await supabase.from(TABLE).insert(payload)
    if (error) { console.error('[teacherFeedback] import failed:', error); return { ok: false, inserted: 0, reason: error.message } }
    return { ok: true, inserted: payload.length }
  },
})
