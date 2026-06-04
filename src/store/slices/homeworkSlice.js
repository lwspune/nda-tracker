import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

const TABLE = 'homework_pending'
const VALID_TYPES = ['homework', 'notes', 'both']
const COLS = 'id, lws_id, date, subject, chapter, type, resolved_at, notified_at'

// Homework / notes "incomplete work" flow. A sparse event log mirroring
// lecture_absences, with one extra dimension (chapter) and a resolution stamp
// (resolved_at) so faculty can close an item once the student finally submits.
// The original event is never deleted by resolving — only stamped.
export const createHomeworkSlice = (_set, _get) => ({
  // Reconcile the defaulter set for ONE homework item (date, subject, chapter,
  // type). Deliberately NOT the blind delete-then-insert that lecture_absences
  // uses: existing rows for students who remain in the set are left untouched,
  // so their resolved_at stamp survives a card re-edit. Only un-ticked students
  // are deleted; only newly-ticked students are inserted.
  async setHomeworkDefaultersForItem(date, subject, chapter, type, lwsIds) {
    if (!date || !subject || !chapter || !type || !Array.isArray(lwsIds)) return false
    if (!VALID_TYPES.includes(type)) return false
    const session = await getSession()
    if (!session) return false

    const { data: existing, error: selErr } = await supabase
      .from(TABLE)
      .select('id, lws_id')
      .eq('date', date)
      .eq('subject', subject)
      .eq('chapter', chapter)
      .eq('type', type)
    if (selErr) { console.error('[homework] select failed:', selErr); return false }

    const target = new Set(lwsIds)
    const existingByLws = new Map((existing ?? []).map(r => [r.lws_id, r.id]))

    const toDelete = (existing ?? []).filter(r => !target.has(r.lws_id)).map(r => r.id)
    if (toDelete.length) {
      const { error: delErr } = await supabase.from(TABLE).delete().in('id', toDelete)
      if (delErr) { console.error('[homework] delete failed:', delErr); return false }
    }

    const createdBy = session.user?.email ?? null
    const toInsert = [...target]
      .filter(lws => !existingByLws.has(lws))
      .map(lws_id => ({ lws_id, date, subject, chapter, type, created_by: createdBy }))
    if (toInsert.length) {
      const { error: insErr } = await supabase.from(TABLE).insert(toInsert)
      if (insErr) { console.error('[homework] insert failed:', insErr); return false }
    }
    return true
  },

  // Stamp an item as resolved (student submitted). Row stays in the log.
  async resolveHomeworkItem(id) {
    if (!id) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase.from(TABLE)
      .update({ resolved_at: new Date().toISOString(), resolved_by: session.user?.email ?? null })
      .eq('id', id)
    if (error) { console.error('[homework] resolve failed:', error); return false }
    return true
  },

  // Clear a resolution stamp (re-open an item).
  async reopenHomeworkItem(id) {
    if (!id) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase.from(TABLE)
      .update({ resolved_at: null, resolved_by: null })
      .eq('id', id)
    if (error) { console.error('[homework] reopen failed:', error); return false }
    return true
  },

  // All rows for a date (across batches). Caller filters to the batch's students
  // client-side, same as LectureLogTab does with lecture_absences.
  async getHomeworkForDate(date) {
    if (!date) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase.from(TABLE).select(COLS).eq('date', date)
    if (error) { console.error('[homework] getForDate failed:', error); return [] }
    return data ?? []
  },

  // Unresolved items only, optionally scoped to a batch's students — drives the
  // "open items" resolution list (resolve-later workflow without date hunting).
  async getOpenHomeworkForBatch(lwsIds) {
    const session = await getSession()
    if (!session) return []
    let query = supabase.from(TABLE).select(COLS).is('resolved_at', null)
    if (Array.isArray(lwsIds) && lwsIds.length) query = query.in('lws_id', lwsIds)
    query = query.order('date', { ascending: false })
    const { data, error } = await query
    if (error) { console.error('[homework] getOpenForBatch failed:', error); return [] }
    return data ?? []
  },

  // Per-student history for the RecentIncidents strip / student portal.
  async getHomeworkForStudent(lwsId, sinceDate = null) {
    if (!lwsId) return []
    const session = await getSession()
    if (!session) return []
    let query = supabase.from(TABLE).select(COLS).eq('lws_id', lwsId)
    if (sinceDate) query = query.gte('date', sinceDate)
    query = query.order('date', { ascending: false })
    const { data, error } = await query
    if (error) { console.error('[homework] getForStudent failed:', error); return [] }
    return data ?? []
  },

  // Stamp notified_at after a successful parent WhatsApp send (client-side,
  // mirrors examAbsenceSlice.markExamAbsencesNotified).
  async markHomeworkNotified(ids) {
    if (!Array.isArray(ids) || !ids.length) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase.from(TABLE)
      .update({ notified_at: new Date().toISOString() })
      .in('id', ids)
    if (error) { console.error('[homework] markNotified failed:', error); return false }
    return true
  },
})
