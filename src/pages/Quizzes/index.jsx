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
  const [filters, setFilters] = useState({ exam: '', subject: '', chapter: '', theme: '', status: '' })

  if (editing) {
    const quiz = editing === 'new' ? null : quizzes.find(q => q.id === editing)
    return <QuizEditor quiz={quiz} onDone={() => setEditing(null)} />
  }

  if (resultsId) {
    const quiz = quizzes.find(q => q.id === resultsId)
    if (quiz) return <QuizResults quiz={quiz} onBack={() => setResultsId(null)} />
  }

  const sorted = [...quizzes].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  // Filter by exam / subject / chapter / theme (stored fields) + status (derived).
  const valueOf = (q, key) => (key === 'status' ? quizStatus(q) : (q[key] || ''))
  const FILTER_DEFS = [
    { key: 'exam', all: 'All exams' },
    { key: 'subject', all: 'All subjects' },
    { key: 'chapter', all: 'All chapters' },
    { key: 'theme', all: 'All themes' },
    { key: 'status', all: 'Any status' },
  ]
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
  // Cascade: each dropdown's options reflect the OTHER active filters, so e.g.
  // Subject=Maths lists only Maths chapters (not Biology's Human Physiology).
  const optsGiven = (state, key) =>
    [...new Set(
      sorted
        .filter(q => FILTER_DEFS.every(f => f.key === key || !state[f.key] || valueOf(q, f.key) === state[f.key]))
        .map(q => valueOf(q, key))
        .filter(Boolean)
    )].sort()
  const optionsFor = key => optsGiven(filters, key)
  // Setting a value can make another active filter an impossible combo — clear it.
  const setFilter = (key, value) =>
    setFilters(cur => {
      const next = { ...cur, [key]: value }
      if (value) {
        for (const f of FILTER_DEFS) {
          if (f.key !== key && next[f.key] && !optsGiven(next, f.key).includes(next[f.key])) {
            next[f.key] = ''
          }
        }
      }
      return next
    })
  const filtered = sorted.filter(q => FILTER_DEFS.every(f => !filters[f.key] || valueOf(q, f.key) === filters[f.key]))
  const anyFilter = Object.values(filters).some(Boolean)

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

      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {FILTER_DEFS.map(f => {
            const opts = optionsFor(f.key)
            if (opts.length === 0) return null
            return (
              <select
                key={f.key}
                className="input text-[12px] py-1"
                value={filters[f.key]}
                onChange={e => setFilter(f.key, e.target.value)}
              >
                <option value="">{f.all}</option>
                {opts.map(o => <option key={o} value={o}>{cap(o)}</option>)}
              </select>
            )
          })}
          {anyFilter && (
            <button
              className="text-[12px] text-ink-3 hover:text-ink underline"
              onClick={() => setFilters({ exam: '', subject: '', chapter: '', theme: '', status: '' })}
            >
              Clear
            </button>
          )}
          <span className="text-[11px] text-ink-3 ml-auto font-mono">{filtered.length} of {sorted.length}</span>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon="❓"
          title="No quizzes yet"
          sub="Create your first daily quiz. Add questions, set a close time, and publish — students see it in their portal."
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No quizzes match" sub="Try clearing or changing the filters above." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(q => {
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
                  {[q.exam, q.subject, q.chapter, q.theme && cap(q.theme)].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="text-[11px] text-ink-3 font-mono">
                  {q.questions?.length || 0} Q · closes {fmtClose(q.closesAt)}
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
