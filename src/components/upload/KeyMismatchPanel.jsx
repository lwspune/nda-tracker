// Highlights answer-key disagreements between the tags file and the results Excel,
// letting faculty pick the correct key per question. Non-blocking — mirrors the
// amber warning style of ValidationIssuesPanel.
//
// Props:
//   mismatches — [{ q, tagsAnswer, resultsAnswer }]
//   choices    — { [q]: 'results' | 'tags' }
//   onPick     — (q, source) => void   // source ∈ 'results' | 'tags'
export default function KeyMismatchPanel({ mismatches, choices, onPick }) {
  if (!mismatches.length) return null

  return (
    <div className="mb-4 border border-amber-300 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
        <span className="text-amber-700 font-bold text-[13px]">
          ⚠️ {mismatches.length} answer-key mismatch{mismatches.length > 1 ? 'es' : ''} between the tags file and the results Excel — pick the correct key
        </span>
        <div className="text-[10.5px] text-amber-700/80 mt-0.5">
          This sets the displayed correct answer, solution &amp; per-question analytics. Student marks are unaffected.
        </div>
      </div>

      {/* Rows */}
      <fieldset className="divide-y divide-amber-100 border-0 m-0 p-0">
        <legend className="sr-only">Resolve answer-key mismatches</legend>
        {mismatches.map(m => {
          const picked = choices[m.q] || 'results'
          return (
            <div key={m.q} className="px-4 py-3 bg-white flex items-center gap-3 flex-wrap">
              <span className="font-mono font-bold text-[11px] text-ink-3 flex-shrink-0 w-8">
                Q{m.q}
              </span>
              <KeyChip
                q={m.q} source="results" label="Results" letter={m.resultsAnswer}
                selected={picked === 'results'} onPick={onPick}
              />
              <KeyChip
                q={m.q} source="tags" label="Tags" letter={m.tagsAnswer}
                selected={picked === 'tags'} onPick={onPick}
              />
            </div>
          )
        })}
      </fieldset>
    </div>
  )
}

function KeyChip({ q, source, label, letter, selected, onPick }) {
  return (
    <label
      className={`flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded border cursor-pointer
                  transition-colors focus-within:ring-2 focus-within:ring-accent/50
        ${selected
          ? 'text-success bg-green-50 border-green-300'
          : 'text-ink-3 bg-surface-2 border-ink-3/20 hover:border-ink-3/40'}`}
    >
      <input
        type="radio"
        name={`keymismatch-${q}`}
        className="sr-only"
        checked={selected}
        onChange={() => onPick(q, source)}
        aria-label={`Use ${label} answer ${letter} for question ${q}`}
      />
      <span className="uppercase tracking-[0.5px] text-[10px]">{label}</span>
      <span className="font-mono font-bold">{letter}</span>
      {selected && <span aria-hidden="true">✓</span>}
    </label>
  )
}
