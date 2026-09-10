// One student's row on the Error Sets page: what their document will contain,
// whether it ships in the ZIP, and a single-file download.

export default function ErrorSetRow({
  row, included, onToggle, onDownload, busy,
}) {
  const { profile, totals } = row
  const { wrong = 0, skipped = 0, absent = 0 } = totals.counts || {}
  const capped = totals.available > totals.questions

  return (
    <div
      data-testid="errorset-student"
      className="flex flex-wrap items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0"
    >
      <input
        type="checkbox"
        checked={included}
        onChange={() => onToggle(profile.lwsId)}
        aria-label={`Include ${profile.name} in the archive`}
        className="w-4 h-4 accent-accent cursor-pointer flex-shrink-0"
      />

      <div className="flex-1 min-w-[150px]">
        <div className="text-[13px] font-semibold text-ink">{profile.name}</div>
        {row.thin && (
          <div className="text-[11px] text-amber-600">
            ⚠ too few questions to be worth handing out
          </div>
        )}
      </div>

      <div className="text-[13px] text-ink tabular-nums">
        <span data-testid="q-count" className="font-bold">{totals.questions}</span>
        <span className="text-ink-3"> questions</span>
        {capped && <span className="text-ink-3"> of {totals.available}</span>}
      </div>

      <div className="text-[11px] text-ink-3 tabular-nums min-w-[170px]">
        {wrong} wrong · {skipped} skipped{absent ? ` · ${absent} missed` : ''}
      </div>

      <button
        type="button"
        onClick={() => onDownload(row)}
        disabled={busy || totals.questions === 0}
        className="btn text-[12px] min-h-[36px] px-3 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={`Download ${profile.name}'s error set`}
      >
        ⬇
      </button>
    </div>
  )
}
