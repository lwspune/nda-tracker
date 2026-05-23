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

// Surfaces the last 30 days of "L" markers (from attendance), lecture-miss
// events (from lecture_absences), and exam absences (from exam_absences).
// Visible in all portals; the two slice fetches return [] without an
// authenticated session — the student portal supplies them via prop bypass.
export default function RecentIncidents({
  lwsId,
  attendance,
  exams = [],
  lectureAbsencesProp = null,
  examAbsencesProp    = null,
}) {
  const getLectureAbsencesForStudent = useStore(s => s.getLectureAbsencesForStudent)
  const getExamAbsencesForStudent    = useStore(s => s.getExamAbsencesForStudent)
  const [fetchedLecture, setFetchedLecture] = useState([])
  const [fetchedExam,    setFetchedExam]    = useState([])
  const sinceDate = useMemo(() => isoDaysAgo(30), [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lectureAbsencesProp !== null) { setFetchedLecture([]); return }
    if (!lwsId) { setFetchedLecture([]); return }
    let cancelled = false
    getLectureAbsencesForStudent(lwsId, sinceDate).then(rows => {
      if (!cancelled) setFetchedLecture(rows)
    })
    return () => { cancelled = true }
  }, [lwsId, sinceDate, getLectureAbsencesForStudent, lectureAbsencesProp])

  useEffect(() => {
    // exam_absences uses marked_at (timestamptz), not date — pass ISO datetime.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (examAbsencesProp !== null) { setFetchedExam([]); return }
    if (!lwsId) { setFetchedExam([]); return }
    let cancelled = false
    getExamAbsencesForStudent(lwsId, sinceDate + 'T00:00:00.000Z').then(rows => {
      if (!cancelled) setFetchedExam(rows)
    })
    return () => { cancelled = true }
  }, [lwsId, sinceDate, getExamAbsencesForStudent, examAbsencesProp])

  const lectureRows = lectureAbsencesProp !== null ? lectureAbsencesProp : fetchedLecture
  const examRows    = examAbsencesProp    !== null ? examAbsencesProp    : fetchedExam

  // L markers from attendance prop (last 30 days)
  const lateRows = useMemo(() => {
    if (!Array.isArray(attendance)) return []
    return attendance
      .filter(r => r.status === 'L' && r.date >= sinceDate)
      .map(r => ({ kind: 'late', date: r.date }))
  }, [attendance, sinceDate])

  // Exam-absence items — enriched with exam name from the exams prop, sorted
  // and de-duped (one row per exam even if the table grew a duplicate).
  const examItems = useMemo(() => {
    const byId = new Map(exams.map(e => [e.id, e]))
    return examRows
      .map(r => {
        const e = byId.get(r.exam_id)
        if (!e) return null
        return { kind: 'exam-miss', date: e.date, examName: e.name }
      })
      .filter(Boolean)
  }, [examRows, exams])

  const items = useMemo(() => {
    const lectureItems = lectureRows.map(r => ({
      kind: 'missed', date: r.date, subject: r.subject,
    }))
    return [...lateRows, ...lectureItems, ...examItems].sort((a, b) => b.date.localeCompare(a.date))
  }, [lateRows, lectureRows, examItems])

  if (items.length === 0) return null

  return (
    <Card>
      <CardTitle>Recent incidents · last 30 days</CardTitle>
      <div className="flex flex-wrap gap-2 mt-2">
        {items.map((item, idx) => {
          let label, cls
          if (item.kind === 'late') {
            label = 'Late'
            cls   = 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300'
          } else if (item.kind === 'missed') {
            label = `Missed ${item.subject}`
            cls   = 'bg-red-400/10 border-red-400/30 text-red-300'
          } else {
            label = `Missed exam · ${item.examName}`
            cls   = 'bg-red-500/15 border-red-500/40 text-red-200'
          }
          return (
            <span
              key={`${item.kind}-${item.date}-${item.subject ?? item.examName ?? idx}`}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] ${cls}`}
            >
              <span className="font-semibold">{label}</span>
              <span className="text-ink-3 font-mono">{fmtDate(item.date)}</span>
            </span>
          )
        })}
      </div>
    </Card>
  )
}
