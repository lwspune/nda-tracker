// ── Internal utilities for analytics.js ──────────────────────
// These are also exported so tests or other modules can use them.

// Comparable paper ceiling for an exam. MCQ exams derive it from
// questions.length × marking.correct; offline / manually-recorded exams (no
// questions[]) carry an explicit positive `maxMarks`, which wins when present.
// Returns 0 when neither is usable (caller treats that as "not scorable").
export function examMaxMarks(exam) {
  const explicit = Number(exam?.maxMarks)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return (exam?.questions?.length || 0) * (exam?.marking?.correct || 0)
}

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
