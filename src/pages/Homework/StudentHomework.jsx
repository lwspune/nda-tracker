import { useCallback, useEffect, useState } from 'react'
import { Card, Badge, Alert, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { ACCEPT, CAMERA_ACCEPT, SUBMISSIONS_BUCKET, validateUploadFiles } from '../../lib/assignments/upload'
import { fmtDeadline } from '../../lib/assignments/editor'
import { MAX_REPLACEMENTS } from '../../lib/assignments/status'
import { sendHomework, readPickedFiles, needsSinglePageConfirm } from '../../lib/assignments/studentUpload'

// The student portal's homework (2026-10-12): see what is set, open the
// question paper, hand in photos or a PDF before the deadline, and read the
// marks once graded. Everything goes through /api/student-quizzes (kind
// homework-*), which owns identity, batches and the deadline; the pages
// themselves go straight to storage through signed links.
async function post(body) {
  const r = await fetch('/api/student-quizzes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body: json }
}

async function upload(path, token, file) {
  if (!supabase) return { error: { message: 'Storage is not configured' } }
  return supabase.storage.from(SUBMISSIONS_BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type })
}

export default function StudentHomework({ mobile, lwsId }) {
  const [homework, setHomework] = useState(null)
  const [error, setError] = useState('')

  const known = Boolean(mobile && lwsId)
  const load = useCallback(async () => {
    const r = await post({ kind: 'homework-list', mobile, lwsId })
    if (!r.ok) { setError(r.body?.error || 'Could not load homework.'); setHomework([]); return }
    setError('')
    setHomework(r.body.homework ?? [])
  }, [mobile, lwsId])

  // Fetch on mount: every setState in load() runs after the request resolves,
  // which the rule cannot see through the call.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (known) load() }, [known, load])

  if (!known) return null
  if (homework === null) {
    return (
      <Card className="mb-5 flex items-center gap-2 text-[13px] text-ink-3">
        <Spinner size="sm" /> Loading homework…
      </Card>
    )
  }
  if (error) return <div className="mb-5"><Alert type="error">{error}</Alert></div>
  if (homework.length === 0) return null

  return (
    <div className="mb-6">
      <div className="text-[13px] font-extrabold text-ink uppercase tracking-wide mb-2">📤 Homework</div>
      <div className="space-y-2">
        {homework.map(h => (
          <HomeworkCard key={h.id} hw={h} mobile={mobile} lwsId={lwsId} onHandedIn={load} />
        ))}
      </div>
    </div>
  )
}

function statusBadge(hw) {
  const s = hw.submission?.status
  if (s === 'graded') return <Badge variant="green">Graded</Badge>
  if (s === 'submitted') return <Badge variant="yellow">Waiting to be graded</Badge>
  if (s === 'rejected' && hw.canSubmit) return <Badge variant="red">Sent back</Badge>
  if (hw.state === 'closed') return <Badge variant="gray">Not submitted</Badge>
  return <Badge variant="blue">To do</Badge>
}

function HomeworkCard({ hw, mobile, lwsId, onHandedIn }) {
  const [showMarks, setShowMarks] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const sub = hw.submission

  return (
    <Card data-testid="homework-card" className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-ink">{hw.title}</div>
          <div className="text-[11px] text-ink-3 font-mono">
            {hw.subject} · out of {hw.maxMarks} · {hw.state === 'open' ? 'due' : 'was due'} {fmtDeadline(hw.dueAt)}
          </div>
        </div>
        {statusBadge(hw)}
      </div>

      {hw.instructions && <p className="text-[13px] text-ink-2 whitespace-pre-line">{hw.instructions}</p>}

      {hw.questionFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hw.questionFiles.map(f => (
            <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer"
               className="btn btn-secondary btn-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              📄 {f.name}
            </a>
          ))}
        </div>
      )}

      {sub?.status === 'submitted' && (
        <p className="text-[12px] text-ink-3">
          {sub.pages} page{sub.pages === 1 ? '' : 's'} handed in. Your marks will appear here once it is graded.
        </p>
      )}

      {sub?.status === 'submitted' && hw.canReplace && !replacing && (
        <div>
          <button className="btn btn-secondary btn-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => setReplacing(true)}>
            Replace my submission
          </button>
        </div>
      )}

      {sub?.status === 'graded' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-bold font-mono text-ink">{sub.totalAwarded} / {sub.totalMax}</span>
            <button className="text-[12px] font-semibold text-accent hover:underline"
                    aria-expanded={showMarks} onClick={() => setShowMarks(v => !v)}>
              {showMarks ? 'Hide marks' : 'See marks'}
            </button>
          </div>
          {showMarks && <GradeDetail sub={sub} />}
        </div>
      )}

      {sub?.status === 'rejected' && hw.canSubmit && (
        <Alert type="warning">Your last upload was sent back: {sub.rejectedReason} Please submit it again.</Alert>
      )}

      {hw.canSubmit && <HandIn hw={hw} mobile={mobile} lwsId={lwsId} onHandedIn={onHandedIn} />}
      {!hw.canSubmit && hw.canReplace && replacing && (
        <HandIn hw={hw} mobile={mobile} lwsId={lwsId} replacing={{ pages: sub?.pages ?? 0, left: hw.replacementsLeft }}
                onCancel={() => setReplacing(false)}
                onHandedIn={() => { setReplacing(false); onHandedIn() }} />
      )}
    </Card>
  )
}

function GradeDetail({ sub }) {
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      {sub.wentWell && <div><span className="font-semibold text-ink-2">What went well: </span>{sub.wentWell}</div>}
      {sub.nextSteps && <div><span className="font-semibold text-ink-2">What to work on: </span>{sub.nextSteps}</div>}
      <ul className="flex flex-col divide-y divide-border border border-border rounded-lg">
        {sub.grades.map(g => (
          <li key={g.position} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{g.label}</span>
              <span className="font-mono text-ink-2 ml-auto">
                {g.outcome === 'scored' ? `${g.awarded} / ${g.maxMarks}` : `— / ${g.maxMarks}`}
              </span>
            </div>
            {g.outcome !== 'scored' && <div className="text-ink-3">Not attempted</div>}
            {g.earned && (
              <div className="text-green-800">
                <span aria-hidden="true">✓ </span><span className="sr-only">Earned: </span><span>{g.earned}</span>
              </div>
            )}
            {g.missing && (
              <div className="text-red-800">
                <span aria-hidden="true">✗ </span><span className="sr-only">Missing: </span><span>{g.missing}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// `replacing` ({ pages, left }) when the student is replacing a hand-in that is
// waiting to be graded (2026-10-14): the new set replaces everything sent before.
function HandIn({ hw, mobile, lwsId, onHandedIn, replacing = null, onCancel }) {
  const [pages, setPages] = useState([])
  const [pickError, setPickError] = useState('')
  const [sendError, setSendError] = useState('')
  const [progress, setProgress] = useState(null) // { done, total } while sending

  async function add(e) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    const check = validateUploadFiles([...pages, ...files])
    if (!check.ok) { setPickError(check.error); return }
    const read = await readPickedFiles(files)
    if (!read.ok) { setPickError(read.error); return }
    setPickError('')
    setPages(p => [...p, ...read.files])
  }

  async function send() {
    if (needsSinglePageConfirm(pages) &&
        !window.confirm("You're handing in only 1 page. You can't add more after this. Submit it?")) return
    if (replacing && !window.confirm(
      `This replaces the ${replacing.pages} page${replacing.pages === 1 ? '' : 's'} you sent earlier. Only the new pages will be marked. Replace?`)) return
    setSendError('')
    setProgress({ done: 0, total: pages.length })
    const r = await sendHomework({
      mobile, lwsId, assignmentId: hw.id, files: pages, replace: Boolean(replacing), post, upload,
      onProgress: (done, total) => setProgress({ done, total }),
    })
    setProgress(null)
    if (!r.ok) { setSendError(r.error); return }
    setPages([])
    onHandedIn()
  }

  const busy = progress !== null
  const n = pages.length
  const ids = { pick: `hw-pick-${hw.id}`, camera: `hw-camera-${hw.id}` }

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-border">
      <div className="text-[12px] font-semibold text-ink-2">{replacing ? 'Replace your submission' : 'Submit your work'}</div>
      <div className="flex flex-wrap gap-2">
        {/* Once a page is in, "Take photo page N" is the step students skipped (they
            took Submit for "send this page"), so it is drawn to stand out. */}
        <label htmlFor={ids.camera}
               className={`btn cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                 n === 0 ? 'btn-secondary btn-sm' : 'border-2 border-accent bg-accent-soft text-accent-hover font-bold shadow-sm'}`}>
          {n === 0 ? '📷 Take a photo' : `📷 Take photo page ${n + 1}`}
          <input id={ids.camera} type="file" accept={CAMERA_ACCEPT} capture="environment" className="sr-only"
                 disabled={busy} onChange={add} />
        </label>
        <label htmlFor={ids.pick}
               className="btn btn-secondary btn-sm cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-accent">
          📎 Choose photos or PDF
          <input id={ids.pick} type="file" accept={ACCEPT} multiple className="sr-only"
                 disabled={busy} onChange={add} />
        </label>
      </div>
      {pickError && <Alert type="error">{pickError}</Alert>}

      {n > 0 && (
        <ol className="text-[12px] flex flex-col gap-1">
          {pages.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <span className="text-ink-3 w-14">Page {i + 1}</span>
              <span className="truncate">{f.name}</span>
              {!busy && (
                <button className="ml-auto text-red-600 hover:underline" aria-label={`Remove page ${i + 1}`}
                        onClick={() => setPages(p => p.filter((_, j) => j !== i))}>Remove</button>
              )}
            </li>
          ))}
        </ol>
      )}

      {n > 0 && (
        <div className="flex items-center gap-3">
          <button className="btn btn-primary text-[13px]" disabled={busy} onClick={send}>
            {n === 1 ? 'Submit 1 page (final)' : `Submit all ${n} pages (final)`}
          </button>
          {busy && (
            <span className="text-[12px] text-ink-3" role="status">
              Uploading page {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </span>
          )}
        </div>
      )}
      {sendError && <Alert type="error">{sendError}</Alert>}
      {replacing ? (
        <p className="text-[11px] text-ink-3">
          Add every page again — the new set replaces everything you sent before. This is
          replacement {MAX_REPLACEMENTS - replacing.left + 1} of {MAX_REPLACEMENTS}; once it is graded it can't be changed.
        </p>
      ) : (
        <p className="text-[11px] text-ink-3">
          Photograph each page in good light, in order. Submit sends all the pages above together — you
          can't add a page afterwards.
        </p>
      )}
      {replacing && !busy && (
        <div>
          <button className="text-[12px] font-semibold text-ink-3 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  )
}
