// ── Unresolved match row ──────────────────────────────────────

export default function UnresolvedRow({ item, fileIdx, allNames, selections, onSelect, onAssign, onSkip }) {
  const key    = `${fileIdx}:${item.examName}`
  const selVal = selections[key] || ''

  if (item.status !== 'pending') {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-2">
        <span className="text-[11px] text-ink-3 font-mono w-16">{item.rollNo || '—'}</span>
        <span className="text-[13px] text-ink-2 flex-1 line-through">{item.examName}</span>
        <span className={`text-[11px] font-bold ${item.status === 'assigned' ? 'text-success' : 'text-ink-3'}`}>
          {item.status === 'assigned' ? `→ ${item.assignedTo}` : 'Skipped'}
        </span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-ink-3 font-mono w-16 flex-shrink-0">{item.rollNo || '—'}</span>
        <span className="text-[13px] font-medium text-ink flex-1">{item.examName}</span>
      </div>

      {item.candidate ? (
        /* Candidate found (0.55–0.85) — offer quick confirm */
        <div className="flex items-center gap-2 ml-18 pl-16">
          <span className="text-[11px] text-ink-3">Best match:</span>
          <span className="text-[12px] font-semibold text-accent">{item.candidate}</span>
          <span className="text-[10px] text-ink-3">
            ({(item.candidateScore * 100).toFixed(0)}%)
          </span>
          <div className="flex gap-1.5 ml-auto">
            <button
              onClick={() => onAssign(fileIdx, item, item.candidate)}
              className="btn btn-primary text-[11px] px-2.5 py-1"
            >Confirm</button>
            <button
              onClick={() => onSkip(fileIdx, item)}
              className="btn btn-secondary text-[11px] px-2.5 py-1"
            >Skip</button>
          </div>
        </div>
      ) : (
        /* No candidate (<0.55) — show full dropdown */
        <div className="flex items-center gap-2 pl-16">
          <select
            value={selVal}
            onChange={e => onSelect(key, e.target.value)}
            className="form-input flex-1 text-[12px] py-1"
          >
            <option value="">— Select student —</option>
            {allNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={() => selVal && onAssign(fileIdx, item, selVal)}
            disabled={!selVal}
            className="btn btn-primary text-[11px] px-2.5 py-1 disabled:opacity-40"
          >Assign</button>
          <button
            onClick={() => onSkip(fileIdx, item)}
            className="btn btn-secondary text-[11px] px-2.5 py-1"
          >Skip</button>
        </div>
      )}
    </div>
  )
}
