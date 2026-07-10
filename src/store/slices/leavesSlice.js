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
  // Grant a leave. `fromTs` is an ISO timestamp. `toTs` is OPTIONAL — omitted or
  // empty means an OPEN-ENDED leave (to_ts null → "still out, until closed"),
  // the persist-until-return model. Stamped with the approving admin's email.
  async addLeave({ lwsId, fromTs, toTs, type = 'leave', reason = null }) {
    if (!lwsId || !fromTs) return false
    if (!LEAVE_TYPES.includes(type)) return false
    const to = (toTs == null || toTs === '') ? null : toTs
    if (to != null && new Date(to).getTime() < new Date(fromTs).getTime()) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('leaves')
      .insert({
        lws_id: lwsId,
        from_ts: fromTs,
        to_ts: to,
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
      // … and ends on/after the day starts OR is open-ended (to_ts null → still
      // out). The null branch is load-bearing: without it, open-ended leaves are
      // silently dropped and their boarders flag as unexplained absences.
      .or(`to_ts.is.null,to_ts.gte.${dayStartIso}`)
    if (error) {
      console.error('[leaves] getActiveLeaves failed:', error)
      return []
    }
    return data ?? []
  },

  // Close/shorten a leave by stamping its to_ts — the boarder returned. Unlike
  // deleteLeave (erase), this preserves that the student WAS on leave up to the
  // return moment. This is how an open-ended leave gets bounded so it stops
  // masking future checkpoints.
  async endLeave(id, toTs) {
    if (!id || !toTs) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase.from('leaves').update({ to_ts: toTs }).eq('id', id)
    if (error) {
      console.error('[leaves] endLeave failed:', error)
      return false
    }
    return true
  },

  // Revoke a leave outright (e.g. entered in error). Use endLeave to record a
  // real return; use this only to erase a mistaken row.
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
