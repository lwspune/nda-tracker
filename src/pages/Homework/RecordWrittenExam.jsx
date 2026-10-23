import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { Alert } from '../../components/ui'
import {
  writtenExamId, planWrittenExam, buildHomeworkExam, defaultExamDate,
} from '../../lib/assignments/writtenExam'

// Record a graded homework as a written exam on the Exams page (2026-10-23).
// The rules (when it is refused, who is absent, the exam's shape) are in
// lib/assignments/writtenExam.js; this is the button and a confirm step.
//
// Never messages parents: absentees are not flagged (syncAbsences:false), the
// same rule a teacher's Written Quiz follows. The office can still send exam
// absences from the Exams page.
export default function RecordWrittenExam({ assignment, rows, email }) {
  const mode            = useMode()
  const exams           = useStore(s => s.exams)
  const addExam         = useStore(s => s.addExam)
  const replaceExam     = useStore(s => s.replaceExam)
  const studentProfiles = useStore(s => s.studentProfiles)

  const existing = (exams ?? []).find(e => e.id === writtenExamId(assignment.id)) ?? null
  const plan = useMemo(
    () => planWrittenExam(assignment, rows, studentProfiles),
    [assignment, rows, studentProfiles],
  )

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [done, setDone] = useState(null)

  function start() {
    setName(existing?.name ?? assignment.title)
    setDate(existing?.date ?? defaultExamDate(assignment))
    setDone(null)
    setOpen(true)
  }

  function record() {
    const exam = buildHomeworkExam(assignment, plan.students, { name, date, mode, email, existing })
    if (existing) replaceExam(exam.id, exam, { syncAbsences: false })
    else addExam(exam, { syncAbsences: false })
    setOpen(false)
    setDone(exam.name)
  }

  const blocked = plan.blockers.length > 0
  const canRecord = !blocked && name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(date)
  // Another exam with this name and date — most likely the same paper already
  // entered through + Offline marks, which would then count twice.
  const clash = (exams ?? []).find(e =>
    e.id !== writtenExamId(assignment.id) &&
    e.date === date && e.name?.trim().toLowerCase() === name.trim().toLowerCase()
  )

  return (
    <div className="mb-4 flex flex-col gap-2 text-[12px]">
      <div>
        <button className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed" disabled={blocked} onClick={start}>
          📝 {existing ? 'Update written exam' : 'Record as written exam'}
        </button>
      </div>
      {blocked && (
        <ul className="text-ink-3 list-disc pl-5" aria-label="Before it can be recorded">
          {plan.blockers.map(b => <li key={b}>{b}</li>)}
        </ul>
      )}
      {done && <Alert type="success">Recorded on the Exams page as “{done}”.</Alert>}

      {open && (
        <section aria-label="Record as written exam" className="flex flex-col gap-3 rounded-lg border border-border p-3 bg-surface">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              Exam name
              <input className="form-input w-72 max-w-full" value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              Exam date
              <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
          </div>
          <p className="text-ink-2">
            {assignment.subject} · {assignment.batchNames.join(', ')} · out of {assignment.maxMarks}
          </p>
          <p className="font-semibold text-ink">
            {plan.students.length} marked · {plan.absent.length} absent
          </p>
          {plan.absent.length > 0 && (
            <p className="text-ink-2">
              Absent, no mark recorded:{' '}
              {plan.absent.map(n => (plan.sentBack.includes(n) ? `${n} (sent back)` : n)).join(', ')}
            </p>
          )}
          {existing && (
            <Alert type="warning">
              This replaces the marks on the Exams page with the current homework grades.
            </Alert>
          )}
          {clash && (
            <Alert type="warning">
              The Exams page already has “{clash.name}” on this date. If it is the same paper, it will count twice.
            </Alert>
          )}
          <p className="text-ink-3">No message is sent to students or parents.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed" disabled={!canRecord} onClick={record}>
              {existing ? 'Update' : 'Record'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  )
}
