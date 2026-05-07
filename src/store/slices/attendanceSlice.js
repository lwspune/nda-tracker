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
    if (records.length > 0) {
      const session = await getSession()
      if (session) {
        const { error } = await supabase
          .from('student_attendance')
          .upsert(records, { onConflict: 'lws_id,date' })
        if (error) console.error('[attendance] upsert failed:', error)
        else upserted = records.length
      }
    }

    return { matched, unmatched, upserted }
  },
})
