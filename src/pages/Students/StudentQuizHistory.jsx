import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

// Per-student daily-quiz history for the admin/teacher StudentView.
// Fetches the student's attempts (session-gated slice read) and joins to the
// quizzes store for titles. Hidden when the student has no attempts.
export default function StudentQuizHistory({ lwsId }) {
  const getQuizAttemptsForStudent = useStore(s => s.getQuizAttemptsForStudent)
  const quizzes = useStore(s => s.quizzes)
  const [attempts, setAttempts] = useState([])

  useEffect(() => {
    if (!lwsId || typeof getQuizAttemptsForStudent !== 'function') return
    let cancelled = false
    getQuizAttemptsForStudent(lwsId).then(rows => { if (!cancelled) setAttempts(rows || []) })
    return () => { cancelled = true }
  }, [lwsId, getQuizAttemptsForStudent])

  if (!attempts.length) return null

  const quizById = new Map(quizzes.map(q => [q.id, q]))
  const rows = attempts
    .map(a => {
      const quiz = quizById.get(a.quizId)
      const total = quiz?.questions?.length ?? ((a.correct || 0) + (a.incorrect || 0) + (a.notAttempted || 0))
      return { ...a, title: quiz?.title || 'Quiz', subject: quiz?.subject || '', total }
    })
    .sort((x, y) => String(y.submittedAt || '').localeCompare(String(x.submittedAt || '')))

  const avgPct = rows.length
    ? rows.reduce((s, r) => s + (r.total ? (r.correct || 0) / r.total : 0), 0) / rows.length
    : 0

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide">📝 Daily Quiz history ({rows.length})</div>
        <div className="text-[11px] font-mono text-ink-3">avg {(avgPct * 100).toFixed(0)}% correct</div>
      </div>
      <div className="divide-y divide-border">
        {rows.map(r => (
          <div key={r.quizId} className="py-2 flex items-center gap-3 text-[13px]">
            <div className="flex-1 min-w-0 truncate font-medium text-ink">{r.title}</div>
            <div className="text-ink-3 font-mono text-[11px]">{r.correct}/{r.total} correct</div>
            <div className="font-bold text-accent w-10 text-right">{r.score}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
