import { supabase } from '../../lib/supabase'
import { getSession } from './session'
import { buildHolidayRows, normalizeHolidayRow } from '../../lib/holidays'

// attendance_holidays — the days off every attendance % skips (see
// src/lib/holidays.js). Supabase-only, like student_attendance itself: with no
// session there is no register to correct either.
//
// Not persisted (no saveToStorage entry): the table is authoritative, and a
// stale copy in faculty_state would be a second source to disagree with.
export const createHolidaysSlice = (set, get) => {
  // Several screens ask on the same mount (rings + Dashboard widgets); share
  // one read rather than racing three.
  let inflight = null

  async function readHolidays() {
    const session = await getSession()
    if (!session) return false
    const { data, error } = await supabase
      .from('attendance_holidays')
      .select('id, name, from_date, to_date, branch, batch_names, created_by')
      .order('from_date', { ascending: true })
    if (error) {
      console.error('[holidays] loadHolidays failed:', error)
      return false
    }
    set({ holidays: (data ?? []).map(normalizeHolidayRow), holidaysLoaded: true })
    return true
  }

  return {
    holidays: [],
    holidaysLoaded: false,

    loadHolidays() {
      if (!inflight) inflight = readHolidays().finally(() => { inflight = null })
      return inflight
    },

    // { name, fromDate, toDate?, scopes: [{ branch, batchNames }] } → { ok, error? }
    async addHolidays(input) {
      const built = buildHolidayRows(input)
      if (built.error) return { ok: false, error: built.error }
      const session = await getSession()
      if (!session) return { ok: false, error: 'Sign in to add holidays.' }
      const createdBy = session.user?.email ?? null
      const { error } = await supabase
        .from('attendance_holidays')
        .insert(built.rows.map(r => ({ ...r, created_by: createdBy })))
      if (error) {
        console.error('[holidays] addHolidays failed:', error)
        return { ok: false, error: 'Could not save the holiday. Try again.' }
      }
      await get().loadHolidays()
      return { ok: true }
    },

    async deleteHoliday(id) {
      if (!id) return false
      const session = await getSession()
      if (!session) return false
      const { error } = await supabase.from('attendance_holidays').delete().eq('id', id)
      if (error) {
        console.error('[holidays] deleteHoliday failed:', error)
        return false
      }
      set(s => ({ holidays: s.holidays.filter(h => h.id !== id) }))
      return true
    },
  }
}
