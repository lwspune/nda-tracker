// Newer / "Page x of y" / Older for a list shown newest first — the student
// portal's paged cards (homework, calculation errors, missed tests). Renders
// nothing when the list fits on one page. Same words and order as Exam History.
export default function Pager({ page, totalPages, onPage, label = 'Pages' }) {
  if (totalPages <= 1) return null
  const btn = `btn btn-secondary btn-sm min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed
               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 pt-3">
      <button type="button" className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>
        ← Newer
      </button>
      <span className="text-[12px] text-ink-3">Page {page + 1} of {totalPages}</span>
      <button type="button" className={btn} disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
        Older →
      </button>
    </nav>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const pageCount = (n, size) => Math.max(1, Math.ceil(n / size))

// One page of `items`. Clamps a page that no longer exists — the list can
// shrink under an open page (a reload after handing in) — to the last one.
// eslint-disable-next-line react-refresh/only-export-components
export function pageSlice(items, page, size) {
  const last = pageCount(items.length, size) - 1
  const p = Math.min(Math.max(0, page), last)
  return { page: p, rows: items.slice(p * size, p * size + size) }
}
