// Days with no class, and the one rule every attendance % uses to skip them.
//
// The LWS register export marks EVERY student 'A' on a holiday, so a holiday
// left in the data reads as a day the whole branch skipped: in Jan 2026 the
// LWS Pune average fell from 82% to 68% on three such days. Rather than delete
// those rows, every reader drops a student's row on their day off — so removing
// a holiday restores the numbers exactly.
//
// A day is off for a student when it is:
//   • a Sunday — for everyone, by rule (never stored), or
//   • inside a holiday (attendance_holidays) for the student's branch, where the
//     holiday covers the whole branch (batchNames empty) or EVERY batch the
//     student is in. A student in two batches with one still in class was in
//     class, so their row still counts.
//
// Dependency-free on purpose: api/student-login.js and
// api/send-attendance-alerts.js import this file under Node's ESM loader.

export const MAX_HOLIDAY_SPAN_DAYS = 92 // mirrors the attendance_holidays CHECK

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// 'YYYY-MM-DD' → UTC epoch ms of that calendar date, or null when it is not a
// real date (2026-02-30 included). Read from the digits — `new Date(iso)` would
// do the same here, but the explicit check also rejects rolled-over dates.
function isoToUtcMs(iso) {
  const m = ISO_RE.exec(String(iso ?? ''))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return ms
}

const DAY_MS = 86400000

export function normalizeHolidayRow(row) {
  return {
    id: row.id,
    name: row.name,
    fromDate: row.from_date,
    toDate: row.to_date,
    branch: row.branch,
    batchNames: Array.isArray(row.batch_names) ? row.batch_names : [],
    createdBy: row.created_by ?? null,
  }
}

export function isSunday(iso) {
  const ms = isoToUtcMs(iso)
  return ms !== null && new Date(ms).getUTCDay() === 0
}

function covers(holiday, student) {
  if (!student?.branch || holiday.branch !== student.branch) return false
  if (!holiday.batchNames?.length) return true
  const batches = student.batches || []
  return batches.length > 0 && batches.every(b => holiday.batchNames.includes(b))
}

// 'Sunday', the covering holiday's name, or null for a working day.
export function dayOffReason(holidays, student, iso) {
  if (isSunday(iso)) return 'Sunday'
  for (const h of holidays || []) {
    if (iso >= h.fromDate && iso <= h.toDate && covers(h, student)) return h.name
  }
  return null
}

// (lwsId, iso) → reason | null, over a lwsId → { branch, batches } index. An
// unknown student still gets Sundays off.
export function makeDayOff(holidays, studentsByLwsId) {
  return (lwsId, iso) => dayOffReason(holidays, studentsByLwsId?.get(lwsId) ?? null, iso)
}

export function studentIndexFromProfiles(studentProfiles) {
  const idx = new Map()
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key || !p.lwsId) continue // skip variant-keyed entries
    if (!idx.has(p.lwsId)) idx.set(p.lwsId, { branch: p.branch || '', batches: p.batches || [] })
  }
  return idx
}

// One student's rows ({ date, … }).
export function filterWorkingDays(rows, holidays, student) {
  return (rows || []).filter(r => !dayOffReason(holidays, student, r.date))
}

// Many students' rows ({ lws_id, date?, … }). `date` is for one-day reads whose
// rows carry no date column.
export function filterWorkingDaysByStudent(rows, dayOff, date = null) {
  return (rows || []).filter(r => !dayOff(r.lws_id, r.date ?? date))
}

// The student's holidays overlapping [from, to], clipped to it, in date order.
// Sundays are not listed — a parent does not need telling.
export function holidaysInRange(holidays, student, from, to) {
  const seen = new Set()
  const out = []
  for (const h of holidays || []) {
    if (h.toDate < from || h.fromDate > to || !covers(h, student)) continue
    const item = {
      name: h.name,
      fromDate: h.fromDate < from ? from : h.fromDate,
      toDate: h.toDate > to ? to : h.toDate,
    }
    const key = `${item.name}|${item.fromDate}|${item.toDate}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.name.localeCompare(b.name))
}

function dayMonth(iso) {
  const [, , m, d] = ISO_RE.exec(iso)
  return { d: Number(d), mon: MONTHS[Number(m) - 1] }
}

// '15 Aug Independence Day, 25-26 Sep Ganesh, 30 Sep-2 Oct Break'. Plain ASCII
// hyphen: this lands in a WinAnsi-only PDF. `names: false` prints dates only.
export function formatHolidayList(list, { names = true } = {}) {
  return (list || []).map(h => {
    const a = dayMonth(h.fromDate)
    const b = dayMonth(h.toDate)
    let when
    if (h.fromDate === h.toDate) when = `${a.d} ${a.mon}`
    else if (a.mon === b.mon) when = `${a.d}-${b.d} ${a.mon}`
    else when = `${a.d} ${a.mon}-${b.d} ${b.mon}`
    return names ? `${when} ${h.name}` : when
  }).join(', ')
}

// Form input → insert rows, one per branch, or { error } in words a person can
// act on. Mirrors the table's CHECKs so a bad entry is refused before the call.
//   { name, fromDate, toDate?, scopes: [{ branch, batchNames: [] = whole branch }] }
export function buildHolidayRows({ name, fromDate, toDate, scopes } = {}) {
  const cleanName = String(name ?? '').trim()
  if (!cleanName) return { error: 'Give the holiday a name.' }
  const to = toDate || fromDate
  const fromMs = isoToUtcMs(fromDate)
  const toMs = isoToUtcMs(to)
  if (fromMs === null || toMs === null) return { error: 'Pick a valid date.' }
  if (toMs < fromMs) return { error: 'The "to" date is before the "from" date.' }
  if ((toMs - fromMs) / DAY_MS > MAX_HOLIDAY_SPAN_DAYS) {
    return { error: `A holiday can span at most ${MAX_HOLIDAY_SPAN_DAYS} days — check the year.` }
  }
  const list = (scopes || []).filter(s => s?.branch)
  if (list.length === 0) return { error: 'Choose at least one branch.' }
  const branches = list.map(s => s.branch)
  if (new Set(branches).size !== branches.length) return { error: 'A branch is listed twice.' }
  return {
    rows: list.map(s => ({
      name: cleanName,
      from_date: fromDate,
      to_date: to,
      branch: s.branch,
      batch_names: [...(s.batchNames || [])],
    })),
  }
}

// Upcoming (ends today or later) soonest first; past most recent first.
export function splitHolidays(holidays, todayIso) {
  const upcoming = []
  const past = []
  for (const h of holidays || []) (h.toDate >= todayIso ? upcoming : past).push(h)
  upcoming.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.branch.localeCompare(b.branch))
  past.sort((a, b) => b.fromDate.localeCompare(a.fromDate) || a.branch.localeCompare(b.branch))
  return { upcoming, past }
}
