import { useMemo, useState } from 'react'
import ModalShell from '../Timetable/ModalShell'
import { buildOfflineRoster } from '../../lib/offlineRoster'
import {
  writtenQuizCompletion, buildWrittenQuizExam, findDuplicateWrittenQuiz,
} from '../../lib/writtenQuiz'

// A teacher entering marks for their own pen-and-paper class test.
//
// Deliberately NOT the admin OfflineExamModal: that one treats a blank mark as
// "did not appear" (feeding absentee flagging), which is the wrong default for
// someone marking a stack of papers in one sitting — a half-finished grid would
// save as a room full of no-shows. Here blank means "not entered yet", absence
// is an explicit tick, and Save stays disabled until every student is one or
// the other.
export default function WrittenQuizModal({
  open, target, date, exams, studentProfiles, existingExam = null, onSave, onClose,
}) {
  const [name, setName]         = useState('')
  const [maxMarks, setMaxMarks] = useState('')
  const [marks, setMarks]       = useState({})           // lwsId → typed string
  const [absentIds, setAbsent]  = useState(() => new Set())
  const [saving, setSaving]     = useState(false)
  const [seeded, setSeeded]     = useState(null)         // which exam the fields were seeded from

  const roster = useMemo(
    () => (target ? buildOfflineRoster(studentProfiles, [target.batchName]) : []),
    [studentProfiles, target],
  )

  // Seed once per opened exam (editing an existing quiz pre-fills its marks).
  // Keyed on the exam id rather than an effect so re-renders don't clobber typing.
  const seedKey = existingExam?.id ?? (open ? `new|${target?.key}|${date}` : null)
  if (open && seedKey && seeded !== seedKey) {
    const byName = new Map((existingExam?.students ?? []).map(s => [s.name, s.totalMarks]))
    const nextMarks = {}
    for (const s of roster) if (byName.has(s.name)) nextMarks[s.lwsId] = String(byName.get(s.name))
    setSeeded(seedKey)
    setName(existingExam?.name ?? '')
    setMaxMarks(existingExam?.maxMarks != null ? String(existingExam.maxMarks) : '')
    setMarks(nextMarks)
    // Editing: anyone with no stored result was either absent or never entered.
    // We can't tell which after the fact, so start them blank rather than
    // guessing — the completeness gate then makes the teacher say.
    setAbsent(new Set())
  }

  const completion = useMemo(
    () => writtenQuizCompletion({ roster, marks, absentIds }),
    [roster, marks, absentIds],
  )

  const maxNum = parseFloat(maxMarks)
  const maxValid = Number.isFinite(maxNum) && maxNum > 0
  const overMax = useMemo(
    () => (maxValid
      ? roster.filter(s => !absentIds.has(s.lwsId) && parseFloat(marks[s.lwsId]) > maxNum)
      : []),
    [roster, marks, absentIds, maxNum, maxValid],
  )

  const duplicate = useMemo(
    () => (target && date
      ? findDuplicateWrittenQuiz(exams, {
          date, subject: target.subject, batchName: target.batchName, excludeId: existingExam?.id ?? null,
        })
      : null),
    [exams, target, date, existingExam],
  )

  if (!open || !target) return null

  const canSave = Boolean(name.trim()) && maxValid && completion.complete && overMax.length === 0

  function toggleAbsent(lwsId) {
    setAbsent(prev => {
      const next = new Set(prev)
      if (next.has(lwsId)) next.delete(lwsId)
      else { next.add(lwsId); setMarks(m => ({ ...m, [lwsId]: '' })) }
      return next
    })
  }

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    try {
      await onSave(buildWrittenQuizExam({
        id: existingExam?.id ?? `wq_${Date.now().toString(36)}_${Math.floor(performance.now())}`,
        name: name.trim(),
        date,
        subject: target.subject,
        batchName: target.batchName,
        maxMarks: maxNum,
        roster,
        marks,
        absentIds,
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`Written Quiz — ${target.subject} · ${target.batchName}`}
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] text-ink-3">
            {completion.entered} entered · {completion.absent} absent
            {completion.pending > 0 && (
              <span className="text-yellow-400 font-semibold"> · {completion.pending} not entered</span>
            )}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="btn text-[13px] min-h-[44px] px-4">Cancel</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : existingExam ? 'Save changes' : 'Save Written Quiz'}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex gap-3 flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Quiz name</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Trigonometry test"
            aria-label="Quiz name"
            className="form-input text-[13px] min-h-[44px] px-3"
          />
        </label>
        <label className="flex flex-col gap-1 w-32">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Out of</span>
          <input
            type="number"
            min="1"
            step="0.5"
            value={maxMarks}
            onChange={e => setMaxMarks(e.target.value)}
            aria-label="Max marks"
            className="form-input text-[13px] min-h-[44px] px-3"
          />
        </label>
      </div>

      {duplicate && (
        <div className="text-[12px] px-3 py-2 rounded-lg border border-yellow-400/30 bg-yellow-400/10 text-yellow-400">
          A quiz for this class already exists on this date — <b>{duplicate.name}</b>. Save only if
          this is genuinely a second one.
        </div>
      )}

      {overMax.length > 0 && (
        <div className="text-[12px] px-3 py-2 rounded-lg border border-red-400/30 bg-red-400/10 text-red-400">
          {overMax.length} mark{overMax.length !== 1 ? 's are' : ' is'} above {maxNum} — e.g.{' '}
          {overMax[0].name}. Fix the marks or raise “Out of”.
        </div>
      )}

      <p className="text-[11px] text-ink-3">
        Leave a box empty only while you’re still marking — an empty box is <b>not</b> the same as
        absent. Tick <b>Absent</b> for anyone who didn’t sit the quiz. Nothing here is sent to
        parents.
      </p>

      {roster.length === 0 ? (
        <div className="text-[13px] text-ink-3 italic py-6 text-center">
          No students in {target.batchName}.
        </div>
      ) : (
        <div className="space-y-1">
          {roster.map(s => {
            const isAbsent = absentIds.has(s.lwsId)
            return (
              <div key={s.lwsId} className="flex items-center gap-3 px-1 py-1.5 border-b border-border">
                <span className={`text-[13px] flex-1 min-w-0 truncate ${isAbsent ? 'text-ink-3 line-through' : 'text-ink'}`}>
                  {s.name}
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={isAbsent ? '' : (marks[s.lwsId] ?? '')}
                  disabled={isAbsent}
                  onChange={e => setMarks(m => ({ ...m, [s.lwsId]: e.target.value }))}
                  aria-label={`Marks for ${s.name}`}
                  className="form-input text-[13px] min-h-[44px] px-2 w-20 text-right disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => toggleAbsent(s.lwsId)}
                  aria-pressed={isAbsent}
                  aria-label={`${s.name} absent`}
                  className={`text-[11px] font-semibold px-2 py-2 rounded-lg border min-h-[44px] shrink-0 ${
                    isAbsent
                      ? 'text-red-400 bg-red-400/10 border-red-400/30'
                      : 'text-ink-3 border-border hover:text-ink'}`}
                >
                  Absent
                </button>
              </div>
            )
          })}
        </div>
      )}
    </ModalShell>
  )
}
