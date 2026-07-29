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

// MCQ or written — DERIVED, never stored.
//
// Every exam here is conducted offline; Evalbee doesn't make one "online", it
// machine-grades a paper MCQ sheet and produces per-question data. A written
// paper is graded by hand, so only a total can be recorded. That presence or
// absence of `questions[]` IS the format, which is why there is no `format`
// column and must not become one.
//
// Independent of `source` (who created it): an admin-entered written test is
// exactly as written as a teacher-entered one. Tagging on `source` left the
// admin-entered Integration / Vector / English papers untagged — fixed 2026-07-28.
export function examFormat(exam) {
  return exam?.questions?.length ? 'mcq' : 'written'
}

// Parent-facing label for the format. Used in the monthly report exam table and
// the admin Exams page badge; keep the two rendering the same words.
export function examFormatLabel(exam) {
  return examFormat(exam) === 'mcq' ? 'MCQ' : 'Written'
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
