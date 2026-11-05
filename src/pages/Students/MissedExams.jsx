import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { Card, CardTitle, Badge } from '../../components/ui'
import { fmtDate } from '../../lib/dates'
import { useMode } from '../../context/ModeContext'

// Rows a student sees before "Show all".
const STUDENT_PREVIEW = 5

// Component returns null (no card rendered) when there are zero missed exams.
// Same hide-when-empty pattern as `RecentIncidents`.
//
// Data source:
//   - admin / teacher: fetched via `getExamAbsencesForStudent(lwsId)` slice call
//   - student portal:  supplied via `examAbsencesProp` (the portal has no
//     Supabase session, so the slice would return [])
export default function MissedExams({ lwsId, exams = [], examAbsencesProp = null }) {
  const getExamAbsencesForStudent = useStore(s => s.getExamAbsencesForStudent)
  const mode = useMode()

  const [rows, setRows] = useState(examAbsencesProp ?? [])
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (examAbsencesProp !== null) {
      setRows(examAbsencesProp)
      return
    }
    if (!lwsId || typeof getExamAbsencesForStudent !== 'function') return
    let cancelled = false
    getExamAbsencesForStudent(lwsId).then(data => {
      if (!cancelled) setRows(data || [])
    })
    return () => { cancelled = true }
  }, [lwsId, examAbsencesProp, getExamAbsencesForStudent])

  // Resolve display name/date from either side:
  //   - admin/teacher: exams[] has the full set including absent ones
  //   - student portal: row already carries exam_name + exam_date (api/student-login
  //     enriches absence rows server-side because the portal's exams[] only
  //     contains attended exams)
  // Drop rows that are unresolvable from BOTH sides.
  const examById = new Map(exams.map(e => [e.id, e]))
  const enriched = rows
    .map(r => {
      const exam     = examById.get(r.exam_id)
      const examName = exam?.name  ?? r.exam_name  ?? ''
      const examDate = exam?.date  ?? r.exam_date  ?? ''
      const examBatch = exam?.batch ?? r.exam_batch ?? ''
      if (!examName || !examDate) return null
      return {
        examId:     r.exam_id,
        examName,
        examDate,
        examBatch,
        notifiedAt: r.notified_at ?? null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.examDate || '').localeCompare(a.examDate || ''))

  if (enriched.length === 0) return null

  // Students get a plain list: which test, when. The Batch column wrapped to
  // four lines a row on a phone, and "Notified" is faculty bookkeeping about
  // whether the parent was messaged. Faculty keep the table below.
  if (mode === 'student') {
    const shown = showAll ? enriched : enriched.slice(0, STUDENT_PREVIEW)
    return (
      <Card>
        <CardTitle>Tests you missed · {enriched.length}</CardTitle>
        <ul className="divide-y divide-border">
          {shown.map(row => (
            <li key={row.examId} className="py-2 flex justify-between gap-3 text-[13px]">
              <span className="text-ink" data-testid="missed-exam-name">{row.examName}</span>
              <span className="text-ink-3 whitespace-nowrap">{fmtDate(row.examDate) || row.examDate}</span>
            </li>
          ))}
        </ul>
        {enriched.length > STUDENT_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAll(v => !v)}
            aria-expanded={showAll}
            className="w-full min-h-[44px] text-[13px] font-semibold text-accent rounded
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {showAll ? 'Show fewer' : `Show all ${enriched.length}`}
          </button>
        )}
      </Card>
    )
  }

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <CardTitle>
          Missed Exams
          <span className="ml-2 text-[9px] normal-case tracking-normal text-ink-3 font-normal">
            — {enriched.length} exam{enriched.length === 1 ? '' : 's'} skipped
          </span>
        </CardTitle>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-border">
              {['Exam', 'Date', 'Batch', 'Notified'].map((h, i) => (
                <th key={i} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-3 pl-4 first:pl-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enriched.map(row => (
              <tr key={row.examId} className="border-b border-border/50 hover:bg-surface-2">
                <td className="py-2 pr-3 pl-4 font-medium" data-testid="missed-exam-name">{row.examName}</td>
                <td className="py-2 pr-3 font-mono text-ink-3 whitespace-nowrap">{fmtDate(row.examDate) || row.examDate}</td>
                <td className="py-2 pr-3 text-ink-2">{row.examBatch || '—'}</td>
                <td className="py-2 pr-4">
                  {row.notifiedAt
                    ? <Badge variant="green">Notified</Badge>
                    : <span className="text-[10px] font-mono text-ink-3">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
