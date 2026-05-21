import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export const createLectureAbsenceSlice = (_set, _get) => ({
  // Replace the absentee set for a single (date, subject) "period card".
  // Delete-then-insert keeps the UI's "save this card" flow atomic from the
  // caller's perspective. lwsIds is deduped; empty list clears the period.
  async setLectureAbsenteesForPeriod(date, subject, lwsIds) {
    if (!date || !subject || !Array.isArray(lwsIds)) return false
    const session = await getSession()
    if (!session) return false

    const { error: delError } = await supabase
      .from('lecture_absences')
      .delete()
      .eq('date', date)
      .eq('subject', subject)
    if (delError) {
      console.error('[lectureAbsence] delete failed:', delError)
      return false
    }

    if (lwsIds.length === 0) return true

    const uniqueIds = [...new Set(lwsIds)]
    const createdBy = session.user?.email ?? null
    const rows = uniqueIds.map(lws_id => ({
      lws_id, date, subject, created_by: createdBy,
    }))
    const { error: insError } = await supabase
      .from('lecture_absences')
      .insert(rows)
    if (insError) {
      console.error('[lectureAbsence] insert failed:', insError)
      return false
    }
    return true
  },

  // Returns all lecture_absences rows for the given date (across batches).
  // Callers filter by batch by cross-referencing with studentProfiles.
  async getLectureAbsencesForDate(date) {
    if (!date) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('lecture_absences')
      .select('lws_id, date, subject, created_at')
      .eq('date', date)
    if (error) {
      console.error('[lectureAbsence] getForDate failed:', error)
      return []
    }
    return data ?? []
  },

  // Used by the StudentView "recent incidents" strip.
  async getLectureAbsencesForStudent(lwsId, sinceDate = null) {
    if (!lwsId) return []
    const session = await getSession()
    if (!session) return []
    let query = supabase
      .from('lecture_absences')
      .select('lws_id, date, subject, created_at')
      .eq('lws_id', lwsId)
    if (sinceDate) query = query.gte('date', sinceDate)
    query = query.order('date', { ascending: false })
    const { data, error } = await query
    if (error) {
      console.error('[lectureAbsence] getForStudent failed:', error)
      return []
    }
    return data ?? []
  },
})
