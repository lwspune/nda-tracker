// Pure analytics for the daily-quiz response dashboard (Phase 3).
// Deliberately separate from exam analytics — quizzes are formative + high-frequency.
import { getExamBatches } from './analytics/filters'

// Active students who should take this quiz: batch ∩ quiz batches (empty quiz batch
// = all batches). Skips variant-keyed profile entries (p.name !== key) and non-Active.
export function quizCohort(studentProfiles, quiz) {
  if (!studentProfiles) return []
  const batches = getExamBatches({ batch: quiz?.batch })
  const batchSet = new Set(batches)
  const allBatches = batches.length === 0
  const out = []
  for (const [key, p] of Object.entries(studentProfiles)) {
    if (!p || p.name !== key) continue
    if (p.accountStatus !== 'Active') continue
    if (!allBatches && !(p.batches || []).some(b => batchSet.has(b))) continue
    out.push(p)
  }
  return out
}

// Attempt-count, mean score, mean %-of-max for a quiz.
export function quizSummary(quiz, attempts) {
  const n = attempts?.length || 0
  const maxScore = (quiz?.questions?.length || 0) * (quiz?.marking?.correct ?? 1)
  if (n === 0) return { n: 0, avgScore: 0, avgPct: 0, maxScore }
  const totalScore = attempts.reduce((s, a) => s + (a.score || 0), 0)
  const avgScore = totalScore / n
  const avgPct = maxScore > 0 ? avgScore / maxScore : 0
  return { n, avgScore, avgPct, maxScore }
}

// Per-question correctness across all attempts. `pct` is over ALL attempts
// (a skipped question counts against the question), matching how faculty read
// "how many of the class got this right".
export function quizQuestionStats(quiz, attempts) {
  const n = attempts?.length || 0
  return (quiz?.questions || []).map(q => {
    const key = String(q.q)
    const right = String(q.answer || '').toUpperCase()
    let correctCount = 0, attemptedCount = 0, skipped = 0
    const dist = { A: 0, B: 0, C: 0, D: 0 }   // how many chose each option
    for (const a of attempts || []) {
      const chosen = String(a.answers?.[key] ?? '').toUpperCase()
      if (!chosen) { skipped++; continue }
      attemptedCount++
      if (chosen in dist) dist[chosen]++
      if (chosen === right) correctCount++
    }
    return {
      q: q.q,
      chapter: q.chapter || '',
      question: q.question || '',
      correctCount,
      attemptedCount,
      skipped,
      dist,
      n,
      pct: n > 0 ? correctCount / n : 0,
    }
  })
}

// Attach each attempting student's current branch + batches (looked up by lwsId
// against the canonical profile entries) for the Attempted-list columns. Pure.
// Missing profile → branch '' / batches []. Variant-keyed entries (p.name !== key)
// are skipped when indexing so a name variant can't shadow the canonical profile.
export function attemptsWithProfile(attempts, studentProfiles) {
  const byId = {}
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key || !p.lwsId) continue
    byId[p.lwsId] = p
  }
  return (attempts || []).map(a => {
    const p = byId[a.lwsId]
    return { ...a, branch: p?.branch || '', batches: p?.batches || [] }
  })
}

// Cohort members who have no attempt row yet.
export function quizNotAttempted(cohort, attempts) {
  const attemptedIds = new Set((attempts || []).map(a => a.lwsId))
  return (cohort || []).filter(p => !attemptedIds.has(p.lwsId))
}
