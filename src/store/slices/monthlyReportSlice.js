import { supabase } from '../../lib/supabase'

// Bulk-fetches the three tables the monthly report builder needs:
// `student_attendance` (date-bound), `lecture_absences` (date-bound), and
// `exam_absences` (filtered client-side via in-memory exams[] dates because
// the date lives on a different table). Three round-trips total for an
// entire batch — not three × cohort-size.
//
// Returns null when there's no session or any query errored.
// Returns { attendanceByLwsId, lectureAbsencesByLwsId, examAbsencesByLwsId }
// where each value is the rows grouped by lws_id.

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

function groupBy(rows, key) {
  const out = {}
  for (const row of (rows ?? [])) {
    const k = row[key]
    if (!k) continue
    ;(out[k] = out[k] || []).push(row)
  }
  return out
}

export const createMonthlyReportSlice = (_set, _get) => ({
  async fetchMonthlyReportData(month, cohortLwsIds) {
    if (!supabase) return null
    const session = await getSession()
    if (!session) return null
    if (!Array.isArray(cohortLwsIds) || cohortLwsIds.length === 0) {
      return {
        attendanceByLwsId: {},
        lectureAbsencesByLwsId: {},
        examAbsencesByLwsId: {},
        homeworkByLwsId: {},
      }
    }

    const monthLike = `${month}-%`

    const [
      { data: attendance,      error: attErr },
      { data: lectureAbsences, error: lecErr },
      { data: examAbsences,    error: exaErr },
      { data: homework,        error: hwErr },
    ] = await Promise.all([
      supabase.from('student_attendance')
        .select('lws_id, date, status')
        .in('lws_id', cohortLwsIds)
        .like('date', monthLike),
      supabase.from('lecture_absences')
        .select('lws_id, date, slot_id, subject')
        .in('lws_id', cohortLwsIds)
        .like('date', monthLike),
      supabase.from('exam_absences')
        .select('lws_id, exam_id, marked_at, notified_at')
        .in('lws_id', cohortLwsIds),
      supabase.from('homework_pending')
        .select('lws_id, date, subject, chapter, type, resolved_at')
        .in('lws_id', cohortLwsIds)
        .like('date', monthLike),
    ])

    if (attErr || lecErr || exaErr || hwErr) {
      console.error('[monthlyReport] fetch failed:', attErr || lecErr || exaErr || hwErr)
      return null
    }

    return {
      attendanceByLwsId:      groupBy(attendance,      'lws_id'),
      lectureAbsencesByLwsId: groupBy(lectureAbsences, 'lws_id'),
      examAbsencesByLwsId:    groupBy(examAbsences,    'lws_id'),
      homeworkByLwsId:        groupBy(homework,        'lws_id'),
    }
  },
})
