import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// A leave/out-pass is the honesty mechanism behind default-present: an active
// leave explains a boarder's absence at EVERY checkpoint inside its window, so
// those gaps are not anomalies. Whole-window (multi-checkpoint / multi-day);
// a single-checkpoint deviation is captured as an 'outpass' checkpoint status
// instead (see checkpointSlice).
export const LEAVE_TYPES = ['leave', 'outpass', 'medical']

export const createLeavesSlice = (_set, _get) => ({
  // Grant a leave. `fromTs`/`toTs` are ISO timestamps. Stamped with the
  // approving admin's email.
  async addLeave({ lwsId, fromTs, toTs, type = 'leave', reason = null }) {
    if (!lwsId || !fromTs || !toTs) return false
    if (!LEAVE_TYPES.includes(type)) return false
    if (new Date(toTs).getTime() < new Date(fromTs).getTime()) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('leaves')
      .insert({
        lws_id: lwsId,
        from_ts: fromTs,
        to_ts: toTs,
        type,
        reason,
        approved_by: session.user?.email ?? null,
      })
    if (error) {
      console.error('[leaves] addLeave failed:', error)
      return false
    }
    return true
  },

  // Leaves overlapping [dayStartIso, dayEndIso]. The chain consumer maps these
  // to { lwsId, fromMs, toMs } and runs resolveOnLeave for the exact overlap.
  async getActiveLeaves(dayStartIso, dayEndIso) {
    if (!dayStartIso || !dayEndIso) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('leaves')
      .select('id, lws_id, from_ts, to_ts, type, reason, approved_by, created_at')
      .lte('from_ts', dayEndIso)   // starts on/before the day ends …
      .gte('to_ts', dayStartIso)   // … and ends on/after the day starts → overlap
    if (error) {
      console.error('[leaves] getActiveLeaves failed:', error)
      return []
    }
    return data ?? []
  },

  // Revoke a leave outright (e.g. entered in error). Ending a leave early is a
  // future refinement (set to_ts) — for now a leave is present or absent.
  async deleteLeave(id) {
    if (!id) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase.from('leaves').delete().eq('id', id)
    if (error) {
      console.error('[leaves] deleteLeave failed:', error)
      return false
    }
    return true
  },
})
