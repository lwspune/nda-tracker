import { useEffect, useId, useState } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

const PAGE_SIZE = 5

const PAGER_BTN = `btn btn-secondary btn-sm min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`

// Per-student daily-quiz history for the admin/teacher StudentView.
// Fetches the student's attempts (session-gated slice read) and joins to the
// quizzes store for titles. Hidden when the student has no attempts.
// Collapsed by default — the header carries the count and average on its own.
export default function StudentQuizHistory({ lwsId }) {
  const getQuizAttemptsForStudent = useStore(s => s.getQuizAttemptsForStudent)
  const quizzes = useStore(s => s.quizzes)
  const [attempts, setAttempts] = useState([])
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)
  const [pageFor, setPageFor] = useState(lwsId)
  const listId = useId()

  // A different student starts on page 1, not on whatever page the last one was left at.
  if (pageFor !== lwsId) {
    setPageFor(lwsId)
    setPage(0)
  }

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

  const avgPct = rows.reduce((s, r) => s + (r.total ? (r.correct || 0) / r.total : 0), 0) / rows.length

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, totalPages - 1)
  const start      = safePage * PAGE_SIZE
  const end        = Math.min(start + PAGE_SIZE, rows.length)
  const visible    = rows.slice(start, end)

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls={listId}
        className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left rounded
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="text-[11px] font-bold text-ink-3 uppercase tracking-wide">
          📝 Daily Quiz history ({rows.length})
        </span>
        <span className="flex items-center gap-3 text-[11px] font-mono text-ink-3">
          avg {(avgPct * 100).toFixed(0)}% correct
          <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {expanded && (
        <div id={listId} className="mt-2">
          <div className="divide-y divide-border">
            {visible.map(r => (
              <div key={r.quizId} data-testid="quiz-row" className="py-2 flex items-center gap-3 text-[13px]">
                <div data-title className="flex-1 min-w-0 truncate font-medium text-ink">{r.title}</div>
                <div className="text-ink-3 font-mono text-[11px]">{r.correct}/{r.total} correct</div>
                <div className="font-bold text-accent w-10 text-right">{r.score}</div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
              <button
                type="button"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
                className={PAGER_BTN}
              >
                ← Prev
              </button>
              <span className="text-[12px] text-ink-3 font-mono">
                Showing {start + 1}–{end} of {rows.length}
              </span>
              <button
                type="button"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage === totalPages - 1}
                className={PAGER_BTN}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
