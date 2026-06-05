import { useEffect, useState } from 'react'
import { Card, Badge, Spinner, Alert } from '../../components/ui'
import { Math } from '../../components/ui/Math'
import { LETTERS } from '../../lib/quiz'

// Student-facing daily quiz surface (portal only). Fetches open + done quizzes
// for the logged-in mobile, lets the student take an open one, grades server-side
// on submit, then shows a per-question review.
export default function StudentQuizzes({ mobile }) {
  const [loading, setLoading] = useState(true)
  const [quizzes, setQuizzes] = useState([])
  const [error, setError] = useState('')
  const [view, setView] = useState({ mode: 'list' }) // {mode:'list'} | {mode:'take', quiz} | {mode:'review', review}

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
        onSubmitted={(review) => { load(); setView({ mode: 'review', review, title: view.quiz.title }) }}
      />
    )
  }
  if (view.mode === 'review') {
    return <QuizReview title={view.title} review={view.review} onBack={() => setView({ mode: 'list' })} />
  }

  const open = quizzes.filter(q => q.state === 'open')
  const done = quizzes.filter(q => q.state === 'done')

  return (
    <div className="mb-6">
      <div className="text-[13px] font-extrabold text-ink uppercase tracking-wide mb-2">📝 Daily Quiz</div>
      <div className="space-y-2">
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
        {done.map(q => (
          <Card key={q.id} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-ink truncate">{q.title}</div>
              <div className="text-[11px] text-ink-3 font-mono">
                Scored {q.result.score} · {q.result.correct}/{q.questions.length} correct
              </div>
            </div>
            <Badge variant="gray">Done</Badge>
            <button
              className="btn btn-secondary text-[12px] px-4"
              onClick={() => setView({ mode: 'review', title: q.title, review: { review: q.questions, myAnswers: q.myAnswers, ...q.result, total: q.questions.length } })}
            >Review</button>
          </Card>
        ))}
      </div>
    </div>
  )
}

function closeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return ` · closes ${d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

function QuizTaker({ quiz, mobile, onCancel, onSubmitted }) {
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const answered = Object.keys(answers).length
  const total = quiz.questions.length

  async function submit() {
    if (answered < total && !window.confirm(`You answered ${answered} of ${total}. Submit anyway?`)) return
    setSubmitting(true); setError('')
    try {
      const r = await fetch('/api/quiz-submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, quizId: quiz.id, answers }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not submit')
      onSubmitted(data)
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[16px] font-extrabold text-ink">{quiz.title}</div>
        <div className="text-[11px] font-mono text-ink-3">{answered}/{total} answered</div>
      </div>

      <div className="space-y-3">
        {quiz.questions.map((q, idx) => (
          <Card key={idx}>
            <div className="text-[13px] font-semibold text-ink mb-2">
              <span className="text-ink-3 mr-1">Q{idx + 1}.</span><Math>{q.question}</Math>
            </div>
            <div className="space-y-1.5">
              {LETTERS.map(letter => {
                const text = q[`option${letter}`]
                if (text === undefined || text === null || text === '') return null
                const selected = answers[q.q] === letter
                return (
                  <button
                    key={letter}
                    onClick={() => setAnswers(a => ({ ...a, [q.q]: letter }))}
                    className={`w-full text-left flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors min-h-[44px]
                      ${selected ? 'border-accent bg-accent-soft text-ink' : 'border-border bg-surface hover:border-accent/40'}`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0
                      ${selected ? 'bg-accent text-white' : 'bg-surface-2 text-ink-3'}`}>{letter}</span>
                    <Math>{String(text)}</Math>
                  </button>
                )
              })}
            </div>
          </Card>
        ))}
      </div>

      {error && <div className="mt-3"><Alert type="error">{error}</Alert></div>}

      <div className="flex items-center gap-2 mt-4 sticky bottom-0 bg-bg/95 backdrop-blur py-3">
        <button className="btn btn-primary px-6 text-[14px] disabled:opacity-50" onClick={submit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit quiz'}
        </button>
        <button className="text-[13px] text-ink-3 hover:text-ink px-3" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </div>
  )
}

function QuizReview({ title, review, onBack }) {
  const questions = review.review || []
  const myAnswers = review.myAnswers || {}

  return (
    <div className="mb-6">
      <button className="text-[13px] text-ink-3 hover:text-ink mb-3" onClick={onBack}>← Back</button>

      <Card className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[15px] font-extrabold text-ink">{title}</div>
          <div className="text-[12px] text-ink-3">{review.correct}/{review.total} correct · {review.notAttempted} skipped</div>
        </div>
        <div className="text-[28px] font-extrabold text-accent">{review.score}</div>
      </Card>

      <div className="space-y-3">
        {questions.map((q, idx) => {
          const right = String(q.answer || '').toUpperCase()
          const mine = String(myAnswers[q.q] || '').toUpperCase()
          const correct = mine && mine === right
          return (
            <Card key={idx} className={mine ? (correct ? 'border-l-2 border-l-green-400' : 'border-l-2 border-l-red-400') : 'border-l-2 border-l-yellow-300'}>
              <div className="text-[13px] font-semibold text-ink mb-2">
                <span className="text-ink-3 mr-1">Q{idx + 1}.</span><Math>{q.question}</Math>
                {!mine && <span className="ml-2 text-[10px] font-bold text-warning">SKIPPED</span>}
              </div>
              <div className="space-y-1.5">
                {LETTERS.map(letter => {
                  const text = q[`option${letter}`]
                  if (text === undefined || text === null || text === '') return null
                  const isRight = letter === right
                  const isMine = letter === mine
                  let cls = 'border-border bg-surface text-ink-2'
                  if (isRight) cls = 'border-green-300 bg-green-50 text-green-900'
                  else if (isMine) cls = 'border-red-300 bg-red-50 text-red-900'
                  return (
                    <div key={letter} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${cls}`}>
                      <span className="w-5 text-[11px] font-bold flex-shrink-0">{letter}</span>
                      <Math>{String(text)}</Math>
                      {isRight && <span className="ml-auto text-[10px] font-bold text-green-700">CORRECT</span>}
                      {isMine && !isRight && <span className="ml-auto text-[10px] font-bold text-red-700">YOUR ANSWER</span>}
                    </div>
                  )
                })}
              </div>
              {q.solution && (
                <div className="mt-2 text-[12px] text-ink-2 bg-surface-2 rounded-lg px-3 py-2">
                  <span className="font-bold text-ink-3">Solution: </span><Math>{q.solution}</Math>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
