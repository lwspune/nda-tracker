import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { Card, Badge, Alert, PageHeader, Spinner } from '../../components/ui'
import { buildOfflineRoster } from '../../lib/offlineRoster'
import { submissionRoster, assignmentState } from '../../lib/assignments/status'
import { fmtDeadline } from '../../lib/assignments/editor'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET } from '../../lib/assignments/upload'
import { canEmailReport } from '../../lib/assignments/reportEmail'
import { fmtTimestamp } from '../../lib/dates'
import { slipQuestions, countSlipStudents, planSlipPages } from '../../lib/assignments/slipPages'
import { buildSlipPagesPdf } from '../../lib/assignments/slipPagesPdf'
import { downloadBlob, safeFilename } from '../../lib/download'
import { useMode } from '../../context/ModeContext'
import EmailReportsPanel from './EmailReportsPanel'
import RecordWrittenExam from './RecordWrittenExam'

const STATUS = {
  not_submitted: { variant: 'gray',   label: 'Not submitted' },
  submitted:     { variant: 'yellow', label: 'Waiting to be graded' },
  held:          { variant: 'red',    label: 'Held: handwriting check' },
  graded:        { variant: 'green',  label: 'Graded' },
  rejected:      { variant: 'red',    label: 'Sent back' },
}

const HAND_FLAG = {
  mismatch: 'Handwriting did not match',
  unclear:  'Handwriting unclear',
}

// Who has handed in a homework, and what they got. Grades are written by the
// grading session (scripts/grading/), never from this page — except that a
// grade HELD for a handwriting check is released or sent back here.
export default function HomeworkSubmissions({ assignment, email, onBack }) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const getSubmissions  = useStore(s => s.getHomeworkSubmissions)
  const getFileUrl      = useStore(s => s.getHomeworkFileUrl)
  const getFileUrls     = useStore(s => s.getHomeworkFileUrls)
  const getPageMarks    = useStore(s => s.getHomeworkPageMarks)
  const [subs, setSubs] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)
  const [version, setVersion] = useState(0)
  const [emailing, setEmailing] = useState(null) // the rows being emailed, while the panel is open
  const [slipBusy, setSlipBusy] = useState(false)
  const [slipError, setSlipError] = useState('')
  // Emailing the marked paper is an admin send (teachers capture, never send).
  const canEmail = useMode() === 'admin'

  useEffect(() => {
    let live = true
    getSubmissions(assignment.id).then(r => {
      if (!live) return
      if (r === null) setFailed(true)
      else setSubs(r)
    })
    return () => { live = false }
  }, [assignment.id, getSubmissions, version])

  const rows = useMemo(
    () => submissionRoster(buildOfflineRoster(studentProfiles, assignment.batchNames), subs ?? []),
    [studentProfiles, assignment.batchNames, subs],
  )
  const count = st => rows.filter(r => r.status === st).length
  const unsent = (subs ?? []).filter(s => canEmailReport(s) && !s.reportEmailedAt)
  const slipStudents = countSlipStudents(subs)

  async function openFile(bucket, path) {
    const url = await getFileUrl(bucket, path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  // The marked pages where marks were lost to a calculation error, as one PDF,
  // student by student (2026-10-24). A download, never a send.
  async function downloadSlips() {
    setSlipBusy(true)
    setSlipError('')
    try {
      const withSlips = subs.filter(s => s.status === 'graded' && slipQuestions(s).length > 0)
      const marks = await getPageMarks(withSlips.map(s => s.id))
      if (marks === null) throw new Error('page marks read failed')
      const plan = planSlipPages(withSlips, marks)
      const urls = plan.pages.length ? await getFileUrls(SUBMISSIONS_BUCKET, plan.pages.map(p => p.path)) : {}
      if (urls === null) throw new Error('signing failed')
      const blob = await buildSlipPagesPdf({
        title: assignment.title,
        subtitle: `${assignment.subject} · ${assignment.batchNames.join(', ')} · due ${fmtDeadline(assignment.dueAt)}`,
        plan,
        urls,
      })
      downloadBlob(blob, `${safeFilename(assignment.title, 'homework')}_calculation_errors.pdf`)
    } catch (e) {
      console.error('[homework] calculation errors download failed:', e)
      setSlipError('Could not build the calculation errors PDF. Try again.')
    } finally {
      setSlipBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={assignment.title}
        sub={`${assignment.subject} · ${assignment.batchNames.join(', ')} · due ${fmtDeadline(assignment.dueAt)} · out of ${assignment.maxMarks}`}
        actions={<button className="btn btn-secondary text-[13px]" onClick={onBack}>← Back</button>}
      />

      <div className="flex flex-wrap gap-2 mb-4 text-[12px]">
        {assignment.questionFiles.map(f => (
          <button key={f.path} className="btn btn-secondary btn-sm" onClick={() => openFile(ASSIGNMENT_FILES_BUCKET, f.path)}>
            📄 {f.name || 'Question paper'}
          </button>
        ))}
        {assignment.answerKeyFiles.map(f => (
          <button key={f.path} className="btn btn-secondary btn-sm" onClick={() => openFile(ASSIGNMENT_FILES_BUCKET, f.path)}>
            🔑 {f.name || 'Answer key'}
          </button>
        ))}
      </div>

      {subs && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-[12px]">
          {canEmail && (
            <button className="btn btn-secondary btn-sm" disabled={unsent.length === 0}
                    onClick={() => setEmailing(unsent)}>
              ✉ Email reports ({unsent.length} not sent)
            </button>
          )}
          <button className="btn btn-secondary btn-sm" disabled={slipStudents === 0 || slipBusy} onClick={downloadSlips}>
            {slipBusy
              ? 'Building PDF…'
              : `⬇ Calculation errors (PDF) · ${slipStudents === 0 ? 'none' : `${slipStudents} student${slipStudents === 1 ? '' : 's'}`}`}
          </button>
        </div>
      )}
      {slipError && <Alert type="error">{slipError}</Alert>}
      {emailing && (
        <EmailReportsPanel targets={emailing} onClose={() => setEmailing(null)} onSent={() => setVersion(v => v + 1)} />
      )}

      {subs && <RecordWrittenExam assignment={assignment} rows={rows} email={email} />}

      {failed && <Alert type="error">Could not load the submissions. Reload the page to try again.</Alert>}
      {!subs && !failed && <Spinner />}

      {subs && (
        <>
          <p className="text-[12px] text-ink-3 mb-3 font-mono">
            {count('submitted') + count('held') + count('graded')} of {rows.length} submitted · {count('graded')} graded ·{' '}
            {count('submitted')} waiting · {count('not_submitted')} not submitted
            {count('held') ? ` · ${count('held')} held for a handwriting check` : ''}
            {assignmentState(assignment) === 'open' ? ' (still open)' : ''}
          </p>
          <Card className="p-0 divide-y divide-border">
            {rows.map(r => (
              <div key={r.lwsId} data-testid="roster-row" className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink">{r.name}</span>
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  {(r.status === 'graded' || r.status === 'held') && (
                    <span className="text-[13px] font-mono text-ink-2">{r.submission.totalAwarded} / {r.submission.totalMax}</span>
                  )}
                  {r.status === 'graded' && HAND_FLAG[r.submission.handCheck] && (
                    <span className="text-[12px] font-semibold text-warning">
                      <span aria-hidden="true">⚠ </span>{HAND_FLAG[r.submission.handCheck]}
                    </span>
                  )}
                  {r.submission && (
                    <button
                      className="ml-auto text-[12px] font-semibold text-accent hover:underline"
                      aria-label={`View ${r.name}`}
                      aria-expanded={open === r.lwsId}
                      onClick={() => setOpen(o => (o === r.lwsId ? null : r.lwsId))}
                    >
                      {open === r.lwsId ? 'Hide' : 'View'}
                    </button>
                  )}
                </div>
                {open === r.lwsId && r.submission && (
                  <SubmissionDetail
                    sub={r.submission}
                    onOpenFile={path => openFile(SUBMISSIONS_BUCKET, path)}
                    onResolved={() => setVersion(v => v + 1)}
                    onEmail={canEmail && canEmailReport(r.submission) ? () => setEmailing([r.submission]) : null}
                  />
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}

function SubmissionDetail({ sub, onOpenFile, onResolved, onEmail }) {
  return (
    <div className="mt-3 flex flex-col gap-3 text-[12.5px]">
      {onEmail && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">
            {sub.reportEmailedAt ? `Report emailed ${fmtTimestamp(sub.reportEmailedAt)}` : 'Report not emailed yet'}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onEmail}>
            {sub.reportEmailedAt ? 'Resend report' : 'Email report'}
          </button>
        </div>
      )}
      {sub.scansDeletedAt ? (
        <p className="text-ink-3">The photos were deleted after grading; the grade is kept.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sub.files.map((path, i) => (
            <button key={path} className="btn btn-secondary btn-sm" onClick={() => onOpenFile(path)}>Page {i + 1}</button>
          ))}
          {/* The report carries the marked pages, so they get no buttons of their own. */}
          {sub.reportPath && (
            <button className="btn btn-primary btn-sm" onClick={() => onOpenFile(sub.reportPath)}>Report (PDF)</button>
          )}
        </div>
      )}
      {sub.status === 'held' && <HeldReview sub={sub} onOpenFile={onOpenFile} onResolved={onResolved} />}
      {sub.status === 'graded' && HAND_FLAG[sub.handCheck] && (
        <Alert type="warning">
          {HAND_FLAG[sub.handCheck]}: {sub.handNote}
          {sub.resolvedBy ? ` Released by ${sub.resolvedBy}.` : ''}
        </Alert>
      )}
      {sub.status === 'rejected' && <Alert type="warning">Sent back: {sub.rejectedReason}</Alert>}
    </div>
  )
}

// A grade held because the handwriting did not match the student's reference.
// The teacher compares the pages, then releases the grade or sends it back.
// The database function behind both re-checks who is asking.
function HeldReview({ sub, onOpenFile, onResolved }) {
  const getReference = useStore(s => s.getHomeworkReferenceFiles)
  const resolve      = useStore(s => s.resolveHeldHomework)
  const [reference, setReference] = useState(undefined) // undefined = loading, null = none
  const [sending, setSending] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    getReference(sub.lwsId).then(r => { if (live) setReference(r) })
    return () => { live = false }
  }, [sub.lwsId, getReference])

  async function act(action) {
    setBusy(true)
    setError('')
    const r = await resolve(sub.id, action, action === 'reject' ? reason : undefined)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onResolved()
  }

  const reasonOk = reason.trim().length >= 10 && reason.trim().length <= 300
  const reasonId = `held-reason-${sub.id}`

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <Alert type="warning">
        Handwriting did not match the student&apos;s reference: {sub.handNote} The student has not seen this grade.
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-2">Reference (first graded homework):</span>
        {reference === undefined && <span className="text-ink-3">Loading…</span>}
        {reference === null && <span className="text-ink-3">No reference on file. The class-wide comparison flagged this one.</span>}
        {reference && reference.scansDeletedAt && <span className="text-ink-3">The reference pages have been deleted.</span>}
        {reference && !reference.scansDeletedAt && reference.files.map((path, i) => (
          <button key={path} className="btn btn-secondary btn-sm" onClick={() => onOpenFile(path)}>Reference page {i + 1}</button>
        ))}
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {!sending ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act('release')}>Release grade</button>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setSending(true)}>Send back</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={reasonId} className="font-semibold text-ink-2">Reason for the student</label>
          <textarea
            id={reasonId}
            className="form-input"
            rows={2}
            maxLength={300}
            value={reason}
            placeholder="Please redo this homework in your own handwriting."
            onChange={e => setReason(e.target.value)}
          />
          <p className="text-[11px] text-ink-3">
            The student sees only this reason; the marks are removed. After the deadline they cannot hand in again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || !reasonOk} onClick={() => act('reject')}>Confirm send back</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setSending(false); setReason('') }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
