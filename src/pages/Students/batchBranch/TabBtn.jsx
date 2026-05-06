import { useState } from 'react'

export function TabBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 text-[13px] font-semibold rounded-lg transition-colors
        ${active
          ? 'bg-accent text-white'
          : 'bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent'}`}
    >
      {label}
    </button>
  )
}

// Inline-editable rename row
export function RenameRow({ name, studentCount, examCount, saving, onSave, studentNames = [] }) {
  const [editing, setEditing]   = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [value, setValue]       = useState(name)

  function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === name) { setEditing(false); setValue(name); return }
    onSave(name, trimmed)
    setEditing(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false); setValue(name) }
  }

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 py-2.5">
        {editing ? (
          <>
            <input
              autoFocus
              className="form-input flex-1 text-[13px] py-1.5"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={handleSave}
              disabled={saving || !value.trim() || value.trim() === name}
              className="btn btn-primary btn-sm text-[12px] px-3 py-1.5"
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(name) }}
              className="btn btn-secondary btn-sm text-[12px] px-3 py-1.5"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {studentNames.length > 0 && (
              <button
                onClick={() => setExpanded(x => !x)}
                className="text-ink-3 hover:text-accent transition-colors flex-shrink-0 w-5 text-center text-[11px]"
                title={expanded ? 'Hide students' : 'Show students'}
              >
                {expanded ? '▾' : '▸'}
              </button>
            )}
            <span className="flex-1 text-[13px] font-medium text-ink truncate">{name}</span>
            <span className="text-[11px] text-ink-3 font-mono whitespace-nowrap">
              {studentCount > 0 && `${studentCount} student${studentCount !== 1 ? 's' : ''}`}
              {studentCount > 0 && examCount > 0 && ' · '}
              {examCount > 0 && `${examCount} exam${examCount !== 1 ? 's' : ''}`}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="btn btn-secondary btn-sm text-[12px] px-3 py-1.5 flex-shrink-0"
            >
              Rename
            </button>
          </>
        )}
      </div>

      {expanded && studentNames.length > 0 && (
        <div className="pb-3 pl-8 flex flex-wrap gap-1.5">
          {[...studentNames].sort().map(n => (
            <span key={n} className="text-[11px] bg-surface-2 text-ink-2 px-2 py-0.5 rounded-md border border-border">
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
