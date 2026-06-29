// Pure helpers for the mentorship WhatsApp nudge (Mon–Fri rotation).
//
// Each mentor teacher is reminded daily to connect with a small set of their
// mentees. Mentees are picked round-robin: nobody is repeated until the whole
// roster has been covered, then a fresh round begins. Rotation state is DERIVED
// from the `mentor_nudges` event log (count of past nudges per mentee) — there
// is no stored queue, so adding/removing/reassigning a mentee self-heals.
//
// Round discipline: we only ever pick from the lowest nudge-count tier. When
// that tier has fewer than `n` mentees left (the tail of a round), the day is
// short rather than pulling next-round mentees forward early — matching the
// "new round starts post completion of one" rule.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export const MENTEES_PER_DAY = 2

function ordinal(day) {
  const j = day % 10, k = day % 100
  if (k >= 11 && k <= 13) return `${day}th`
  if (j === 1) return `${day}st`
  if (j === 2) return `${day}nd`
  if (j === 3) return `${day}rd`
  return `${day}th`
}

// '2026-06-22' → '22nd June 2026'. Empty string for unparseable input.
export function fmtNudgeDate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const [, y, mo, d] = m
  const monthName = MONTHS[Number(mo) - 1]
  if (!monthName) return ''
  return `${ordinal(Number(d))} ${monthName} ${Number(y)}`
}

// True Monday–Friday. Parsed as a local date (mirrors src/lib/timetable.js).
export function isNudgeDay(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const day = d.getDay() // 0 Sun … 6 Sat
  return day >= 1 && day <= 5
}

// The Asia/Kolkata (UTC+5:30) calendar date for a given instant, as YYYY-MM-DD.
// The cron fires in UTC; this gives the IST "send day" used for log keying.
export function istDateString(now) {
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000)
  const y = ist.getUTCFullYear()
  const mo = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const d = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

// Pick the mentees to nudge for one teacher today.
//   mentees  : [{ lwsId, name }]  — the teacher's CURRENT active mentees
//   nudgeLog : [{ lwsId, date }]  — past nudges for THIS teacher
//   opts     : { n=3, today, rng=Math.random }
// Returns up to `n` mentee objects (fewer at a round's tail or when already
// partially sent today). Idempotent: re-running after a full day's send → [].
export function pickDailyMentees(mentees, nudgeLog, { n = MENTEES_PER_DAY, today, rng = Math.random } = {}) {
  if (!Array.isArray(mentees) || mentees.length === 0) return []
  const log = Array.isArray(nudgeLog) ? nudgeLog : []

  // How many times each mentee has been nudged (= rounds served).
  const count = new Map()
  const doneToday = new Set()
  for (const e of log) {
    if (!e || !e.lwsId) continue
    count.set(e.lwsId, (count.get(e.lwsId) || 0) + 1)
    if (today && e.date === today) doneToday.add(e.lwsId)
  }

  const remaining = n - doneToday.size
  if (remaining <= 0) return []

  const candidates = mentees.filter(m => !doneToday.has(m.lwsId))
  if (candidates.length === 0) return []

  // Only the lowest-count tier is eligible — strict round discipline.
  const minCount = Math.min(...candidates.map(m => count.get(m.lwsId) || 0))
  const tier = candidates.filter(m => (count.get(m.lwsId) || 0) === minCount)

  // Random selection within the tier (stable-sort on an rng key).
  return tier
    .map(m => ({ m, r: rng() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, remaining)
    .map(d => d.m)
}
