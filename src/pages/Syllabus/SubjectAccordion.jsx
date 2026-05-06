import { useState } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'

// ── Timeline helpers ──────────────────────────────────────────
function formatTimeline(val) {
  if (!val) return null
  const [year, month] = val.split('-').map(Number)
  return new Date(year, month - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function TimelineCell({ value, onSave, isFaculty }) {
  const [editing, setEditing] = useState(false)

  if (!isFaculty) {
    return (
      <td className="px-2 py-1.5 text-center">
        <span className="text-[10.5px] text-ink-2">{formatTimeline(value) ?? '—'}</span>
      </td>
    )
  }

  return (
    <td className="px-2 py-1.5 text-center">
      {editing ? (
        <input
          type="month"
          autoFocus
          className="text-[10.5px] rounded border border-border bg-surface px-1.5 py-0.5 w-[110px] focus:outline-none focus:border-accent"
          defaultValue={value ?? ''}
          onChange={e => { onSave(e.target.value || null); setEditing(false) }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => e.key === 'Escape' && setEditing(false)}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[10.5px] rounded px-2 py-1 min-w-[72px] transition-colors bg-surface-2 text-ink-3 hover:opacity-80 active:scale-95"
        >
          {formatTimeline(value) ?? '—'}
        </button>
      )}
    </td>
  )
}

// ── Status cell ───────────────────────────────────────────────
const STATUS_STYLES = {
  null:          'bg-surface-2 text-ink-3',
  'In Progress': 'bg-amber-100 text-amber-800 font-semibold',
  'Done':        'bg-green-100 text-green-800 font-semibold',
}
const STATUS_LABELS = { null: '—', 'In Progress': 'In Progress', 'Done': 'Done' }

function StatusCell({ status, onClick, isFaculty }) {
  return (
    <td className="px-2 py-1.5 text-center">
      <button
        disabled={!isFaculty}
        onClick={onClick}
        className={`
          text-[10.5px] rounded px-2 py-1 min-w-[72px] transition-colors
          ${STATUS_STYLES[status] ?? STATUS_STYLES[null]}
          ${isFaculty ? 'cursor-pointer hover:opacity-80 active:scale-95' : 'cursor-default'}
        `}
      >
        {STATUS_LABELS[status] ?? '—'}
      </button>
    </td>
  )
}

// ── Progress pill ─────────────────────────────────────────────
function ProgressPill({ done, inProgress, total }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const color = pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-400' : 'bg-surface-3'
  return (
    <span className="flex items-center gap-2 text-[11px] text-ink-2 font-mono select-none">
      <span className="hidden sm:inline">
        <span className="text-success font-bold">{done}</span>
        {inProgress > 0 && <span className="text-warning"> +{inProgress}</span>}
        <span className="text-ink-3"> / {total}</span>
      </span>
      <span className="w-16 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <span
          className={`block h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-ink-3">{pct}%</span>
    </span>
  )
}

export default function SubjectAccordion({ subject, program, batchName, onEdit }) {
  const [open, setOpen] = useState(false)
  const mode = useMode()
  const isFaculty = mode === 'faculty'

  const cycleChapterStatus    = useStore(s => s.cycleChapterStatus)
  const getChapterStatus      = useStore(s => s.getChapterStatus)
  const getSubjectProgress    = useStore(s => s.getSubjectProgress)
  const clearSubjectProgress  = useStore(s => s.clearSubjectProgress)
  const setChapterTimeline    = useStore(s => s.setChapterTimeline)
  const getChapterTimeline    = useStore(s => s.getChapterTimeline)
  // Subscribe to progress and timelines so the component re-renders on changes
  useStore(s => s.batchSyllabusProgress)
  useStore(s => s.batchChapterTimelines)

  const progress = getSubjectProgress(batchName, program.id, subject.id)
  const cols = program.trackingColumns

  // Group chapters under section headers
  const groups = []
  let currentGroup = undefined  // sentinel — distinct from null (which is a valid group value)
  for (const ch of subject.chapters) {
    if (groups.length === 0 || ch.group !== currentGroup) {
      currentGroup = ch.group
      groups.push({ groupName: currentGroup, chapters: [] })
    }
    groups[groups.length - 1].chapters.push(ch)
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-surface hover:bg-surface-2 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] text-ink-3 transition-transform duration-200 inline-block"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >▶</span>
          <span className="font-semibold text-[14px] text-ink">{subject.name}</span>
          <span className="text-[11px] text-ink-3 font-mono">{subject.chapters.length} chapters</span>
        </div>
        <div className="flex items-center gap-2">
          <ProgressPill {...progress} />
          {isFaculty && (
            <>
              <button
                className="p-1.5 rounded-lg text-ink-3 hover:bg-red-50 hover:text-red-500 transition-colors text-[11px]"
                onClick={e => {
                  e.stopPropagation()
                  if (confirm(`Clear all progress for "${subject.name}" in batch "${batchName}"? This cannot be undone.`)) {
                    clearSubjectProgress(batchName, program.id, subject.id)
                  }
                }}
                title="Clear progress"
              >✕ Clear</button>
              <button
                className="p-1.5 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink transition-colors text-[13px]"
                onClick={e => { e.stopPropagation(); onEdit() }}
                title="Edit subject"
              >✎</button>
            </>
          )}
        </div>
      </button>

      {/* Chapter table */}
      {open && (
        <div className="overflow-x-auto border-t border-border">
          {subject.chapters.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-ink-3">
              No chapters yet.{isFaculty && ' Click ✎ to add chapters.'}
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-surface-2 text-ink-3 text-[10.5px] uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-semibold w-full">Chapter</th>
                  <th className="px-2 py-2 text-center font-semibold whitespace-nowrap min-w-[82px]">Timeline</th>
                  {cols.map(col => (
                    <th key={col} className="px-2 py-2 text-center font-semibold whitespace-nowrap min-w-[82px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(({ groupName, chapters }) => (
                  <>
                    {groupName && (
                      <tr key={`grp-${groupName}`} className="bg-accent-soft/30">
                        <td
                          colSpan={cols.length + 2}
                          className="px-4 py-1.5 text-[11px] font-bold text-accent uppercase tracking-wide"
                        >
                          {groupName}
                        </td>
                      </tr>
                    )}
                    {chapters.map(ch => (
                      <tr key={ch.id} className="border-t border-border/50 hover:bg-surface-2/50 transition-colors">
                        <td className="px-4 py-2 text-ink-2 leading-snug">{ch.name}</td>
                        <TimelineCell
                          value={getChapterTimeline(batchName, program.id, subject.id, ch.id)}
                          onSave={val => setChapterTimeline(batchName, program.id, subject.id, ch.id, val)}
                          isFaculty={isFaculty}
                        />
                        {cols.map(col => (
                          <StatusCell
                            key={col}
                            status={getChapterStatus(batchName, program.id, subject.id, ch.id, col)}
                            onClick={() => cycleChapterStatus(batchName, program.id, subject.id, ch.id, col)}
                            isFaculty={isFaculty}
                          />
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
