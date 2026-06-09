import { useState } from 'react'
import useStore from '../../store/useStore'
import { Card, Alert } from '../../components/ui'
import { Math } from '../../components/ui/Math'
import {
  LETTERS, DIFFICULTIES, DEFAULT_MARKING,
  blankQuestion, quizQuestionComplete, validateQuizForPublish,
} from '../../lib/quiz'

// Classification vocab — kept in sync with PYQ Vault's quiz import so a hand-
// authored quiz filters alongside imported ones (instead of "Uncategorized").
const EXAMS = ['NDA', 'MHT-CET']
const THEMES = ['mixed', 'formula', 'property', 'computation', 'fact', 'trap']
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const PUBLISH_REASONS = {
  title_required:        'Add a title before publishing.',
  no_complete_questions: 'Add at least one complete question (text + 4 options + correct answer).',
  close_time_required:   'Set a close time before publishing.',
  close_time_past:       'The close time must be in the future.',
  missing:               'Quiz is empty.',
}

// datetime-local <-> ISO helpers (local time, no seconds)
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null
}
function defaultCloseIso() {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

// Build a fresh draft (new quiz) or hydrate from an existing one.
function initDraft(quiz) {
  if (quiz) return { ...quiz, questions: quiz.questions?.length ? quiz.questions : [blankQuestion(1)] }
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? `quiz_${Date.now()}`),
    title: '',
    subject: 'Maths',
    exam: 'NDA',
    chapter: '',
    theme: 'mixed',
    batch: '',
    branch: null,
    marking: { ...DEFAULT_MARKING },
    questions: [blankQuestion(1)],
    opensAt: null,
    closesAt: defaultCloseIso(),
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
}

export default function QuizEditor({ quiz, onDone }) {
  const addQuiz    = useStore(s => s.addQuiz)
  const updateQuiz = useStore(s => s.updateQuiz)
  const syllabusBatches = useStore(s => s.syllabusBatches)
  const isNew = !quiz

  const [draft, setDraft] = useState(() => initDraft(quiz))
  const [error, setError] = useState('')

  const selectedBatches = draft.batch ? draft.batch.split(',').map(b => b.trim()).filter(Boolean) : []
  const completeCount = draft.questions.filter(quizQuestionComplete).length

  function patch(p) { setDraft(d => ({ ...d, ...p })); setError('') }

  function patchQuestion(idx, p) {
    setDraft(d => ({ ...d, questions: d.questions.map((q, i) => i === idx ? { ...q, ...p } : q) }))
    setError('')
  }

  function addQuestion() {
    setDraft(d => ({ ...d, questions: [...d.questions, blankQuestion(d.questions.length + 1)] }))
  }

  function removeQuestion(idx) {
    setDraft(d => {
      const questions = d.questions.filter((_, i) => i !== idx).map((q, i) => ({ ...q, q: i + 1 }))
      return { ...d, questions: questions.length ? questions : [blankQuestion(1)] }
    })
  }

  function toggleBatch(name) {
    const next = selectedBatches.includes(name)
      ? selectedBatches.filter(b => b !== name)
      : [...syllabusBatches.filter(b => selectedBatches.includes(b) || b === name)] // keep syllabus order
    patch({ batch: next.join(', ') })
  }

  // Persist questions in canonical form (uppercase answer, trimmed).
  function normalisedDraft() {
    return {
      ...draft,
      title: draft.title.trim(),
      questions: draft.questions.map(q => ({ ...q, answer: String(q.answer || '').toUpperCase() })),
    }
  }

  function saveDraft() {
    const d = normalisedDraft()
    if (!d.title) { setError('Add a title first.'); return }
    if (isNew) addQuiz(d); else updateQuiz(d.id, d)
    onDone()
  }

  function publish() {
    const d = { ...normalisedDraft(), status: 'published', opensAt: draft.opensAt || new Date().toISOString() }
    const check = validateQuizForPublish(d)
    if (!check.ok) { setError(PUBLISH_REASONS[check.reason] || 'Cannot publish yet.'); return }
    if (isNew) addQuiz(d); else updateQuiz(d.id, d)
    onDone()
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <button className="text-[13px] text-ink-3 hover:text-ink" onClick={onDone}>← Back to quizzes</button>
        <div className="text-[11px] font-mono text-ink-3">{completeCount} / {draft.questions.length} complete</div>
      </div>

      {/* ── Meta ─────────────────────────────────────── */}
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">Quiz details</div>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-ink-2 block mb-1">Title</label>
            <input
              className="input w-full text-[14px]"
              placeholder="e.g. Daily Maths Quiz — 5 Jun"
              value={draft.title}
              onChange={e => patch({ title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Subject</label>
              <input className="input w-full text-[13px]" value={draft.subject || ''} onChange={e => patch({ subject: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Closes at</label>
              <input
                type="datetime-local"
                className="input w-full text-[13px]"
                value={toLocalInput(draft.closesAt)}
                onChange={e => patch({ closesAt: fromLocalInput(e.target.value) })}
              />
            </div>
          </div>

          {/* Classification — drives the Daily Quiz filters (exam/chapter/theme). */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Exam</label>
              <select
                className="input w-full text-[13px]"
                value={draft.exam || ''}
                onChange={e => patch({ exam: e.target.value || null })}
                aria-label="Exam"
              >
                <option value="">— Exam —</option>
                {EXAMS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Chapter</label>
              <input
                className="input w-full text-[13px]"
                placeholder="e.g. Probability"
                value={draft.chapter || ''}
                onChange={e => patch({ chapter: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Theme</label>
              <select
                className="input w-full text-[13px]"
                value={draft.theme || ''}
                onChange={e => patch({ theme: e.target.value || null })}
                aria-label="Theme"
              >
                <option value="">— Theme —</option>
                {THEMES.map(t => <option key={t} value={t}>{cap(t)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ink-2 block mb-1">Batches (who can take it)</label>
            {syllabusBatches.length === 0 ? (
              <p className="text-[12px] text-amber-600 italic">No batches yet — add one in Settings → Batches.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {syllabusBatches.map(b => {
                  const on = selectedBatches.includes(b)
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => toggleBatch(b)}
                      className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-colors min-h-[32px]
                        ${on ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-ink-2 border-border hover:border-accent/40'}`}
                    >
                      {on ? '✓ ' : ''}{b}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-[11px] text-ink-3 mt-1">Leave none selected for an all-batches quiz.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Marks per correct</label>
              <input
                type="number" className="input w-full text-[13px]"
                value={draft.marking.correct}
                onChange={e => patch({ marking: { ...draft.marking, correct: Number(e.target.value) } })}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-2 block mb-1">Marks per wrong (negative if any)</label>
              <input
                type="number" className="input w-full text-[13px]"
                value={draft.marking.wrong}
                onChange={e => patch({ marking: { ...draft.marking, wrong: Number(e.target.value) } })}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Questions ───────────────────────────────── */}
      {draft.questions.map((q, idx) => (
        <QuestionForm
          key={idx}
          q={q}
          index={idx}
          canRemove={draft.questions.length > 1}
          onChange={p => patchQuestion(idx, p)}
          onRemove={() => removeQuestion(idx)}
        />
      ))}

      <button
        className="w-full text-[13px] border border-dashed border-border rounded-lg py-2.5 text-ink-3 hover:border-accent/40 hover:text-ink transition-colors"
        onClick={addQuestion}
      >
        + Add question
      </button>

      {error && <Alert type="error">{error}</Alert>}

      {/* ── Actions ─────────────────────────────────── */}
      <div className="flex items-center gap-2 sticky bottom-0 bg-bg/95 backdrop-blur py-3 border-t border-border">
        <button className="btn btn-primary px-5 text-[13px]" onClick={publish}>
          {draft.status === 'published' ? 'Update & keep published' : 'Publish'}
        </button>
        <button className="btn btn-secondary px-4 text-[13px]" onClick={saveDraft}>Save draft</button>
        <button className="text-[13px] text-ink-3 hover:text-ink px-3" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

function QuestionForm({ q, index, canRemove, onChange, onRemove }) {
  const complete = quizQuestionComplete(q)
  return (
    <Card className={complete ? '' : 'border-l-2 border-l-amber-300'}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-ink-2">Q{index + 1}{complete ? '' : ' · incomplete'}</div>
        {canRemove && (
          <button className="text-[12px] text-red-500 hover:text-red-700" onClick={onRemove}>Remove</button>
        )}
      </div>

      <textarea
        className="input w-full text-[13px] min-h-[60px]"
        placeholder="Question text (supports \( LaTeX \) )"
        value={q.question}
        onChange={e => onChange({ question: e.target.value })}
      />
      {q.question.includes('\\(') && (
        <div className="text-[13px] text-ink-2 mt-1 px-1"><Math>{q.question}</Math></div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        {LETTERS.map(letter => {
          const key = `option${letter}`
          const isAnswer = String(q.answer || '').toUpperCase() === letter
          return (
            <label key={letter} className={`flex flex-col gap-1 rounded-lg border px-2 py-1.5
              ${isAnswer ? 'border-accent bg-accent-soft' : 'border-border'}`}>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`answer-${index}`}
                  checked={isAnswer}
                  onChange={() => onChange({ answer: letter })}
                  aria-label={`Mark option ${letter} correct`}
                />
                <span className="text-[12px] font-bold text-ink-3 w-4">{letter}</span>
                <input
                  className="input flex-1 text-[13px] py-1"
                  placeholder={`Option ${letter}`}
                  value={q[key] || ''}
                  onChange={e => onChange({ [key]: e.target.value })}
                />
              </div>
              {String(q[key] || '').includes('\\(') && (
                <div className="text-[12px] text-ink-2 pl-8"><Math>{q[key]}</Math></div>
              )}
            </label>
          )
        })}
      </div>
      <p className="text-[10.5px] text-ink-3 mt-1.5">Select the radio next to the correct option.</p>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <input
          className="input text-[12px]" placeholder="Chapter (optional)"
          value={q.chapter || ''} onChange={e => onChange({ chapter: e.target.value })}
        />
        <select
          className="input text-[12px]" value={q.difficulty || ''}
          onChange={e => onChange({ difficulty: e.target.value })}
          aria-label="Difficulty"
        >
          <option value="">Difficulty (optional)</option>
          {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
    </Card>
  )
}
