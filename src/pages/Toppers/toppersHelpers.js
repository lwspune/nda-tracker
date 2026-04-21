// ── Pure helpers for ToppersPage ─────────────────────────────

// Returns the most common subject across a set of exams
export function getPrimarySubject(exams) {
  if (!exams.length) return 'Maths'
  const counts = {}
  exams.forEach(e => {
    const s = e.subject || 'Maths'
    counts[s] = (counts[s] || 0) + 1
  })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

// ── Constants ─────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { value: 'projected',      label: 'Projected Score' },
  { value: 'avgPct',         label: 'Average %' },
  { value: 'attemptQuality', label: 'Attempt Quality' },
]

export const CONSISTENCY_COLOR = {
  success: 'text-success',
  warning: 'text-warning',
  danger:  'text-danger',
}
