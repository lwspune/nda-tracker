import { useEffect, useState } from 'react'
import { Card, Spinner, Alert, EmptyState } from '../../components/ui'
import { QuizTaker, QuizReview } from './quizTaking'
import { SESSION_KEY } from '../../config'

// Standalone, focused landing for a shared quiz link: nda-tracker.vercel.app/?quiz=<id>
// Identity is still required (so attempts attribute to the right student), but it's
// a single no-password mobile entry, remembered afterwards — no portal chrome.

const QUIZ_MOBILE_KEY = 'nda_quiz_mobile'

function rememberedMobile() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    if (s?.mobile && (!s.expiry || Date.now() < s.expiry)) return s.mobile
  } catch { /* ignore */ }
  try { return localStorage.getItem(QUIZ_MOBILE_KEY) || '' } catch { return '' }
}
function rememberMobile(m) { try { localStorage.setItem(QUIZ_MOBILE_KEY, m) } catch { /* ignore */ } }

export default function QuizLinkPage({ quizId }) {
  const initialMobile = rememberedMobile()
  const [mobile, setMobile] = useState(initialMobile)
  const [status, setStatus] = useState(initialMobile ? 'loading' : 'need-mobile') // need-mobile|loading|taker|review|unavailable
  const [quiz, setQuiz] = useState(null)
  const [studentName, setStudentName] = useState('')
  const [review, setReview] = useState(null)
  const [error, setError] = useState('')

  // No synchronous setState before the first await — keeps the effect clean.
  async function fetchQuiz(m) {
    try {
      const r = await fetch('/api/student-quizzes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: m }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Could not load the quiz.'); setStatus('need-mobile'); return }
      setStudentName(data.name || '')
      const found = (data.quizzes || []).find(q => q.id === quizId)
      if (!found) { setStatus('unavailable'); return }
      rememberMobile(m)
      if (found.state === 'done') {
        setReview({ ...found.result, review: found.questions, myAnswers: found.myAnswers, total: found.questions.length, title: found.title, subject: found.subject })
        setStatus('review')
      } else {
        setQuiz(found)
        setStatus('taker')
      }
    } catch (e) {
      setError(e.message || 'Network error.')
      setStatus('need-mobile')
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  useEffect(() => { if (initialMobile) fetchQuiz(initialMobile) }, [])

  function handleStart() {
    const digits = mobile.replace(/\D/g, '')
    if (digits.length < 10) { setError('Enter a valid 10-digit mobile number.'); return }
    setError(''); setStatus('loading'); fetchQuiz(mobile)
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="bg-sidebar px-4 py-3">
        <div className="text-[15px] font-extrabold text-indigo-300 tracking-tight">🎯 NDA Tracker</div>
        <div className="text-[9px] font-mono text-indigo-300/30 tracking-[1.5px] uppercase">LWS PUNE · Daily Quiz</div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6">
        {status === 'need-mobile' && (
          <Card>
            <div className="text-[16px] font-extrabold text-ink mb-1">Enter your mobile to start</div>
            <div className="text-[12px] text-ink-3 mb-3">The same number registered with LWS Pune. No password — you'll only do this once on this device.</div>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-[15px]"
                type="tel"
                inputMode="numeric"
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={e => { setMobile(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleStart()}
              />
              <button className="btn btn-primary px-5 text-[14px]" onClick={handleStart}>Start</button>
            </div>
            {error && <div className="mt-3"><Alert type="error">{error}</Alert></div>}
          </Card>
        )}

        {status === 'loading' && (
          <Card className="flex items-center gap-2 text-[13px] text-ink-3"><Spinner size="sm" /> Loading quiz…</Card>
        )}

        {status === 'unavailable' && (
          <>
            <EmptyState
              icon="🔒"
              title="This quiz isn't available"
              sub="It may have closed, already been submitted, or it's assigned to a different batch. Check with LWS Pune."
            />
            <div className="text-center">
              <button className="text-[13px] text-accent hover:underline" onClick={() => { localStorage.removeItem(QUIZ_MOBILE_KEY); setMobile(''); setStatus('need-mobile') }}>
                Use a different number
              </button>
            </div>
          </>
        )}

        {status === 'taker' && quiz && (
          <>
            {studentName && <div className="text-[12px] text-ink-3 mb-2">Hi, <span className="font-semibold text-ink-2">{studentName}</span> 👋</div>}
            <QuizTaker
              quiz={quiz}
              mobile={mobile}
              onSubmitted={(data) => { setReview({ ...data, title: quiz.title, subject: quiz.subject }); setStatus('review') }}
            />
          </>
        )}

        {status === 'review' && review && (
          <>
            <QuizReview title={review.title} review={review} subject={review.subject} />
            <div className="text-center mt-4">
              <a href={window.location.origin + window.location.pathname} className="text-[13px] text-accent hover:underline">Open my full dashboard →</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
