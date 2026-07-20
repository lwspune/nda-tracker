// Pure builder for the monthly report card. Given a student profile, a date
// range (`from`/`to`, both 'YYYY-MM-DD', inclusive), and the relevant arrays
// (already filtered to this student where applicable), returns a sections object
// the PDF lib renders. Compute-on-demand — no persistence; re-running with the
// same inputs returns the same output.
//
// The range replaces the earlier single-'YYYY-MM' month. A whole-calendar-month
// range (1st → last day) still renders as "Jun 2026" (see rangeLabel) so the
// default previous-month report is visually unchanged.

import { examMaxMarks } from './analyticsHelpers'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(month /* 'YYYY-MM' */) {
  const [y, m] = month.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`
}

// 'YYYY-MM-DD' → 'YYYY-MM' (the month it falls in)
function monthOf(dateStr) {
  return dateStr.slice(0, 7)
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  if (m === 12) return `${y + 1}-01`
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

// Inclusive [from, to] window on ISO date strings (lexical compare is correct
// for zero-padded 'YYYY-MM-DD').
function inRange(dateStr, from, to) {
  return typeof dateStr === 'string' && dateStr >= from && dateStr <= to
}

// 'YYYY-MM' → 'YYYY-MM-31' (last day; handles month length + leap years).
function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(y, m, 0)   // day=0 of next month → last day of this month
  return `${y}-${String(m).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Human label for the range. Collapses an exact whole calendar month to
// "Jun 2026"; otherwise "5 Jan - 20 Jan 2026" (drops the year on the left when
// both ends share it), or "20 Dec 2025 - 5 Jan 2026" across a year boundary.
// ASCII hyphen only (WinAnsi-safe for the PDF).
function rangeLabel(from, to) {
  const fM = monthOf(from)
  if (fM === monthOf(to) && from === `${fM}-01` && to === lastDayOf(fM)) {
    return monthLabel(fM)
  }
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const left = fy === ty
    ? `${fd} ${MONTH_NAMES[fm - 1]}`
    : `${fd} ${MONTH_NAMES[fm - 1]} ${fy}`
  const right = `${td} ${MONTH_NAMES[tm - 1]} ${ty}`
  return `${left} - ${right}`
}

// 'YYYY-MM-DD' → 'D Mon' (e.g. '2026-01-03' → '3 Jan')
function shortDate(dateStr) {
  const [, m, d] = dateStr.split('-')
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1]}`
}

// Resolves the student's row inside exam.students[] using canonical name +
// all known nameVariants (case-sensitive, matches the existing lookup pattern).
function findEntry(exam, profile) {
  if (!exam.students?.length) return null
  const names = new Set([profile.name, ...(profile.nameVariants || [])].filter(Boolean))
  return exam.students.find(s => names.has(s.name)) || null
}

export function buildMonthlyReport({
  profile,
  from,
  to,
  exams,
  attendance,
  lectureAbsences,
  examAbsences,
  homework,
  batchChapterTimelines,
  syllabusPrograms,
}) {
  const batch = (profile.batches || [])[0] || ''
  const regDate = profile.regDate || ''

  // ── examTable ──────────────────────────────────────────────────────────
  const tableRows = []
  for (const exam of exams) {
    if (!inRange(exam.date, from, to)) continue
    if (regDate && exam.date < regDate) continue
    const entry = findEntry(exam, profile)
    if (entry) {
      const max = examMaxMarks(exam)
      tableRows.push({
        examId: exam.id,
        examName: exam.name,
        subject: exam.subject || '',
        date: exam.date,
        marks: entry.totalMarks,
        percentage: max > 0 ? Math.round((entry.totalMarks / max) * 100) : null,
        attended: true,
      })
    }
  }
  // Append ABSENT rows from exam_absences
  const examById = new Map(exams.map(e => [e.id, e]))
  for (const row of examAbsences || []) {
    const exam = examById.get(row.exam_id)
    if (!exam) continue
    if (!inRange(exam.date, from, to)) continue
    if (regDate && exam.date < regDate) continue
    tableRows.push({
      examId: exam.id,
      examName: exam.name,
      subject: exam.subject || '',
      date: exam.date,
      marks: null,
      percentage: null,
      attended: false,
    })
  }
  tableRows.sort((a, b) => a.date.localeCompare(b.date))

  // ── attendance ─────────────────────────────────────────────────────────
  let present = 0, absent = 0, late = 0
  const lateDates = []
  for (const row of attendance || []) {
    if (!inRange(row.date, from, to)) continue
    if (row.status === 'P') present++
    else if (row.status === 'A') absent++
    else if (row.status === 'L') { late++; lateDates.push(shortDate(row.date)) }
    // '-' and others ignored
  }
  const totalWorkingDays = present + absent + late
  const attendancePercentage = totalWorkingDays > 0
    ? Math.round(((present + late) / totalWorkingDays) * 100)
    : 0
  const missedLectureRows = (lectureAbsences || [])
    .filter(r => inRange(r.date, from, to))
    .map(r => ({ date: shortDate(r.date), subject: r.subject || '' }))

  // ── homework / notes flagged in the range (all flagged, resolved or not) ──
  const homeworkFlagged = (homework || [])
    .filter(r => inRange(r.date, from, to))
    .sort((a, b) => a.date.localeCompare(b.date))   // sort raw ISO before formatting
    .map(r => ({
      date: shortDate(r.date),
      subject: r.subject || '',
      chapter: r.chapter || '',
      type: r.type || '',
      resolved: !!r.resolved_at,
    }))

  // ── next month focus ───────────────────────────────────────────────────
  // Anchored to the month after the range's END month, so the default
  // previous-month report still surfaces the current teaching month.
  let nextMonthFocus = null
  if (batch) {
    const next = nextMonth(monthOf(to))
    const batchTimelines = (batchChapterTimelines || {})[batch] || {}
    const chapters = []
    for (const [programId, subjects] of Object.entries(batchTimelines)) {
      const program = (syllabusPrograms || []).find(p => p.id === programId)
      if (!program) continue
      for (const [subjectId, chaps] of Object.entries(subjects)) {
        const subject = (program.subjects || []).find(s => s.id === subjectId)
        if (!subject) continue
        for (const [chapterId, scheduledMonth] of Object.entries(chaps)) {
          if (scheduledMonth !== next) continue
          const chapter = (subject.chapters || []).find(c => c.id === chapterId)
          if (!chapter) continue
          chapters.push({ subject: subject.name || '', chapter: chapter.name || '' })
        }
      }
    }
    chapters.sort((a, b) =>
      a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter))
    if (chapters.length > 0) {
      nextMonthFocus = { monthLabel: monthLabel(next), chapters }
    }
  }

  return {
    meta: {
      lwsId: profile.lwsId || '',
      name: profile.name || '',
      rollNo: profile.rollNo || '',
      branch: profile.branch || '',
      batch,
      from,
      to,
      rangeLabel: rangeLabel(from, to),
    },
    examTable: tableRows,
    attendance: {
      present, absent, late,
      missedLectures: missedLectureRows.length,
      totalWorkingDays,
      attendancePercentage,
      lateDates,
      missedLectureDetails: missedLectureRows,
    },
    homeworkFlagged,
    nextMonthFocus,
  }
}

// Returns the list of student profiles that should receive a report for the
// given (batch, toDate). Cohort = Active accountStatus + batches[] contains
// batchName + regDate ≤ toDate (the range's inclusive end, 'YYYY-MM-DD'). Skips
// variant-keyed entries (p.name !== key). Sorted by name. Empty when batchName
// is falsy.
export function getMonthlyReportCohort(studentProfiles, batchName, toDate) {
  if (!batchName) return []
  const cutoff = toDate
  const out = []
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue
    if (p.accountStatus !== 'Active') continue
    if (!Array.isArray(p.batches) || !p.batches.includes(batchName)) continue
    if (p.regDate && p.regDate > cutoff) continue
    out.push(p)
  }
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}
