import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// The five capturable hostel/mess checkpoints (the `class` checkpoint in the
// chain view is derived from student_attendance, never captured here).
export const CAPTURE_CHECKPOINTS = ['hostel_am', 'breakfast', 'lunch', 'dinner', 'hostel_pm']
// Roll checkpoints carry a reconciliation gate; meals are exception-only.
export const ROLL_CHECKPOINTS = ['hostel_am', 'hostel_pm']
// Exception statuses the marking board can write. 'leave' lives in the leaves
// table (whole-window explanation); a single-checkpoint deviation uses these.
export const CHECKPOINT_STATUSES = ['absent', 'sick', 'outpass']

export const createCheckpointSlice = (_set, _get) => ({
  // Replace the full exception set for one (date, checkpoint) card. Delete-then-
  // insert keeps "save this checkpoint" atomic from the caller's view — the same
  // pattern as setLectureAbsenteesForPeriod. `exceptions` is [{lwsId, status?, note?}];
  // an empty array clears the checkpoint (everyone present). Deduped by lwsId,
  // last write wins.
  async setCheckpointExceptions(date, checkpoint, exceptions) {
    if (!date || !CAPTURE_CHECKPOINTS.includes(checkpoint) || !Array.isArray(exceptions)) return false
    for (const e of exceptions) {
      if (!e?.lwsId) return false
      if (e.status != null && !CHECKPOINT_STATUSES.includes(e.status)) return false
    }
    const session = await getSession()
    if (!session) return false

    const { error: delError } = await supabase
      .from('checkpoint_absences')
      .delete()
      .eq('date', date)
      .eq('checkpoint', checkpoint)
    if (delError) {
      console.error('[checkpoint] delete failed:', delError)
      return false
    }

    if (exceptions.length === 0) return true

    // Dedupe by lwsId, last write wins.
    const byId = new Map()
    for (const e of exceptions) byId.set(e.lwsId, e)
    const createdBy = session.user?.email ?? null
    const rows = [...byId.values()].map(e => ({
      lws_id: e.lwsId, date, checkpoint,
      status: e.status ?? 'absent',
      note: e.note ?? null,
      created_by: createdBy,
    }))
    const { error: insError } = await supabase
      .from('checkpoint_absences')
      .insert(rows)
    if (insError) {
      console.error('[checkpoint] insert failed:', insError)
      return false
    }
    return true
  },

  // All checkpoint exception rows for a date (across checkpoints). The chain
  // aggregator groups them by (lws_id, checkpoint).
  async getCheckpointExceptionsForDate(date) {
    if (!date) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('checkpoint_absences')
      .select('lws_id, date, checkpoint, status, note, created_at')
      .eq('date', date)
    if (error) {
      console.error('[checkpoint] getForDate failed:', error)
      return []
    }
    return data ?? []
  },

  // Record a roll reconciliation. reconciled = the warden's physical headcount
  // (confirmedPresent) equals expected minus the exceptions on file. A mismatch
  // is persisted as reconciled=false — an OPEN incident the anomaly board surfaces.
  async confirmRoll(date, checkpoint, { expectedCount, exceptionCount, confirmedPresent, branch = 'APJ' }) {
    if (!date || !ROLL_CHECKPOINTS.includes(checkpoint)) return false
    const session = await getSession()
    if (!session) return false
    const reconciled = confirmedPresent === expectedCount - exceptionCount
    const row = {
      date, checkpoint, branch,
      expected_count: expectedCount,
      exception_count: exceptionCount,
      confirmed_present: confirmedPresent,
      reconciled,
      confirmed_by: session.user?.email ?? null,
    }
    const { error } = await supabase
      .from('checkpoint_confirmations')
      .upsert(row, { onConflict: 'date,checkpoint,branch' })
    if (error) {
      console.error('[checkpoint] confirmRoll failed:', error)
      return false
    }
    return true
  },

  // Roll confirmations for a date — the anomaly board reads these to show which
  // rolls are unreconciled / not yet done.
  async getConfirmationsForDate(date) {
    if (!date) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('checkpoint_confirmations')
      .select('date, checkpoint, branch, expected_count, exception_count, confirmed_present, reconciled, confirmed_by, confirmed_at')
      .eq('date', date)
    if (error) {
      console.error('[checkpoint] getConfirmationsForDate failed:', error)
      return []
    }
    return data ?? []
  },
})
