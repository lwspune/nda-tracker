import { useMemo, useState, useEffect } from 'react'
import ModalShell from '../Timetable/ModalShell'

// Modeled on MarkAbsenteesModal: pick which students have NOT completed a single
// homework item (subject + chapter + type). The modal owns the draft checked-set
// so partial edits don't write until Save. Search filters the visible list but
// never drops previously-checked students from the saved set.
export default function MarkDefaultersModal({
  open,
  subject,
  chapter,
  studentsInBatch,
  initialDefaulters,
  onSave,
  onClose,
}) {
  const [checked, setChecked] = useState(() => new Set(initialDefaulters))
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecked(new Set(initialDefaulters))
      setQuery('')
    }
  }, [open, initialDefaulters])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return studentsInBatch
    return studentsInBatch.filter(s => s.name.toLowerCase().includes(q))
  }, [studentsInBatch, query])

  if (!open) return null

  function toggle(lwsId) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(lwsId)) next.delete(lwsId)
      else next.add(lwsId)
      return next
    })
  }

  function handleSave() {
    const ordered = studentsInBatch.map(s => s.lwsId).filter(id => checked.has(id))
    onSave?.(ordered)
    onClose?.()
  }

  return (
    <ModalShell
      title={`Mark pending — ${subject}${chapter ? ` · ${chapter}` : ''}`}
      onClose={onClose}
      wide
    >
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search students…"
        className="form-input w-full text-[13px] min-h-[44px] px-3 mb-3"
        aria-label="Search students in this batch"
      />

      {visible.length === 0 ? (
        <div className="text-[12px] text-ink-3 italic py-6 text-center">
          No matching students.
        </div>
      ) : (
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {visible.map(s => (
            <label
              key={s.lwsId}
              className="flex items-center gap-3 px-3 py-2 rounded hover:bg-surface-2 cursor-pointer min-h-[44px]"
            >
              <input
                type="checkbox"
                checked={checked.has(s.lwsId)}
                onChange={() => toggle(s.lwsId)}
                className="w-4 h-4"
              />
              <span className="text-[13px] font-medium text-ink">{s.name}</span>
              <span className="text-[11px] font-mono text-ink-3 ml-auto">{s.lwsId}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-border">
        <button type="button" onClick={onClose} className="btn text-[13px] min-h-[44px] px-4">
          Cancel
        </button>
        <button type="button" onClick={handleSave} className="btn btn-primary text-[13px] min-h-[44px] px-4">
          Save
        </button>
      </div>
    </ModalShell>
  )
}
