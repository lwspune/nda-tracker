import { useState } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

// Handles both normal cells (day) and span cells (__span)
export default function EditCellModal({ timetableId, slotId, day, currentCell, onClose }) {
  const mappings            = useStore(s => s.timetableMappings)
  const teachers            = useStore(s => s.timetableTeachers)
  const setTimetableCell    = useStore(s => s.setTimetableCell)
  const clearTimetableCell  = useStore(s => s.clearTimetableCell)
  const setTimetableSpanCell   = useStore(s => s.setTimetableSpanCell)
  const clearTimetableSpanCell = useStore(s => s.clearTimetableSpanCell)

  const isSpan = day === '__span'

  const [mode, setMode] = useState(() => {
    if (!currentCell) return isSpan ? 'span' : 'class'
    return currentCell.type
  })
  const [selectedMappingId, setSelectedMappingId] = useState(
    currentCell?.type === 'class' ? (currentCell.mappingId ?? '') : ''
  )
  const [breakLabel, setBreakLabel] = useState(
    currentCell?.type === 'break' ? (currentCell.label ?? '') :
    currentCell?.type === 'span'  ? (currentCell.label ?? '') : ''
  )

  function teacherName(tid) {
    return teachers.find(t => t.id === tid)?.name ?? null
  }

  function mappingLabel(m) {
    return `${m.label}${m.teacherId ? ` (${teacherName(m.teacherId) ?? ''})` : ''}`
  }

  // Alphabetical by displayed label (label + teacher suffix); non-mutating copy.
  const sortedMappings = [...mappings].sort((a, b) =>
    mappingLabel(a).localeCompare(mappingLabel(b), undefined, { sensitivity: 'base', numeric: true })
  )

  function handleSave() {
    if (isSpan) {
      setTimetableSpanCell(timetableId, slotId, breakLabel)
    } else if (mode === 'class') {
      if (!selectedMappingId) return
      setTimetableCell(timetableId, slotId, day, 'class', selectedMappingId)
    } else {
      setTimetableCell(timetableId, slotId, day, 'break', null, breakLabel)
    }
    onClose()
  }

  function handleClear() {
    if (isSpan) {
      clearTimetableSpanCell(timetableId, slotId)
    } else {
      clearTimetableCell(timetableId, slotId, day)
    }
    onClose()
  }

  const title = isSpan
    ? 'Set Row Span (full-width break)'
    : `Edit Cell — ${day}`

  return (
    <ModalShell title={title} onClose={onClose}>
      {/* Mode selector — only for non-span cells */}
      {!isSpan && (
        <div className="flex gap-2 mb-1">
          {['class', 'break'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                mode === m
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface border-border text-ink-2 hover:border-accent/50'
              }`}
            >
              {m === 'class' ? 'Class' : 'Break / Free'}
            </button>
          ))}
        </div>
      )}

      {/* Class: pick a mapping */}
      {!isSpan && mode === 'class' && (
        <div>
          <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-2">
            Subject / Teacher
          </label>
          <select
            className="input w-full text-[13px]"
            value={selectedMappingId}
            onChange={e => setSelectedMappingId(e.target.value)}
          >
            <option value="">— Select —</option>
            {sortedMappings.map(m => (
              <option key={m.id} value={m.id}>
                {mappingLabel(m)}
              </option>
            ))}
          </select>
          {mappings.length === 0 && (
            <p className="text-[11px] text-ink-3 mt-1.5">
              No mappings yet — create one in Manage Mappings first.
            </p>
          )}
        </div>
      )}

      {/* Break / span: label */}
      {(isSpan || mode === 'break') && (
        <div>
          <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-2">
            {isSpan ? 'Span Label' : 'Break Label'}
          </label>
          <input
            autoFocus
            className="input w-full text-[13px]"
            placeholder="e.g. Lunch Break"
            value={breakLabel}
            onChange={e => setBreakLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between items-center pt-2 border-t border-border">
        {currentCell ? (
          <button
            className="text-[12px] text-red-500 hover:text-red-700 font-semibold"
            onClick={handleClear}
          >Clear cell</button>
        ) : <div />}
        <div className="flex gap-2">
          <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary text-[12px] px-3 py-1.5 disabled:opacity-40"
            onClick={handleSave}
            disabled={!isSpan && mode === 'class' && !selectedMappingId}
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
