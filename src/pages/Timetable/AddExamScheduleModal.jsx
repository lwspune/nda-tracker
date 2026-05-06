import { useState } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

const STATUSES = ['Planned', 'Completed', 'Cancelled']

export default function AddExamScheduleModal({ exam, onClose }) {
  const timetables = useStore(s => s.timetables)
  const teachers   = useStore(s => s.timetableTeachers)
  const addExamSchedule    = useStore(s => s.addExamSchedule)
  const updateExamSchedule = useStore(s => s.updateExamSchedule)
  const deleteExamSchedule = useStore(s => s.deleteExamSchedule)

  const branches = [...new Set(timetables.map(t => t.branch))].sort()

  const [branch,    setBranch]    = useState(exam?.branch    || branches[0] || '')
  const [batchName, setBatchName] = useState(exam?.batchName || '')
  const [date,      setDate]      = useState(exam?.date      || '')
  const [startTime, setStartTime] = useState(exam?.startTime || '')
  const [endTime,   setEndTime]   = useState(exam?.endTime   || '')
  const [subject,   setSubject]   = useState(exam?.subject   || '')
  const [chapter,   setChapter]   = useState(exam?.chapter   || '')
  const [teacherId, setTeacherId] = useState(exam?.teacherId || '')
  const [status,    setStatus]    = useState(exam?.status    || 'Planned')
  const [error,     setError]     = useState('')
  const [delConfirm, setDelConfirm] = useState(false)

  const batchOptions = timetables
    .filter(t => t.branch === branch)
    .map(t => t.batchName)

  function handleBranchChange(b) {
    setBranch(b)
    setBatchName('')
  }

  function validate() {
    if (!branch)    return 'Branch is required.'
    if (!batchName) return 'Batch is required.'
    if (!date)      return 'Date is required.'
    if (!startTime) return 'Start time is required.'
    if (!endTime)   return 'End time is required.'
    if (!subject.trim()) return 'Subject is required.'
    if (!chapter.trim()) return 'Chapter is required.'
    return ''
  }

  function handleSave() {
    const err = validate()
    if (err) { setError(err); return }
    const payload = {
      date, startTime: startTime.trim(), endTime: endTime.trim(),
      subject: subject.trim(), chapter: chapter.trim(),
      teacherId: teacherId || null, branch, batchName, status,
    }
    if (exam) {
      updateExamSchedule(exam.id, payload)
    } else {
      addExamSchedule(payload)
    }
    onClose()
  }

  function handleDelete() {
    deleteExamSchedule(exam.id)
    onClose()
  }

  return (
    <ModalShell title={exam ? 'Edit Exam' : 'Add Exam'} onClose={onClose}>
      <div className="space-y-4">

        {/* Branch */}
        <div>
          <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
            Branch
          </label>
          {branches.length === 0 ? (
            <p className="text-[12px] text-ink-3 italic">No timetables exist yet — add a timetable first.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {branches.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => handleBranchChange(b)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                    b === branch
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                  }`}
                >{b}</button>
              ))}
            </div>
          )}
        </div>

        {/* Batch */}
        {branch && (
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
              Batch
            </label>
            {batchOptions.length === 0 ? (
              <p className="text-[12px] text-ink-3 italic">No batches for this branch.</p>
            ) : (
              <div className="flex flex-wrap gap-1 border-b border-border pb-0">
                {batchOptions.map(b => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBatchName(b)}
                    className={`px-4 py-2 text-[12px] font-semibold rounded-t-lg border-b-2 transition-colors ${
                      b === batchName
                        ? 'border-accent text-accent'
                        : 'border-transparent text-ink-3 hover:text-ink'
                    }`}
                  >{b}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Date */}
        <div>
          <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
              Start Time
            </label>
            <input
              type="text"
              placeholder="9:00 AM"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
              End Time
            </label>
            <input
              type="text"
              placeholder="11:00 AM"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
            Subject
          </label>
          <input
            type="text"
            placeholder="e.g. Maths"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Chapter */}
        <div>
          <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
            Chapter
          </label>
          <input
            type="text"
            placeholder="e.g. Trigonometry"
            value={chapter}
            onChange={e => setChapter(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Teacher */}
        <div>
          <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
            Responsible Teacher
          </label>
          <select
            value={teacherId}
            onChange={e => setTeacherId(e.target.value)}
            className="input w-full"
          >
            <option value="">— Unassigned —</option>
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1.5">
            Status
          </label>
          <div className="flex gap-2">
            {STATUSES.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                  s === status
                    ? s === 'Completed' ? 'bg-green-600 text-white border-green-600'
                    : s === 'Cancelled' ? 'bg-red-500 text-white border-red-500'
                    : 'bg-accent text-white border-accent'
                    : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                }`}
              >{s}</button>
            ))}
          </div>
        </div>

        {error && <p className="text-[12px] text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} className="btn btn-primary flex-1 py-2.5">
            {exam ? 'Save' : 'Add Exam'}
          </button>
          <button onClick={onClose} className="btn border border-border px-4 py-2.5 text-ink-2">
            Cancel
          </button>
        </div>

        {exam && !delConfirm && (
          <button
            onClick={() => setDelConfirm(true)}
            className="w-full text-[11px] text-red-400 hover:underline mt-1"
          >
            Delete this exam
          </button>
        )}
        {delConfirm && (
          <div className="flex gap-2">
            <button onClick={handleDelete} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-[12px] font-semibold">
              Confirm delete
            </button>
            <button onClick={() => setDelConfirm(false)} className="flex-1 py-2 rounded-lg border border-border text-[12px] text-ink-2">
              Cancel
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
