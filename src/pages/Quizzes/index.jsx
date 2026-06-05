import { useState } from 'react'
import useStore from '../../store/useStore'
import { PageHeader, Card, Badge, EmptyState } from '../../components/ui'
import { quizStatus } from '../../lib/quiz'
import QuizEditor from './QuizEditor'
import QuizResults from './QuizResults'

const STATUS_BADGE = {
  draft:  { variant: 'gray',   label: 'Draft' },
  open:   { variant: 'green',  label: 'Open' },
  closed: { variant: 'red',    label: 'Closed' },
}

function fmtClose(iso) {
  if (!iso) return 'no close time'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function QuizzesPage() {
  const quizzes    = useStore(s => s.quizzes)
  const deleteQuiz = useStore(s => s.deleteQuiz)
  // editing: null = list · 'new' = create · quizId = edit
  const [editing, setEditing] = useState(null)
  const [resultsId, setResultsId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  if (editing) {
    const quiz = editing === 'new' ? null : quizzes.find(q => q.id === editing)
    return <QuizEditor quiz={quiz} onDone={() => setEditing(null)} />
  }

  if (resultsId) {
    const quiz = quizzes.find(q => q.id === resultsId)
    if (quiz) return <QuizResults quiz={quiz} onBack={() => setResultsId(null)} />
  }

  const sorted = [...quizzes].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  function handleDelete(q) {
    if (window.confirm(`Delete quiz "${q.title}"? This also removes all student attempts for it. This cannot be undone.`)) {
      deleteQuiz(q.id)
    }
  }

  function copyLink(q) {
    const url = `${window.location.origin}/?quiz=${q.id}`
    navigator.clipboard?.writeText(url).then(
      () => { setCopiedId(q.id); setTimeout(() => setCopiedId(c => (c === q.id ? null : c)), 1800) },
      () => window.prompt('Copy this quiz link:', url),
    )
  }

  return (
    <div>
      <PageHeader
        title="Daily Quiz"
        sub="Author MCQ quizzes students take on their phones — a tracked replacement for Google Forms."
        actions={
          <button className="btn btn-primary text-[13px]" onClick={() => setEditing('new')}>+ New quiz</button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon="❓"
          title="No quizzes yet"
          sub="Create your first daily quiz. Add questions, set a close time, and publish — students see it in their portal."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(q => {
            const status = quizStatus(q)
            const badge = STATUS_BADGE[status]
            const batches = q.batch ? q.batch.split(',').map(b => b.trim()).filter(Boolean) : []
            return (
              <Card key={q.id} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14px] font-bold text-ink leading-snug">{q.title || 'Untitled quiz'}</div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <div className="text-[11px] text-ink-3 font-mono">
                  {q.subject || '—'} · {q.questions?.length || 0} Q · closes {fmtClose(q.closesAt)}
                </div>
                <div className="text-[11px] text-ink-3 truncate">
                  {batches.length ? batches.join(', ') : 'All batches'}
                </div>
                <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border">
                  <button className="text-[12px] font-semibold text-accent hover:underline" onClick={() => setEditing(q.id)}>Edit</button>
                  <button className="text-[12px] font-semibold text-ink-2 hover:underline" onClick={() => setResultsId(q.id)}>Results</button>
                  {status !== 'draft' && (
                    <button className="text-[12px] font-semibold text-ink-2 hover:underline" onClick={() => copyLink(q)}>
                      {copiedId === q.id ? '✓ Copied' : '🔗 Copy link'}
                    </button>
                  )}
                  <button className="text-[12px] text-red-500 hover:text-red-700 ml-auto" onClick={() => handleDelete(q)}>Delete</button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
