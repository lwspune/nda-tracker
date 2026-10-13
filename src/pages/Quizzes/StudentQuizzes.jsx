import { useEffect, useId, useState } from 'react'
import { Card, Badge, Spinner, Alert } from '../../components/ui'
import { QuizTaker, QuizReview } from './quizTaking'

const PAGE_SIZE = 5

const PAGER_BTN = `btn btn-secondary btn-sm min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`

// Student-facing daily quiz surface (portal only). Fetches open + done quizzes
// for the logged-in mobile, lets the student take an open one, grades server-side
// on submit, then shows a per-question review. Completed quizzes sit behind a
// collapsed, paginated toggle (same shape as the staff-side StudentQuizHistory);
// that state lives here, so returning from a review lands on the same page.
export default function StudentQuizzes({ mobile }) {
  const [loading, setLoading] = useState(true)
  const [quizzes, setQuizzes] = useState([])
  const [error, setError] = useState('')
  const [view, setView] = useState({ mode: 'list' }) // {mode:'list'} | {mode:'take', quiz} | {mode:'review', review}
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)
  const listId = useId()

  async function load() {
    if (!mobile) { setLoading(false); return }
    try {
      const r = await fetch('/api/student-quizzes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not load quizzes')
      setQuizzes(data.quizzes || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch on mount / mobile change
  useEffect(() => { load() }, [mobile])

  if (loading) {
    return (
      <Card className="mb-5 flex items-center gap-2 text-[13px] text-ink-3">
        <Spinner size="sm" /> Loading quizzes…
      </Card>
    )
  }
  if (error) return <div className="mb-5"><Alert type="error">{error}</Alert></div>
  if (!quizzes.length) return null

  if (view.mode === 'take') {
    return (
      <QuizTaker
        quiz={view.quiz}
        mobile={mobile}
        onCancel={() => setView({ mode: 'list' })}
        onSubmitted={(review) => { load(); setView({ mode: 'review', review, title: view.quiz.title, subject: view.quiz.subject }) }}
      />
    )
  }
  if (view.mode === 'review') {
    return <QuizReview title={view.title} review={view.review} subject={view.subject} onBack={() => setView({ mode: 'list' })} />
  }

  const open = quizzes.filter(q => q.state === 'open')
  // The API returns quizzes in database order, so sort here or page 1 is arbitrary.
  const done = quizzes
    .filter(q => q.state === 'done')
    .sort((x, y) => String(y.result?.submittedAt || '').localeCompare(String(x.result?.submittedAt || '')))

  const avgPct = done.length
    ? done.reduce((s, q) => s + (q.questions.length ? (q.result.correct || 0) / q.questions.length : 0), 0) / done.length
    : 0

  const totalPages = Math.ceil(done.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(totalPages - 1, 0))
  const start      = safePage * PAGE_SIZE
  const end        = Math.min(start + PAGE_SIZE, done.length)
  const visible    = done.slice(start, end)

  return (
    <div className="mb-6">
      <div className="text-[13px] font-extrabold text-ink uppercase tracking-wide mb-2">📝 Daily Quiz</div>
      <div className="space-y-2">
        {/* Open quizzes are the only action here and they close — never behind the toggle. */}
        {open.map(q => (
          <Card key={q.id} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-ink truncate">{q.title}</div>
              <div className="text-[11px] text-ink-3 font-mono">{q.subject || '—'} · {q.questions.length} questions{closeLabel(q.closesAt)}</div>
            </div>
            <Badge variant="green">Open</Badge>
            <button className="btn btn-primary text-[12px] px-4" onClick={() => setView({ mode: 'take', quiz: q })}>Take</button>
          </Card>
        ))}
        {done.length > 0 && (
          <Card>
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}
              aria-controls={listId}
              className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left rounded
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span className="text-[13px] font-bold text-ink">Completed ({done.length})</span>
              <span className="flex items-center gap-3 text-[11px] font-mono text-ink-3">
                avg {(avgPct * 100).toFixed(0)}% correct
                <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
              </span>
            </button>

            {expanded && (
              <div id={listId} className="mt-2">
                <div className="divide-y divide-border">
                  {visible.map(q => (
                    <div key={q.id} data-testid="done-quiz" className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div data-title className="text-[14px] font-bold text-ink truncate">{q.title}</div>
                        <div className="text-[11px] text-ink-3 font-mono">
                          Scored {q.result.score} · {q.result.correct}/{q.questions.length} correct
                        </div>
                      </div>
                      <button
                        className="btn btn-secondary text-[12px] px-4"
                        aria-label={`Review ${q.title}`}
                        onClick={() => setView({ mode: 'review', title: q.title, subject: q.subject, review: { review: q.questions, myAnswers: q.myAnswers, ...q.result, total: q.questions.length } })}
                      >Review</button>
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
                      Showing {start + 1}–{end} of {done.length}
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
        )}
      </div>
    </div>
  )
}

function closeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return ` · closes ${d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}
