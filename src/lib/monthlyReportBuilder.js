// Pure builder for the monthly report card. Given a student profile, a month
// ('YYYY-MM'), and the relevant arrays (already filtered to this student where
// applicable), returns a sections object the PDF lib renders. Compute-on-demand
// — no persistence; re-running with the same inputs returns the same output.

import { examMaxMarks } from './analyticsHelpers'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(month /* 'YYYY-MM' */) {
  const [y, m] = month.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  if (m === 12) return `${y + 1}-01`
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

function dateInMonth(dateStr, month) {
  return typeof dateStr === 'string' && dateStr.startsWith(month + '-')
}

// 'YYYY-MM' → 'YYYY-MM-31' (last day; handles month length + leap years).
function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(y, m, 0)   // day=0 of next month → last day of this month
  return `${y}-${String(m).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
  month,
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
    if (!dateInMonth(exam.date, month)) continue
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
    if (!dateInMonth(exam.date, month)) continue
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
    if (!dateInMonth(row.date, month)) continue
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
    .filter(r => dateInMonth(r.date, month))
    .map(r => ({ date: shortDate(r.date), subject: r.subject || '' }))

  // ── homework / notes flagged this month (all flagged, resolved or not) ──
  const homeworkFlagged = (homework || [])
    .filter(r => dateInMonth(r.date, month))
    .sort((a, b) => a.date.localeCompare(b.date))   // sort raw ISO before formatting
    .map(r => ({
      date: shortDate(r.date),
      subject: r.subject || '',
      chapter: r.chapter || '',
      type: r.type || '',
      resolved: !!r.resolved_at,
    }))

  // ── next month focus ───────────────────────────────────────────────────
  let nextMonthFocus = null
  if (batch) {
    const next = nextMonth(month)
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
      month,
      monthLabel: monthLabel(month),
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

// Returns the list of student profiles that should receive a monthly report
// for the given (batch, month). Cohort = Active accountStatus + batches[]
// contains batchName + regDate ≤ last day of month. Skips variant-keyed
// entries (p.name !== key). Sorted by name. Empty when batchName is falsy.
export function getMonthlyReportCohort(studentProfiles, batchName, month) {
  if (!batchName) return []
  const cutoff = lastDayOf(month)
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
