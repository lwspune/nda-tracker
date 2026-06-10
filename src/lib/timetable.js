// Pure helpers for reading timetable data.
// The grid shape is owned by src/store/slices/timetableSlice.js:
//   grid[slotId][day]   = { type: 'class', mappingId } | { type: 'break', label }
//   grid[slotId].__span = { type: 'span', label }   // full-row span (e.g. lunch)

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function parseTimeToMinutes(str) {
  if (!str) return 0
  const s = String(str).trim().toUpperCase()
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = parseInt(m12[2], 10)
    if (min >= 60 || h < 1 || h > 12) return 0
    if (m12[3] === 'PM' && h !== 12) h += 12
    if (m12[3] === 'AM' && h === 12) h = 0
    return h * 60 + min
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10), min = parseInt(m24[2], 10)
    if (h > 23 || min >= 60) return 0
    return h * 60 + min
  }
  return 0
}

function resolveDayName(date) {
  if (!date) return null
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null
    return DAY_NAMES[date.getDay()]
  }
  // ISO YYYY-MM-DD: parse as local date so getDay() returns the local weekday.
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return DAY_NAMES[d.getDay()]
  }
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return DAY_NAMES[d.getDay()]
}

// Returns ordered list of today's class periods for the given timetable.
// Each entry: { slotId, startTime, endTime, subject, mappingId, label }
// Skips breaks, __span rows, and class cells whose mapping doesn't exist.
// Returns [] for Sunday, missing timetable, or empty timeSlots.
export function getTodaysLectures(timetable, date, mappings) {
  if (!timetable || !Array.isArray(timetable.timeSlots) || timetable.timeSlots.length === 0) return []
  const dayName = resolveDayName(date)
  if (!dayName || dayName === 'Sunday') return []

  const mappingById = new Map((mappings ?? []).map(m => [m.id, m]))
  const grid = timetable.grid ?? {}

  const slots = [...timetable.timeSlots].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  )

  const results = []
  for (const slot of slots) {
    const row = grid[slot.id]
    if (!row) continue
    if (row.__span) continue
    const cell = row[dayName]
    if (!cell || cell.type !== 'class') continue
    const mapping = mappingById.get(cell.mappingId)
    if (!mapping) continue
    results.push({
      slotId: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subject: mapping.subject ?? null,
      mappingId: mapping.id,
      label: mapping.label,
    })
  }
  return results
}

// Pivots scheduled class hours by subject (rows) across batches/timetables
// (columns) — the subject-side analogue of the Teacher Schedule's hours roll-up.
// Walks every class cell (type:'class' with a resolvable mapping) and adds the
// slot's duration in hours for each day it runs, grouped by the mapping's
// `subject`. Granular labels collapse into their shared subject (Maths PYQs +
// Maths → "Maths"); a mapping without a subject buckets under "Unspecified".
// Breaks, __span rows and unresolved mappings are excluded (same rules as
// getTodaysLectures). Pass { branch } to restrict the columns to one branch.
//
// Returns:
//   {
//     batches: [{ id, branch, batchName }],      // columns, in input order
//     subjects: [string],                         // rows, total hours desc then name asc
//     cell: { [subject]: { [batchId]: hours } },  // sparse (only nonzero)
//     batchTotals: { [batchId]: hours },
//     subjectTotals: { [subject]: hours },
//     grandTotal: hours,
//   }
export function getSubjectHoursByBatch(timetables, mappings, { branch } = {}) {
  const empty = { batches: [], subjects: [], cell: {}, batchTotals: {}, subjectTotals: {}, grandTotal: 0 }
  if (!Array.isArray(timetables)) return empty

  const mappingById = new Map((mappings ?? []).map(m => [m.id, m]))
  const cols = timetables.filter(tt => tt && (!branch || tt.branch === branch))

  const cell = {}
  const batchTotals = {}
  const subjectTotals = {}
  let grandTotal = 0

  for (const tt of cols) {
    batchTotals[tt.id] = 0
    const grid = tt.grid ?? {}
    for (const slot of tt.timeSlots ?? []) {
      const row = grid[slot.id]
      if (!row || row.__span) continue
      const mins = parseTimeToMinutes(slot.endTime) - parseTimeToMinutes(slot.startTime)
      if (mins <= 0) continue
      const hours = mins / 60
      for (const [day, c] of Object.entries(row)) {
        if (day === '__span') continue
        if (!c || c.type !== 'class') continue
        const mapping = mappingById.get(c.mappingId)
        if (!mapping) continue
        const subject = mapping.subject || 'Unspecified'
        if (!cell[subject]) cell[subject] = {}
        cell[subject][tt.id] = (cell[subject][tt.id] ?? 0) + hours
        subjectTotals[subject] = (subjectTotals[subject] ?? 0) + hours
        batchTotals[tt.id] += hours
        grandTotal += hours
      }
    }
  }

  const subjects = Object.keys(subjectTotals).sort(
    (a, b) => (subjectTotals[b] - subjectTotals[a]) || a.localeCompare(b)
  )

  return {
    batches: cols.map(tt => ({ id: tt.id, branch: tt.branch, batchName: tt.batchName })),
    subjects,
    cell,
    batchTotals,
    subjectTotals,
    grandTotal,
  }
}
