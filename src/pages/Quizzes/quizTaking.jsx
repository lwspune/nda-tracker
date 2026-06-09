import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '../../components/ui'
import { Math } from '../../components/ui/Math'
import { LETTERS } from '../../lib/quiz'

// Shared quiz-taking UI used by both the in-portal section (StudentQuizzes) and
// the standalone shareable link page (QuizLinkPage). One-question-at-a-time with
// auto-advance + an animated score reveal. Both callers pass a `mobile` so the
// submit is attributed to the right student.

function verdictFor(score, total) {
  const pct = total > 0 ? (score / total) * 100 : 0
  if (pct >= 90) return { headline: 'Outstanding!', blurb: "You've nailed this chapter.", stroke: 'stroke-amber-400', text: 'text-amber-500', celebrate: true }
  if (pct >= 75) return { headline: 'Strong work!', blurb: 'Just a couple of gaps to close.', stroke: 'stroke-green-500', text: 'text-green-600', celebrate: true }
  if (pct >= 50) return { headline: 'Good start', blurb: 'A solid base — sharpen the misses below.', stroke: 'stroke-accent', text: 'text-accent', celebrate: false }
  if (pct >= 25) return { headline: 'Keep going', blurb: 'Revise the misses below and retake.', stroke: 'stroke-amber-500', text: 'text-amber-600', celebrate: false }
  return { headline: 'Just getting started', blurb: 'The solutions below will help you climb.', stroke: 'stroke-ink-3', text: 'text-ink-3', celebrate: false }
}

function optionsFor(q) {
  return LETTERS.filter((l) => {
    const t = q[`option${l}`]
    return t !== undefined && t !== null && t !== ''
  })
}

function useCountUp(target, ms = 900) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let raf = 0, start = 0
    const tick = (now) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / ms)
      setVal(Math.round((1 - Math.pow(1 - t, 3)) * target))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return val
}

// Fade-slide a child in whenever `dep` changes (no keyframes / no tailwind plugin).
function AnimatedSwap({ dep, children }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setShown(false)
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [dep])
  return (
    <div className={`transition-all duration-300 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      {children}
    </div>
  )
}

function ScoreRing({ score, total, stroke, text, celebrate }) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = total > 0 ? c * (1 - score / total) : c
  const [dash, setDash] = useState(c)
  const count = useCountUp(score)
  useEffect(() => {
    const t = setTimeout(() => setDash(offset), 80)
    return () => clearTimeout(t)
  }, [offset])
  return (
    <div className="relative mx-auto h-32 w-32">
      {celebrate && <span className="absolute inset-2 rounded-full bg-accent-soft animate-ping" aria-hidden />}
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} className="fill-none stroke-surface-3" strokeWidth="9" />
        <circle cx="60" cy="60" r={r} className={`fill-none ${stroke}`} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={dash} style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-[34px] font-extrabold tabular-nums leading-none ${text}`}>{count}</span>
        <span className="text-[12px] text-ink-3">/ {total}</span>
      </div>
    </div>
  )
}

export function QuizTaker({ quiz, mobile, onCancel, onSubmitted }) {
  const [answers, setAnswers] = useState({})
  const [phase, setPhase] = useState('taking') // 'taking' | 'review'
  const [idx, setIdx] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const advanceTimer = useRef(null)

  const total = quiz.questions.length
  const answered = Object.keys(answers).length
  const q = quiz.questions[idx]
  const opts = optionsFor(q)
  const picked = answers[q.q]
  const isLast = idx + 1 >= total

  const advance = useCallback(() => {
    setIdx((i) => (i + 1 < total ? i + 1 : i))
    if (idx + 1 >= total) setPhase('review')
  }, [idx, total])

  const choose = useCallback((letter) => {
    setAnswers((a) => ({ ...a, [q.q]: letter }))
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(advance, 280)
  }, [q.q, advance])

  useEffect(() => {
    if (phase !== 'taking') return
    const onKey = (e) => {
      const n = Number(e.key)
      if (n >= 1 && n <= opts.length) choose(opts[n - 1])
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, opts, choose, advance])

  useEffect(() => () => advanceTimer.current && clearTimeout(advanceTimer.current), [])

  async function submit() {
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
      setError(e.message); setSubmitting(false)
    }
  }

  const pct = total > 0 ? (phase === 'taking' ? idx / total : answered / total) * 100 : 0

  return (
    <div>
      {/* Header + progress */}
      <div className="mb-4">
        <div className="text-[15px] font-extrabold text-ink">{quiz.title}</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-ink-3">
          {phase === 'taking'
            ? <>Question <span className="font-semibold text-ink">{idx + 1}</span> of {total}</>
            : <><span className="font-semibold text-ink">{answered}</span> of {total} answered</>}
        </div>
      </div>

      {phase === 'taking' ? (
        <AnimatedSwap dep={idx}>
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
            <div className="flex gap-2 text-[15px] font-semibold leading-relaxed text-ink">
              <span className="text-[12px] font-bold text-ink-3">{idx + 1}.</span>
              <div className="min-w-0 flex-1 overflow-x-auto"><Math>{q.question}</Math></div>
            </div>
            <div className="mt-4 space-y-2">
              {opts.map((letter) => {
                const on = picked === letter
                return (
                  <button
                    key={letter}
                    onClick={() => choose(letter)}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-[14px] transition-all duration-150 active:scale-[0.99] min-h-[52px]
                      ${on ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-border bg-surface hover:border-accent/40'}`}
                  >
                    <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border text-[12px] font-bold transition-colors
                      ${on ? 'border-accent bg-accent text-white' : 'border-border text-ink-3'}`}>
                      {on ? '✓' : letter}
                    </span>
                    <span className="min-w-0 flex-1 overflow-x-auto"><Math>{String(q[`option${letter}`])}</Math></span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
              className="px-3 py-2 text-[13px] text-ink-3 transition-colors hover:text-ink disabled:invisible">← Back</button>
            <button onClick={advance} className="px-3 py-2 text-[13px] font-semibold text-ink-3 transition-colors hover:text-ink">
              {picked ? (isLast ? 'Review →' : 'Next →') : 'Skip'}
            </button>
          </div>
        </AnimatedSwap>
      ) : (
        <AnimatedSwap dep="review">
          <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="text-[14px] font-semibold text-ink">
              {answered === total ? 'All answered — nice.' : `${total - answered} still blank.`}
            </div>
            <div className="mt-1 text-[12px] text-ink-3">Tap a number to revisit, or submit.</div>
            <div className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-8">
              {quiz.questions.map((qq, i) => {
                const done = answers[qq.q] !== undefined
                return (
                  <button key={i} onClick={() => { setIdx(i); setPhase('taking') }}
                    className={`grid h-9 place-items-center rounded-lg border text-[13px] font-semibold transition-colors
                      ${done ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-3 hover:bg-surface-2'}`}>
                    {i + 1}
                  </button>
                )
              })}
            </div>
          </div>
          {error && <div className="mt-3"><Alert type="error">{error}</Alert></div>}
          <button onClick={submit} disabled={submitting || answered === 0}
            className="btn btn-primary mt-4 w-full justify-center py-3 text-[15px] disabled:opacity-50">
            {submitting ? 'Submitting…' : 'See my score →'}
          </button>
          <div className="mt-2 flex justify-center gap-4 text-[12px] text-ink-3">
            <button onClick={() => { setIdx(total - 1); setPhase('taking') }} className="hover:text-ink">← Back to questions</button>
            {onCancel && <button onClick={onCancel} disabled={submitting} className="hover:text-ink">Cancel</button>}
          </div>
        </AnimatedSwap>
      )}
    </div>
  )
}

export function QuizReview({ title, review, onBack }) {
  const questions = review.review || []
  const myAnswers = review.myAnswers || {}
  const v = verdictFor(review.score, review.total)
  const wrong = (review.total || 0) - (review.correct || 0) - (review.notAttempted || 0)
  // Student review = a learning tool → show every answer by default (the public
  // lead-magnet defaults to misses-only instead).
  const [showAll, setShowAll] = useState(true)

  return (
    <div>
      {onBack && <button className="mb-3 text-[13px] text-ink-3 transition-colors hover:text-ink" onClick={onBack}>← Back</button>}

      {/* Hero */}
      <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        <ScoreRing score={review.score} total={review.total} stroke={v.stroke} text={v.text} celebrate={v.celebrate} />
        <div className="mt-3 text-[20px] font-extrabold text-ink">{v.headline}</div>
        <div className="mt-0.5 text-[13px] text-ink-3">{v.blurb}</div>
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-[13px] font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-green-700"><span className="tabular-nums">{review.correct}</span><span className="text-[11px] font-normal">correct</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-red-700"><span className="tabular-nums">{wrong}</span><span className="text-[11px] font-normal">wrong</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-ink-3"><span className="tabular-nums">{review.notAttempted}</span><span className="text-[11px] font-normal">skipped</span></span>
        </div>
        <div className="mt-2 text-[12px] text-ink-3">{title}</div>
      </div>

      {/* Review */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Review your answers</div>
        <button onClick={() => setShowAll((s) => !s)} className="text-[12px] font-semibold text-accent hover:underline">
          {showAll ? 'Show only misses' : 'Show all'}
        </button>
      </div>
      <div className="mt-2 space-y-3">
        {questions.map((q, idx) => {
          const right = String(q.answer || '').toUpperCase()
          const mine = String(myAnswers[q.q] || '').toUpperCase()
          const correct = mine && mine === right
          if (!showAll && correct) return null
          return (
            <div key={idx} className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-2 flex gap-2 text-[13px] font-semibold text-ink">
                <span className="text-[12px] font-bold text-ink-3">{idx + 1}.</span>
                <span className="min-w-0 flex-1 overflow-x-auto"><Math>{q.question}</Math></span>
                {!mine && <span className="text-[10px] font-bold text-amber-600">SKIPPED</span>}
              </div>
              <div className="space-y-1.5">
                {optionsFor(q).map((letter) => {
                  const isRight = letter === right
                  const isMine = letter === mine
                  let cls = 'border-border bg-surface text-ink-2'
                  if (isRight) cls = 'border-green-300 bg-green-50 text-green-900 ring-1 ring-green-300/50'
                  else if (isMine) cls = 'border-red-300 bg-red-50 text-red-900 ring-1 ring-red-300/50'
                  return (
                    <div key={letter} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${cls}`}>
                      <span className="w-4 flex-shrink-0 text-[11px] font-bold">{letter}</span>
                      <span className="min-w-0 flex-1 overflow-x-auto"><Math>{String(q[`option${letter}`])}</Math></span>
                      {isRight && <span className="ml-auto flex-shrink-0 text-[10px] font-bold text-green-700">CORRECT</span>}
                      {isMine && !isRight && <span className="ml-auto flex-shrink-0 text-[10px] font-bold text-red-700">YOURS</span>}
                    </div>
                  )
                })}
              </div>
              {q.solution && (
                <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
                  <span className="font-bold text-ink-3">Solution: </span><Math>{q.solution}</Math>
                </div>
              )}
            </div>
          )
        })}
        {!showAll && wrong === 0 && review.notAttempted === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-center text-[13px] text-ink-3">
            Perfect — nothing to review. 🎯
          </div>
        )}
      </div>
    </div>
  )
}
