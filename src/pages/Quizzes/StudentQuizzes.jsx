import { useEffect, useState } from 'react'
import { Card, Badge, Spinner, Alert } from '../../components/ui'
import { QuizTaker, QuizReview } from './quizTaking'

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
        onSubmitted={(review) => { load(); setView({ mode: 'review', review, title: view.quiz.title, subject: view.quiz.subject }) }}
      />
    )
  }
  if (view.mode === 'review') {
    return <QuizReview title={view.title} review={view.review} subject={view.subject} onBack={() => setView({ mode: 'list' })} />
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
              onClick={() => setView({ mode: 'review', title: q.title, subject: q.subject, review: { review: q.questions, myAnswers: q.myAnswers, ...q.result, total: q.questions.length } })}
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
