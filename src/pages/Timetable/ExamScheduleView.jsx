import { useState, useEffect } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import AddExamScheduleModal from './AddExamScheduleModal'
import SendScheduleModal from './SendScheduleModal'

const STATUS_COLOUR = {
  Planned:   'bg-indigo-100 text-indigo-700',
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-500',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${+d} ${months[+m - 1]} ${y}`
}

export default function ExamScheduleView() {
  const mode      = useMode()
  const isFaculty = mode === 'faculty'

  const timetables     = useStore(s => s.timetables)
  const teachers       = useStore(s => s.timetableTeachers)
  const examSchedules  = useStore(s => s.examSchedules)
  const cycleExamStatus = useStore(s => s.cycleExamStatus)

  const branches = [...new Set(timetables.map(t => t.branch))].sort()

  const [selectedBranch,  setSelectedBranch]  = useState(null)
  const [selectedBatch,   setSelectedBatch]   = useState(null)
  const [addModal,        setAddModal]        = useState(false)
  const [editExam,        setEditExam]        = useState(null)
  // sendReminder: null | { daysAhead: 1|2 }
  const [sendReminder,    setSendReminder]    = useState(null)

  // Mirror TimetablePage: auto-select first branch on mount / when timetables change
  useEffect(() => {
    if (branches.length && (!selectedBranch || !branches.includes(selectedBranch))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedBranch(branches[0])
    }
  }, [branches.join(',')])

  const branchBatches = timetables
    .filter(t => t.branch === selectedBranch)
    .map(t => t.batchName)

  useEffect(() => {
    if (!branchBatches.includes(selectedBatch)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedBatch(branchBatches[0] ?? null)
    }
  }, [selectedBranch, timetables.length])

  const filtered = examSchedules
    .filter(e => !selectedBranch || e.branch === selectedBranch)
    .filter(e => !selectedBatch  || e.batchName === selectedBatch)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))

  function teacherName(tid) {
    return teachers.find(t => t.id === tid)?.name ?? '—'
  }

  // Build reminder target dates for button labels
  function reminderDate(daysAhead) {
    const d = new Date()
    d.setDate(d.getDate() + daysAhead)
    return d.toISOString().slice(0, 10)
  }

  return (
    <div className="space-y-4">
      {timetables.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-2xl mb-2 opacity-30">📋</div>
          <div className="text-[14px] font-bold mb-1">No timetables yet</div>
          <div className="text-[12px] text-ink-3">Create a timetable first to set up exam schedules.</div>
        </div>
      ) : (
        <>
          {/* Branch tabs — identical pill style to TimetablePage */}
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <span className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mr-1">Branch</span>
            {branches.map(b => (
              <button
                key={b}
                onClick={() => setSelectedBranch(b)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                  b === selectedBranch
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                }`}
              >{b}</button>
            ))}
          </div>

          {/* Batch tabs — identical underline style to TimetablePage */}
          {branchBatches.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-5 border-b border-border pb-0">
              {branchBatches.map(b => (
                <button
                  key={b}
                  onClick={() => setSelectedBatch(b)}
                  className={`px-4 py-2.5 text-[13px] font-semibold rounded-t-lg border-b-2 transition-colors ${
                    b === selectedBatch
                      ? 'border-accent text-accent'
                      : 'border-transparent text-ink-3 hover:text-ink'
                  }`}
                >{b}</button>
              ))}
            </div>
          )}

          {/* Action bar */}
          <div className="flex flex-wrap gap-2 items-center">
            {isFaculty && (
              <button
                onClick={() => setAddModal(true)}
                className="btn btn-primary text-[12px] px-3 py-1.5"
              >
                + Add Exam
              </button>
            )}
            <div className="ml-auto flex gap-2">
              {isFaculty && (
                <>
                  <button
                    onClick={() => setSendReminder({ daysAhead: 2 })}
                    className="btn text-[11px] px-3 py-1.5 border border-border text-ink-2 hover:border-accent/50 hover:text-ink transition-colors"
                    title={`Send reminder for exams on ${fmtDate(reminderDate(2))}`}
                  >
                    ✉ Remind (2 days)
                  </button>
                  <button
                    onClick={() => setSendReminder({ daysAhead: 1 })}
                    className="btn text-[11px] px-3 py-1.5 border border-border text-ink-2 hover:border-accent/50 hover:text-ink transition-colors"
                    title={`Send reminder for exams on ${fmtDate(reminderDate(1))}`}
                  >
                    ✉ Remind (1 day)
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="card text-center py-10">
              <div className="text-2xl mb-2 opacity-30">📅</div>
              <div className="text-[14px] font-bold mb-1">No exams scheduled</div>
              <div className="text-[12px] text-ink-3">
                {isFaculty ? 'Click "+ Add Exam" to schedule one.' : 'No exams have been scheduled yet.'}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px] min-w-[680px]">
                <thead>
                  <tr>
                    {['Date', 'Time', 'Subject', 'Chapter', 'Teacher', 'Status'].map(h => (
                      <th key={h} className="border border-border bg-surface-2 px-3 py-2.5 text-left font-bold text-ink-2 text-[11px] uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                    {isFaculty && <th className="border border-border bg-surface-2 px-2 py-2.5 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id} className="hover:bg-surface-2/40 transition-colors">
                      <td className="border border-border px-3 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-ink">{fmtDate(e.date)}</div>
                        <div className="text-[10px] text-ink-3">{e.batchName}</div>
                      </td>
                      <td className="border border-border px-3 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-ink">{e.startTime}</div>
                        <div className="text-[10px] text-ink-3">to {e.endTime}</div>
                      </td>
                      <td className="border border-border px-3 py-2.5 font-semibold text-accent">{e.subject}</td>
                      <td className="border border-border px-3 py-2.5 text-ink">{e.chapter}</td>
                      <td className="border border-border px-3 py-2.5 text-ink-2">{teacherName(e.teacherId)}</td>
                      <td className="border border-border px-3 py-2.5">
                        <button
                          onClick={() => isFaculty && cycleExamStatus(e.id)}
                          disabled={!isFaculty}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLOUR[e.status] ?? 'bg-surface text-ink-3'} ${isFaculty ? 'cursor-pointer' : 'cursor-default'}`}
                          title={isFaculty ? 'Click to change status' : undefined}
                        >
                          {e.status}
                        </button>
                      </td>
                      {isFaculty && (
                        <td className="border border-border px-2 py-2.5 text-center">
                          <button
                            onClick={() => setEditExam(e)}
                            className="text-[11px] text-ink-3 hover:text-ink transition-colors px-1"
                            aria-label="Edit exam"
                          >⚙</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {addModal && (
        <AddExamScheduleModal onClose={() => setAddModal(false)} />
      )}
      {editExam && (
        <AddExamScheduleModal exam={editExam} onClose={() => setEditExam(null)} />
      )}
      {sendReminder && (
        <SendScheduleModal
          mode="exam-reminder"
          daysAhead={sendReminder.daysAhead}
          onClose={() => setSendReminder(null)}
        />
      )}
    </div>
  )
}
