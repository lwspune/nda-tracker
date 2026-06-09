import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { Card, Badge, Spinner, EmptyState, HeatBar } from '../../components/ui'
import { Math as Tex } from '../../components/ui/Math'  // aliased — `Math` would shadow the global
import { quizStatus, LETTERS } from '../../lib/quiz'
import { quizCohort, quizSummary, quizQuestionStats, quizNotAttempted, attemptsWithProfile } from '../../lib/quizStats'

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function QuizResults({ quiz, onBack }) {
  const getQuizAttempts = useStore(s => s.getQuizAttempts)
  const studentProfiles = useStore(s => s.studentProfiles)
  const [loading, setLoading] = useState(true)
  const [attempts, setAttempts] = useState([])
  const [expandedQ, setExpandedQ] = useState(null)   // which per-question row is open

  useEffect(() => {
    // No synchronous setState here — `loading` starts true and the component
    // mounts fresh per quiz, so there's nothing to reset before the fetch.
    let cancelled = false
    getQuizAttempts(quiz.id).then(rows => {
      if (!cancelled) { setAttempts(rows || []); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [quiz.id, getQuizAttempts])

  const cohort = quizCohort(studentProfiles, quiz)
  const summary = quizSummary(quiz, attempts)
  const qStats = quizQuestionStats(quiz, attempts)
  const missing = quizNotAttempted(cohort, attempts)
  const status = quizStatus(quiz)
  const sortedAttempts = [...attempts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const attemptRows = attemptsWithProfile(sortedAttempts, studentProfiles)
  const qById = Object.fromEntries((quiz.questions || []).map(q => [q.q, q]))

  return (
    <div className="max-w-3xl">
      <button className="text-[13px] text-ink-3 hover:text-ink mb-3" onClick={onBack}>← Back to quizzes</button>

      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-[22px] font-extrabold text-ink tracking-tight">{quiz.title}</h1>
        <Badge variant={status === 'open' ? 'green' : status === 'closed' ? 'red' : 'gray'}>{status}</Badge>
      </div>

      {loading ? (
        <Card className="flex items-center gap-2 text-[13px] text-ink-3"><Spinner size="sm" /> Loading attempts…</Card>
      ) : attempts.length === 0 ? (
        <EmptyState icon="📭" title="No attempts yet" sub={`${cohort.length} student${cohort.length !== 1 ? 's' : ''} in this quiz's cohort haven't taken it yet.`} />
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Attempts" value={`${summary.n}${cohort.length ? ` / ${cohort.length}` : ''}`} />
            <StatBox label="Avg score" value={`${summary.avgScore.toFixed(1)} / ${summary.maxScore}`} />
            <StatBox label="Avg %" value={`${(summary.avgPct * 100).toFixed(0)}%`} />
          </div>

          {/* Per-question correct % */}
          <Card>
            <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Per-question correct %</div>
            {qStats.map(st => {
              const open = expandedQ === st.q
              const q = qById[st.q]
              const right = String(q?.answer || '').toUpperCase()
              return (
                <div key={st.q}>
                  <HeatBar
                    pct={st.pct}
                    label={`Q${st.q}${st.chapter ? ` · ${st.chapter}` : ''}`}
                    count={`${st.correctCount}/${st.n}`}
                    onClick={() => setExpandedQ(open ? null : st.q)}
                    chevron={open}
                  />
                  {open && q && (
                    <div className="mt-1 mb-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                      <div className="text-[13px] font-semibold text-ink mb-2 overflow-x-auto"><Tex>{q.question}</Tex></div>
                      <div className="space-y-1.5">
                        {LETTERS.map(letter => {
                          const text = q[`option${letter}`]
                          if (text === undefined || text === null || text === '') return null
                          const isRight = letter === right
                          const picks = st.dist?.[letter] || 0
                          const pickPct = st.n > 0 ? Math.round((picks / st.n) * 100) : 0
                          return (
                            <div
                              key={letter}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${isRight ? 'border-green-300 bg-green-50 text-green-900' : 'border-border bg-surface text-ink-2'}`}
                            >
                              <span className="w-5 text-[11px] font-bold flex-shrink-0">{letter}</span>
                              <span className="flex-1 min-w-0 overflow-x-auto"><Tex>{String(text)}</Tex></span>
                              {isRight && <span className="text-[10px] font-bold text-green-700 flex-shrink-0">CORRECT</span>}
                              <span className="font-mono text-[11px] text-ink-3 w-16 text-right flex-shrink-0">{pickPct}% ({picks})</span>
                            </div>
                          )
                        })}
                        {st.skipped > 0 && (
                          <div className="font-mono text-[11px] text-ink-3 pl-1">
                            Skipped: {st.n > 0 ? Math.round((st.skipped / st.n) * 100) : 0}% ({st.skipped})
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </Card>

          {/* Attempted students */}
          <Card>
            <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Attempted ({attemptRows.length})</div>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-ink-3 pb-1 border-b border-border">
              <div className="flex-1 min-w-0">Name</div>
              <div className="w-20 hidden sm:block">Branch</div>
              <div className="w-40 hidden md:block">Batch</div>
              <div className="w-14 text-right">Correct</div>
              <div className="w-10 text-right">Score</div>
              <div className="w-24 text-right hidden sm:block">Time</div>
            </div>
            <div className="divide-y divide-border">
              {attemptRows.map(a => (
                <div key={a.lwsId} className="py-2 flex items-center gap-3 text-[13px]">
                  <div className="flex-1 min-w-0 truncate font-medium text-ink">{a.studentName}</div>
                  <div className="w-20 text-ink-3 text-[11px] truncate hidden sm:block">{a.branch || '—'}</div>
                  <div className="w-40 text-ink-3 text-[11px] truncate hidden md:block" title={a.batches.join(', ')}>{a.batches.join(', ') || '—'}</div>
                  <div className="w-14 text-ink-3 font-mono text-[11px] text-right">{a.correct}/{quiz.questions.length}</div>
                  <div className="font-bold text-accent w-10 text-right">{a.score}</div>
                  <div className="text-ink-3 font-mono text-[10px] w-24 text-right hidden sm:block">{fmtTime(a.submittedAt)}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Not attempted */}
          {missing.length > 0 && (
            <Card>
              <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">
                Not attempted ({missing.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {missing.map(p => (
                  <span key={p.lwsId} className="text-[11px] px-2 py-1 rounded-full bg-red-50 text-red-700">{p.name}</span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value }) {
  return (
    <div className="card text-center py-3">
      <div className="text-[10px] text-ink-3 uppercase tracking-[1px] font-bold">{label}</div>
      <div className="text-[22px] font-extrabold text-ink tracking-tight mt-0.5">{value}</div>
    </div>
  )
}
