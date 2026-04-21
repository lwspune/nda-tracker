// ── Internal utilities for analytics.js ──────────────────────
// These are also exported so tests or other modules can use them.

export function stdDev(arr) {
  if (arr.length < 2) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

export function scoreColor(pct) {
  if (pct >= 0.7) return 'text-success'
  if (pct >= 0.45) return 'text-warning'
  return 'text-danger'
}

export function scoreBg(pct) {
  if (pct >= 0.7) return '#16a34a'
  if (pct >= 0.45) return '#d97706'
  return '#e03e3e'
}
