import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

const TABLE = 'lecture_submissions'
const COLS = 'id, date, slot_id, batch_name, subject, teacher_id, absent_count, submitted_by, submitted_at, source'

// Filing records for the /school-attendance capture flow.
//
// lecture_absences is an EXCEPTION log — no row means "present". That makes
// "the teacher filed and nobody was absent" and "the teacher never filed"
// identical at rest. This table carries the difference: one row per period
// that was actually accounted for. Everything that reports on filing
// compliance reads `filed` from here, never from an absentee count.
export const createSubmissionSlice = (_set, _get) => ({
  // Mark one period as filed. Idempotent on (date, slot_id, batch_name), so
  // re-editing a period updates the count instead of stacking rows.
  async submitLecture({ date, slotId, batchName, subject = null, teacherId = null, absentCount = 0, source = 'teacher' }) {
    if (!date || !slotId || !batchName) return false
    const session = await getSession()
    if (!session) return false

    const { error } = await supabase.from(TABLE).upsert({
      date,
      slot_id: slotId,
      batch_name: batchName,
      subject,
      teacher_id: teacherId,
      absent_count: Number(absentCount) || 0,
      submitted_by: session.user?.email ?? null,
      // Explicit, not the column default: on the UPDATE half of an upsert the
      // default never re-applies, so a re-file would keep the original stamp.
      submitted_at: new Date().toISOString(),
      source,
    }, { onConflict: 'date,slot_id,batch_name' })

    if (error) { console.error('[submissions] submitLecture failed:', error); return false }
    return true
  },

  // Un-file one period. Only ever used to delete an EXTRA (ad-hoc) class —
  // a timetabled period can be re-filed but never un-happen.
  //
  // Deleting the absentees alone is not enough: the teacher page rebuilds
  // ad-hoc cards FROM this table, so an orphaned filing row resurrects a class
  // that was explicitly deleted. Callers clear lecture_absences first and only
  // reach here if that succeeded — a filing outliving its absentees would claim
  // the period is accounted for when the data behind it is gone.
  //
  // Every part of the key is required. Batch is not decoration: two batches can
  // legitimately share a slot id, so a delete missing it would widen to another
  // batch's filing for the same period.
  async deleteLectureSubmission(date, slotId, batchName) {
    if (!date || !slotId || !batchName) return false
    const session = await getSession()
    if (!session) return false

    const { error } = await supabase.from(TABLE)
      .delete()
      .eq('date', date)
      .eq('slot_id', slotId)
      .eq('batch_name', batchName)

    if (error) { console.error('[submissions] deleteLectureSubmission failed:', error); return false }
    return true
  },

  // All filings for one date (across batches). Callers pair these with the
  // day's lectures via withFilingStatus (src/lib/teacherDay.js).
  async getSubmissionsForDate(date) {
    if (!date) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase.from(TABLE).select(COLS).eq('date', date)
    if (error) { console.error('[submissions] getForDate failed:', error); return [] }
    return data ?? []
  },
})
