import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { Card, Badge, Alert, PageHeader, Spinner } from '../../components/ui'
import { buildOfflineRoster } from '../../lib/offlineRoster'
import { submissionRoster, assignmentState } from '../../lib/assignments/status'
import { fmtDeadline } from '../../lib/assignments/editor'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET } from '../../lib/assignments/upload'

const STATUS = {
  not_submitted: { variant: 'gray',   label: 'Not submitted' },
  submitted:     { variant: 'yellow', label: 'Waiting to be graded' },
  graded:        { variant: 'green',  label: 'Graded' },
  rejected:      { variant: 'red',    label: 'Sent back' },
}

// Who has handed in a homework, and what they got. Read-only: grades are
// written by the grading session (scripts/grading/), never from this page.
export default function HomeworkSubmissions({ assignment, onBack }) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const getSubmissions  = useStore(s => s.getHomeworkSubmissions)
  const getFileUrl      = useStore(s => s.getHomeworkFileUrl)
  const [subs, setSubs] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let live = true
    getSubmissions(assignment.id).then(r => {
      if (!live) return
      if (r === null) setFailed(true)
      else setSubs(r)
    })
    return () => { live = false }
  }, [assignment.id, getSubmissions])

  const rows = useMemo(
    () => submissionRoster(buildOfflineRoster(studentProfiles, assignment.batchNames), subs ?? []),
    [studentProfiles, assignment.batchNames, subs],
  )
  const count = st => rows.filter(r => r.status === st).length

  async function openFile(bucket, path) {
    const url = await getFileUrl(bucket, path)
    if (url) window.open(url, '_blank', 'noopener')
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

      {failed && <Alert type="error">Could not load the submissions. Reload the page to try again.</Alert>}
      {!subs && !failed && <Spinner />}

      {subs && (
        <>
          <p className="text-[12px] text-ink-3 mb-3 font-mono">
            {count('submitted') + count('graded')} of {rows.length} submitted · {count('graded')} graded ·{' '}
            {count('submitted')} waiting · {count('not_submitted')} not submitted
            {assignmentState(assignment) === 'open' ? ' (still open)' : ''}
          </p>
          <Card className="p-0 divide-y divide-border">
            {rows.map(r => (
              <div key={r.lwsId} data-testid="roster-row" className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink">{r.name}</span>
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  {r.status === 'graded' && (
                    <span className="text-[13px] font-mono text-ink-2">{r.submission.totalAwarded} / {r.submission.totalMax}</span>
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
                  <SubmissionDetail sub={r.submission} onOpenFile={path => openFile(SUBMISSIONS_BUCKET, path)} />
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}

function SubmissionDetail({ sub, onOpenFile }) {
  return (
    <div className="mt-3 flex flex-col gap-3 text-[12.5px]">
      {sub.scansDeletedAt ? (
        <p className="text-ink-3">The photos were deleted after grading; the grade is kept.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sub.files.map((path, i) => (
            <button key={path} className="btn btn-secondary btn-sm" onClick={() => onOpenFile(path)}>Page {i + 1}</button>
          ))}
        </div>
      )}
      {sub.status === 'rejected' && <Alert type="warning">Sent back: {sub.rejectedReason}</Alert>}
      {sub.status === 'graded' && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><div className="font-semibold text-ink-2">What went well</div><p>{sub.wentWell}</p></div>
            <div><div className="font-semibold text-ink-2">What to work on</div><p>{sub.nextSteps}</p></div>
          </div>
          <table className="w-full text-left">
            <thead className="text-[11px] text-ink-3 uppercase">
              <tr><th className="py-1 pr-2">Q</th><th className="pr-2">Marks</th><th className="pr-2">Earned</th><th>Missing</th></tr>
            </thead>
            <tbody>
              {sub.grades.map(g => (
                <tr key={g.position} className="align-top border-t border-border">
                  <td className="py-1.5 pr-2 font-semibold">{g.label}</td>
                  <td className="pr-2 font-mono whitespace-nowrap">
                    {g.outcome === 'scored' ? `${g.awarded} / ${g.maxMarks}` : `— / ${g.maxMarks}`}
                  </td>
                  <td className="pr-2">{g.outcome === 'scored' ? g.earned : 'Not attempted'}</td>
                  <td>{g.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
