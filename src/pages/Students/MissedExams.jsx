import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { Card, CardTitle, Badge } from '../../components/ui'

// Component returns null (no card rendered) when there are zero missed exams.
// Same hide-when-empty pattern as `RecentIncidents`.
//
// Data source:
//   - admin / teacher: fetched via `getExamAbsencesForStudent(lwsId)` slice call
//   - student portal:  supplied via `examAbsencesProp` (the portal has no
//     Supabase session, so the slice would return [])
export default function MissedExams({ lwsId, exams = [], examAbsencesProp = null }) {
  const getExamAbsencesForStudent = useStore(s => s.getExamAbsencesForStudent)

  const [rows, setRows] = useState(examAbsencesProp ?? [])

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
                <td className="py-2 pr-3 font-mono text-ink-3 whitespace-nowrap">{row.examDate}</td>
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
