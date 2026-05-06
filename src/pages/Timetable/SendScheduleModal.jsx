import { useState, useRef, useEffect } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

// phase: 'confirm' | 'sending' | 'done'
// When mode='exam-reminder' is passed, skips the mode picker and sends a reminder.

export default function SendScheduleModal({ teacherId = null, mode: modeProp, daysAhead, onClose }) {
  const teachers = useStore(s => s.timetableTeachers)

  const isExamReminder = modeProp === 'exam-reminder'
  const [mode,  setMode]  = useState(isExamReminder ? 'exam-reminder' : 'weekly')
  const [phase, setPhase] = useState('confirm')
  const [result, setResult] = useState(null)

  const logRef = useRef(null)
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = 0 }, [result])

  const targetTeacher = teacherId ? teachers.find(t => t.id === teacherId) : null
  const recipientLabel = isExamReminder
    ? `All teachers with exams in ${daysAhead} day${daysAhead !== 1 ? 's' : ''}`
    : (targetTeacher ? targetTeacher.name : `All teachers (${teachers.filter(t => t.email?.trim()).length} with email)`)

  const modeLabel = isExamReminder
    ? `Exam reminder — ${daysAhead} day${daysAhead !== 1 ? 's' : ''} before`
    : mode === 'weekly'
      ? 'Weekly schedule (next Mon – Sat)'
      : "Daily schedule (tomorrow's classes)"

  async function handleSend() {
    setPhase('sending')
    try {
      const body = isExamReminder
        ? { mode: 'exam-reminder', daysAhead }
        : { mode, teacherId: teacherId ?? undefined }
      const res = await fetch('/api/send-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok && !data.error) throw new Error(`Server error ${res.status}`)
      setResult(data)
    } catch (e) {
      setResult({ ok: false, sent: 0, skipped: 0, lines: [], error: e.message })
    }
    setPhase('done')
  }

  const logLines = (result?.lines ?? []).filter(l => !l.startsWith('Mode:'))

  return (
    <ModalShell title={isExamReminder ? 'Send Exam Reminder' : 'Send Schedule Email'} onClose={onClose}>
      {phase === 'confirm' && (
        <>
          {/* Mode picker — hidden for exam-reminder (mode is fixed) */}
          {!isExamReminder && (
            <div>
              <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Email type</div>
              <div className="flex flex-col gap-2">
                {[
                  { value: 'weekly', label: 'Weekly schedule', sub: 'Next Mon – Sat' },
                  { value: 'daily',  label: "Tomorrow's schedule", sub: 'Next working day only' },
                ].map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      mode === opt.value
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-accent/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="mt-0.5 accent-accent"
                    />
                    <div>
                      <div className="text-[13px] font-semibold text-ink">{opt.label}</div>
                      <div className="text-[11px] text-ink-3">{opt.sub}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Recipients summary */}
          <div className="px-4 py-3 rounded-lg bg-surface-2 border border-border text-[13px]">
            <span className="text-ink-3">To: </span>
            <span className="font-semibold text-ink">{recipientLabel}</span>
          </div>

          {/* Warning if no teachers have email */}
          {!isExamReminder && teachers.filter(t => t.email?.trim()).length === 0 && (
            <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
              No teachers have email addresses set. Add emails via the Teachers button first.
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary text-[12px] px-4 py-1.5 disabled:opacity-40"
              onClick={handleSend}
              disabled={!isExamReminder && teachers.filter(t => t.email?.trim()).length === 0}
            >
              Send emails
            </button>
          </div>
        </>
      )}

      {phase === 'sending' && (
        <div className="flex flex-col items-center py-8 gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <div className="text-[13px] text-ink-3">Sending {modeLabel.toLowerCase()}…</div>
        </div>
      )}

      {phase === 'done' && result && (
        <>
          {/* Status header */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
            result.error
              ? 'bg-red-50 border-red-200'
              : result.ok
                ? 'bg-green-50 border-green-200'
                : 'bg-amber-50 border-amber-200'
          }`}>
            <span className="text-xl">
              {result.error ? '❌' : result.ok ? '✅' : '⚠️'}
            </span>
            <div>
              <div className={`text-[13px] font-bold ${
                result.error ? 'text-red-700' : result.ok ? 'text-green-700' : 'text-amber-700'
              }`}>
                {result.error ? result.error : result.ok ? 'Emails sent successfully' : 'Completed with errors'}
              </div>
              {!result.error && (
                <div className="text-[11px] text-ink-3 mt-0.5">
                  Sent: {result.sent} · Skipped: {result.skipped}
                </div>
              )}
            </div>
          </div>

          {/* Log */}
          {logLines.length > 0 && (
            <div
              ref={logRef}
              className="bg-surface-2 rounded-lg border border-border p-3 max-h-48 overflow-y-auto font-mono text-[11px] space-y-0.5"
            >
              {logLines.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('✅') ? 'text-green-600'
                    : line.startsWith('⏭') ? 'text-amber-500'
                    : line.startsWith('❌') || line.startsWith('ERR:') ? 'text-red-500'
                    : 'text-ink-3'
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button className="btn btn-primary text-[12px] px-4 py-1.5" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
