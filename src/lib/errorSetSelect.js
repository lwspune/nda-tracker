// Which exams feed an Error Set — the coarse date/subject/batch filter behind
// the Error Sets page's exam checklist.
//
// Pure. The page finds candidates with this, ticks the eligible ones, and lets
// faculty untick before generating. That two-step exists because faculty think
// in PAPERS, not dates: a range is a fast way to find "the last few mocks", but
// it will also sweep in the 45-question chapter test nobody meant to include.
//
// Two rules worth stating:
//
// 1. A batch tag is matched EXACTLY after splitting the comma-joined field.
//    `exam.batch` is a list, and a prefix match would let `_A` claim `_A2`.
//
// 2. A written/offline exam is returned FLAGGED, never filtered out. It carries
//    a total mark and no `questions[]`, so it can contribute no wrong/skipped
//    question — but a teacher who set four papers and sees three in the picker
//    will conclude the picker is broken. Say why it can't be used instead.

import { getExamBatches } from './analytics/filters'

// 'YYYY-MM-DD' for a Date, in local time (matches the rest of the app's dates).
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The page's opening range: the last 30 days, ending today. Date arithmetic goes
// through the Date constructor so a month or year boundary can't produce an
// out-of-range day.
export function defaultErrorSetRange(today = new Date()) {
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const from = new Date(to)
  from.setDate(from.getDate() - 30)
  return { from: iso(from), to: iso(to) }
}

// selectErrorSetExams({ exams, from, to, subject, batch })
//   subject / batch — blank or omitted means "no filter on this axis".
// Returns one row per candidate exam, newest first, each carrying the counts the
// checklist shows plus an `eligible` flag and, when false, a human `reason`.
export function selectErrorSetExams({
  exams = [],
  from = '',
  to = '',
  subject = '',
  batch = '',
} = {}) {
  if (!Array.isArray(exams) || exams.length === 0) return []

  const rows = exams
    .filter(e => {
      if (!e || !e.date) return false
      if (from && String(e.date) < from) return false
      if (to && String(e.date) > to) return false
      if (subject && e.subject !== subject) return false
      if (batch && !getExamBatches(e).includes(batch)) return false
      return true
    })
    .map(exam => {
      const questionCount = Array.isArray(exam.questions) ? exam.questions.length : 0
      const satCount = Array.isArray(exam.students) ? exam.students.length : 0
      return {
        exam,
        id: exam.id,
        name: exam.name || '',
        date: exam.date,
        subject: exam.subject || '',
        questionCount,
        satCount,
        eligible: questionCount > 0,
        reason: questionCount > 0
          ? ''
          : 'Written exam — no per-question data to draw from',
      }
    })

  // Newest first; name breaks a same-day tie so the order is stable across
  // renders rather than inheriting the store's array order.
  rows.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name))
  return rows
}
