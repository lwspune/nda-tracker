import { supabase } from '../../lib/supabase'

// Admin-only CRUD for the mentorship teacher↔mentee map (`mentor_assignments`).
// One mentor per student (lws_id is PK → assigning is an upsert). Reads/writes
// are session-gated; RLS (authenticated) is the real guard. The daily nudge
// rotation reads this table server-side in api/send-mentor-nudges.js.

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createMentorSlice = (_set, _get) => ({
  // Returns [{ lwsId, teacherId }] for every assignment (admin only).
  async fetchMentorAssignments() {
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('mentor_assignments')
      .select('lws_id, teacher_id')
    if (error) { console.error('[mentor] fetch failed:', error); return [] }
    return (data ?? []).map(r => ({ lwsId: r.lws_id, teacherId: r.teacher_id }))
  },

  // Assign (or reassign) one student to a mentor. lws_id PK → upsert.
  async setMentorAssignment(lwsId, teacherId) {
    if (!lwsId || !teacherId) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('mentor_assignments')
      .upsert({ lws_id: lwsId, teacher_id: teacherId }, { onConflict: 'lws_id' })
    if (error) { console.error('[mentor] upsert failed:', error); return false }
    return true
  },

  // Remove a student from mentorship entirely.
  async removeMentorAssignment(lwsId) {
    if (!lwsId) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('mentor_assignments')
      .delete()
      .eq('lws_id', lwsId)
    if (error) { console.error('[mentor] delete failed:', error); return false }
    return true
  },
})
