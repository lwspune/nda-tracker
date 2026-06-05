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
    let correctCount = 0, attemptedCount = 0
    for (const a of attempts || []) {
      const chosen = String(a.answers?.[key] ?? '').toUpperCase()
      if (chosen) attemptedCount++
      if (chosen && chosen === right) correctCount++
    }
    return {
      q: q.q,
      chapter: q.chapter || '',
      question: q.question || '',
      correctCount,
      attemptedCount,
      n,
      pct: n > 0 ? correctCount / n : 0,
    }
  })
}

// Cohort members who have no attempt row yet.
export function quizNotAttempted(cohort, attempts) {
  const attemptedIds = new Set((attempts || []).map(a => a.lwsId))
  return (cohort || []).filter(p => !attemptedIds.has(p.lwsId))
}
