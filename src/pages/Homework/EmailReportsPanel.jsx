import { useState } from 'react'
import useStore from '../../store/useStore'
import { Alert } from '../../components/ui'
import { isEmailAddress } from '../../lib/assignments/reportEmail'

// Confirm, then email the marked-paper report (2026-10-16). Admin only, from
// the local admin app: the send runs on the dev server (scripts/grading/
// _sendReports.js), which re-checks every rule and records each send.
//
// targets: staff submission rows (mapSubmissionRow) the admin chose.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function EmailReportsPanel({ targets, onClose, onSent }) {
  const emailReports = useStore(s => s.emailHomeworkReports)
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function send(test) {
    setBusy(true)
    setError('')
    setResult(null)
    const r = await emailReports(targets.map(t => t.id), test ? testTo.trim() : null)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setResult(r)
    if (!r.test && r.sent.length > 0) onSent()
  }

  return (
    <section aria-label="Email marked papers" className="mb-4 rounded-lg border border-border bg-white p-4 text-[12.5px] flex flex-col gap-3">
      <div className="font-semibold text-ink">Email the marked paper (PDF) to {plural(targets.length, 'student')}</div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {targets.map(t => (
          <li key={t.id} className="text-ink">
            <span>{t.studentName}</span>
            {t.reportEmailedAt && <span className="text-ink-3"> (already emailed; sends again)</span>}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => send(false)}>
          Send to {plural(targets.length, 'student')}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <label htmlFor="report-test-to" className="text-ink-2">Send a test to</label>
        <input
          id="report-test-to" type="email" value={testTo} onChange={e => setTestTo(e.target.value)}
          placeholder="you@example.com" className="form-input !w-64 max-w-full"
        />
        <button className="btn btn-secondary btn-sm" disabled={busy || !isEmailAddress(testTo)} onClick={() => send(true)}>
          Send a test
        </button>
        <span className="text-ink-3">The test goes only to you; nothing is marked as sent.</span>
      </div>

      {busy && <p className="text-ink-2">Sending…</p>}
      {error && <Alert type="error">{error}</Alert>}
      {result && (
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-ink">
            {result.test ? `Test sent to ${testTo.trim()} (${plural(result.sent.length, 'report')}).` : `Sent to ${result.sent.length}.`}
          </p>
          {result.skipped.length > 0 && (
            <ul aria-label="Not sent" className="text-ink-2">
              {result.skipped.map(s => <li key={s.id}>Not sent: {s.name || s.id}: {s.reason}</li>)}
            </ul>
          )}
          {result.failed.length > 0 && (
            <ul aria-label="Failed" className="text-red-800">
              {result.failed.map(f => <li key={f.id}>Failed: {f.name || f.id}: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
