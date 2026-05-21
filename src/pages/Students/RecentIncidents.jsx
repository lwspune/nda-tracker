import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { Card, CardTitle } from '../../components/ui'

function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Surfaces the last 30 days of "L" markers (from attendance) and lecture-miss
// events (from lecture_absences). Visible in all portals; lecture absences only
// load when an authenticated session exists (admin / teacher).
export default function RecentIncidents({ lwsId, attendance, lectureAbsencesProp = null }) {
  const getLectureAbsencesForStudent = useStore(s => s.getLectureAbsencesForStudent)
  const [fetchedRows, setFetchedRows] = useState([])
  const sinceDate = useMemo(() => isoDaysAgo(30), [])

  useEffect(() => {
    // Student portal supplies lectureAbsencesProp directly (no auth session for RLS),
    // so skip the fetch in that case — same pattern as attendanceProp.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lectureAbsencesProp !== null) { setFetchedRows([]); return }
    if (!lwsId) { setFetchedRows([]); return }
    let cancelled = false
    getLectureAbsencesForStudent(lwsId, sinceDate).then(rows => {
      if (!cancelled) setFetchedRows(rows)
    })
    return () => { cancelled = true }
  }, [lwsId, sinceDate, getLectureAbsencesForStudent, lectureAbsencesProp])

  const lectureRows = lectureAbsencesProp !== null ? lectureAbsencesProp : fetchedRows

  // L markers from attendance prop (last 30 days)
  const lateRows = useMemo(() => {
    if (!Array.isArray(attendance)) return []
    return attendance
      .filter(r => r.status === 'L' && r.date >= sinceDate)
      .map(r => ({ kind: 'late', date: r.date }))
  }, [attendance, sinceDate])

  const items = useMemo(() => {
    const lectureItems = lectureRows.map(r => ({
      kind: 'missed', date: r.date, subject: r.subject,
    }))
    return [...lateRows, ...lectureItems].sort((a, b) => b.date.localeCompare(a.date))
  }, [lateRows, lectureRows])

  if (items.length === 0) return null

  return (
    <Card>
      <CardTitle>Recent incidents · last 30 days</CardTitle>
      <div className="flex flex-wrap gap-2 mt-2">
        {items.map((item, idx) => {
          const isLate = item.kind === 'late'
          return (
            <span
              key={`${item.kind}-${item.date}-${item.subject ?? idx}`}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px]
                ${isLate
                  ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300'
                  : 'bg-red-400/10 border-red-400/30 text-red-300'}`}
            >
              <span className="font-semibold">{isLate ? 'Late' : `Missed ${item.subject}`}</span>
              <span className="text-ink-3 font-mono">{fmtDate(item.date)}</span>
            </span>
          )
        })}
      </div>
    </Card>
  )
}
