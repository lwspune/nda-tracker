// ── Step indicator ────────────────────────────────────────────

export function Steps({ current }) {
  const steps = ['Student List', 'Exam Files', 'Preview', 'Done']
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((label, i) => {
        const idx       = i + 1
        const active    = idx === current
        const completed = idx < current
        return (
          <div key={label} className="flex items-center gap-1 flex-1 last:flex-none">
            <div className={`
              flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full
              text-[11px] font-bold
              ${completed ? 'bg-success text-white'
              : active    ? 'bg-accent text-white'
              :              'bg-surface-2 text-ink-3'}
            `}>
              {completed ? '✓' : idx}
            </div>
            <span className={`text-[11px] font-medium whitespace-nowrap
              ${active ? 'text-ink' : 'text-ink-3'}`}>
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-1 min-w-[8px]
                ${completed ? 'bg-success' : 'bg-border-2'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Summary tile ──────────────────────────────────────────────

export function SummaryTile({ value, label, color = 'text-ink' }) {
  return (
    <div className="text-center px-4 py-4">
      <div className={`text-[28px] font-extrabold leading-none ${color}`}>{value}</div>
      <div className="text-[11px] text-ink-3 mt-1">{label}</div>
    </div>
  )
}
