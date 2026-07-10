import { useMemo, useState, useEffect } from 'react'
import ModalShell from '../Timetable/ModalShell'
import { computeAbsentees } from '../../lib/lectureRoster'

function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Marks who missed a single lecture (date+subject) for a (possibly pooled) roster.
// Two input modes — teachers share EITHER a short absent list OR a short present
// list — so faculty tap the named students and the toggle decides interpretation
// (see computeAbsentees). On-leave students are shown but LOCKED and never logged
// absent; if the teacher reports one present, a "returned" action closes the leave.
// For a non-hostel branch onLeaveIds is empty → this is a plain present/absent
// toggle with nothing locked.
export default function MarkAbsenteesModal({
  open,
  date,
  subject,
  studentsInBatch,
  initialAbsentees,
  onLeaveIds,
  onMarkReturned,
  onSave,
  onClose,
}) {
  const onLeave = useMemo(
    () => (onLeaveIds instanceof Set ? onLeaveIds : new Set(onLeaveIds || [])),
    [onLeaveIds],
  )
  const [mode, setMode] = useState('absent')       // 'absent' | 'present'
  const [checked, setChecked] = useState(() => new Set(initialAbsentees))
  const [query, setQuery] = useState('')

  // Reset draft when opening fresh (e.g. user switched periods). Editing a saved
  // period starts in Absent mode with the saved absentees pre-checked.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode('absent')
      setChecked(new Set(initialAbsentees))
      setQuery('')
    }
  }, [open, initialAbsentees])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return studentsInBatch
    return studentsInBatch.filter(s => s.name.toLowerCase().includes(q))
  }, [studentsInBatch, query])

  // Live derivation of who will actually be logged absent (mode + leave applied).
  const derivedAbsent = useMemo(
    () => computeAbsentees({
      rosterIds: studentsInBatch.map(s => s.lwsId),
      selectedIds: checked,
      mode,
      onLeaveIds: onLeave,
    }),
    [studentsInBatch, checked, mode, onLeave],
  )
  const onLeaveCount = useMemo(
    () => studentsInBatch.reduce((n, s) => n + (onLeave.has(s.lwsId) ? 1 : 0), 0),
    [studentsInBatch, onLeave],
  )

  if (!open) return null

  function toggle(lwsId) {
    if (onLeave.has(lwsId)) return   // locked — a leave already explains the day
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(lwsId)) next.delete(lwsId)
      else next.add(lwsId)
      return next
    })
  }

  function switchMode(next) {
    if (next === mode) return
    setMode(next)
    setChecked(new Set())   // a tap means the opposite now — start the list fresh
  }

  function handleSave() {
    onSave?.(derivedAbsent)
    onClose?.()
  }

  const tapHint = mode === 'present'
    ? 'Tap the students who were PRESENT — everyone else (minus leaves) is logged absent.'
    : 'Tap the students who were ABSENT.'

  return (
    <ModalShell title={`Mark attendance — ${subject} · ${fmtDate(date)}`} onClose={onClose} wide>
      {/* Mode toggle */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {[['absent', 'Absentees'], ['present', 'Present list']].map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => switchMode(v)}
              aria-pressed={mode === v}
              className={`px-4 py-2 text-[12px] font-semibold min-h-[40px] ${mode === v ? 'bg-accent text-black' : 'text-ink-3 hover:text-ink'}`}
            >{label}</button>
          ))}
        </div>
        <span className="text-[12px] text-ink-3">{tapHint}</span>
      </div>

      {/* Live preview of the derived absentee set */}
      <div className="flex flex-wrap gap-3 mb-3 text-[12px]">
        <span className="card px-3 py-1.5">Will log absent <b className="text-red-400">{derivedAbsent.length}</b></span>
        {onLeaveCount > 0 && (
          <span className="card px-3 py-1.5">On leave (excluded) <b className="text-purple-400">{onLeaveCount}</b></span>
        )}
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search students…"
        className="form-input w-full text-[13px] min-h-[44px] px-3 mb-3"
        aria-label="Search students in this batch"
      />

      {visible.length === 0 ? (
        <div className="text-[12px] text-ink-3 italic py-6 text-center">No matching students.</div>
      ) : (
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {visible.map(s => {
            const locked = onLeave.has(s.lwsId)
            return (
              <label
                key={s.lwsId}
                className={`flex items-center gap-3 px-3 py-2 rounded min-h-[44px] ${locked ? 'opacity-70 bg-purple-400/5' : 'hover:bg-surface-2 cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={!locked && checked.has(s.lwsId)}
                  disabled={locked}
                  onChange={() => toggle(s.lwsId)}
                  className="w-4 h-4"
                  aria-label={`${s.name}${locked ? ' (on leave)' : ''}`}
                />
                <span className="text-[13px] font-medium text-ink">{s.name}</span>
                {locked && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-purple-400 border border-purple-400/30 rounded px-1.5 py-0.5">on leave</span>
                )}
                {locked && onMarkReturned && (
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); onMarkReturned(s.lwsId) }}
                    className="text-[11px] underline text-ink-3 hover:text-accent"
                    aria-label={`${s.name} returned — close leave`}
                  >returned?</button>
                )}
                <span className="text-[11px] font-mono text-ink-3 ml-auto">{s.lwsId}</span>
              </label>
            )
          })}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-border">
        <button type="button" onClick={onClose} className="btn text-[13px] min-h-[44px] px-4">Cancel</button>
        <button type="button" onClick={handleSave} className="btn btn-primary text-[13px] min-h-[44px] px-4">
          Save ({derivedAbsent.length} absent)
        </button>
      </div>
    </ModalShell>
  )
}
