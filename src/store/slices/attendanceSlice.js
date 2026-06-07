import { supabase } from '../../lib/supabase'

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Normalise to bare 10-digit form for comparison.
// Handles: 10-digit, 0-prefixed 11-digit, 91-prefixed 12-digit.
function normalizeMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  return digits
}

export const createAttendanceSlice = (set, get) => ({
  async importAttendance(parsed) {
    const { studentProfiles } = get()

    // Build normalised-mobile → lwsId map from unique profiles
    const mobileToLwsId = {}
    const seen = new Set()
    for (const profile of Object.values(studentProfiles)) {
      if (!profile.lwsId || seen.has(profile.lwsId)) continue
      seen.add(profile.lwsId)
      const norm = normalizeMobile(profile.mobile)
      if (norm) mobileToLwsId[norm] = profile.lwsId
    }

    const records = []
    let matched = 0, unmatched = 0

    for (const s of parsed.students) {
      const normMobile = normalizeMobile(s.mobile)
      let lwsId = mobileToLwsId[normMobile]

      if (!lwsId) {
        // Name fallback: studentProfiles is indexed by both canonical + variant names
        lwsId = studentProfiles[s.name]?.lwsId
      }

      if (!lwsId) { unmatched++; continue }
      matched++

      for (const [date, status] of Object.entries(s.dates)) {
        records.push({ lws_id: lwsId, date, status })
      }
    }

    let upserted = 0
    let lateProtected = 0
    if (records.length > 0) {
      const session = await getSession()
      if (session) {
        // Protect existing L (late) markings — XLS doesn't carry the L symbol,
        // so re-importing today's attendance would otherwise overwrite L → P/A.
        const dates  = [...new Set(records.map(r => r.date))]
        const lwsIds = [...new Set(records.map(r => r.lws_id))]
        const { data: lateRows, error: selectError } = await supabase
          .from('student_attendance')
          .select('lws_id, date')
          .eq('status', 'L')
          .in('lws_id', lwsIds)
          .in('date', dates)
        if (selectError) console.error('[attendance] L-protection select failed:', selectError)
        const lateKeys = new Set((lateRows ?? []).map(r => `${r.lws_id}|${r.date}`))
        const filtered = records.filter(r => !lateKeys.has(`${r.lws_id}|${r.date}`))
        lateProtected = records.length - filtered.length

        if (filtered.length > 0) {
          const { error } = await supabase
            .from('student_attendance')
            .upsert(filtered, { onConflict: 'lws_id,date' })
          if (error) console.error('[attendance] upsert failed:', error)
          else upserted = filtered.length
        }
      }
    }

    return { matched, unmatched, upserted, lateProtected }
  },

  // Marks a student as late (L) for a given date. Replaces any existing P/A row.
  async markLate(lwsId, date) {
    if (!lwsId || !date) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('student_attendance')
      .upsert({ lws_id: lwsId, date, status: 'L' }, { onConflict: 'lws_id,date' })
    if (error) {
      console.error('[attendance] markLate failed:', error)
      return false
    }
    return true
  },

  // Removes a late marking. Scoped to status='L' so we don't accidentally
  // delete an attendance P/A row in case the data drifted.
  async unmarkLate(lwsId, date) {
    if (!lwsId || !date) return false
    const session = await getSession()
    if (!session) return false
    const { error } = await supabase
      .from('student_attendance')
      .delete()
      .eq('lws_id', lwsId)
      .eq('date', date)
      .eq('status', 'L')
    if (error) {
      console.error('[attendance] unmarkLate failed:', error)
      return false
    }
    return true
  },

  // Loads one day's attendance for the Dashboard roll-up.
  // `date === null` → resolves to the latest recorded date first.
  // Returns { date, rows: [{ lws_id, status }] } (paginated; rows can exceed 1000).
  // No session (dev/teacher-less) → { date: null, rows: [] }.
  async fetchDailyAttendance(date = null) {
    const session = await getSession()
    if (!session) return { date: null, rows: [] }

    let targetDate = date
    if (!targetDate) {
      const { data, error } = await supabase
        .from('student_attendance')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
      if (error) {
        console.error('[attendance] latest-date lookup failed:', error)
        return { date: null, rows: [] }
      }
      targetDate = data?.[0]?.date ?? null
    }
    if (!targetDate) return { date: null, rows: [] }

    const PAGE = 1000
    let from = 0
    const rows = []
    while (true) {
      const { data, error } = await supabase
        .from('student_attendance')
        .select('lws_id, status')
        .eq('date', targetDate)
        .range(from, from + PAGE - 1)
      if (error) { console.error('[attendance] fetchDailyAttendance failed:', error); break }
      if (!data?.length) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return { date: targetDate, rows }
  },

  // Bulk reads for the Dashboard "attendance leaders" widget, windowed to
  // `sinceIso` (YYYY-MM-DD). Returns raw rows; ranking happens in the pure
  // buildAttendanceLeaders aggregator. Paginated (attendance can exceed 1000).
  // No session → empty rows.
  async fetchAttendanceLeadersData(sinceIso) {
    const session = await getSession()
    if (!session) return { attendanceRows: [], lectureRows: [], homeworkRows: [] }

    const readAll = async (build) => {
      const PAGE = 1000
      let from = 0
      const out = []
      while (true) {
        const { data, error } = await build().range(from, from + PAGE - 1)
        if (error) { console.error('[attendance] leaders read failed:', error); break }
        if (!data?.length) break
        out.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      return out
    }

    const attendanceRows = await readAll(() => supabase
      .from('student_attendance').select('lws_id, status')
      .in('status', ['A', 'L']).gte('date', sinceIso))
    const lectureRows = await readAll(() => supabase
      .from('lecture_absences').select('lws_id').gte('date', sinceIso))
    const homeworkRows = await readAll(() => supabase
      .from('homework_pending').select('lws_id').gte('date', sinceIso))

    return { attendanceRows, lectureRows, homeworkRows }
  },

  // Returns lws_id[] for students marked late on the given date.
  async getLateStudentsForDate(date) {
    if (!date) return []
    const session = await getSession()
    if (!session) return []
    const { data, error } = await supabase
      .from('student_attendance')
      .select('lws_id')
      .eq('date', date)
      .eq('status', 'L')
    if (error) {
      console.error('[attendance] getLateStudentsForDate failed:', error)
      return []
    }
    return (data ?? []).map(r => r.lws_id)
  },
})
