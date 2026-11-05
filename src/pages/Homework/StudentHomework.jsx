import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Card, Badge, Alert, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { ACCEPT, CAMERA_ACCEPT, SUBMISSIONS_BUCKET, validateUploadFiles } from '../../lib/assignments/upload'
import { fmtDeadline } from '../../lib/assignments/editor'
import { MAX_REPLACEMENTS } from '../../lib/assignments/status'
import { sendHomework, readPickedFiles, needsSinglePageConfirm } from '../../lib/assignments/studentUpload'
import MarkedPaperReport from './MarkedPaperReport'
import CalculationErrorsCard from './CalculationErrorsCard'
import { summariseCalculationErrors } from '../../lib/assignments/calculationErrors'

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
  // Which homework's marks are open: here, not in each card, so a row in the
  // calculation-errors card can open one.
  const [openMarks, setOpenMarks] = useState(() => new Set())
  // Collapsed by default (2026-11-05): the section opens by itself only when
  // something can still be handed in, and so do those cards, so a deadline is
  // never hidden. Set once, on the first load — a reload after handing in must
  // not close what the student has open.
  const [sectionOpen, setSectionOpen] = useState(false)
  const [openCards, setOpenCards] = useState(() => new Set())
  const initialised = useRef(false)
  const bodyId = useId()

  const known = Boolean(mobile && lwsId)
  const load = useCallback(async () => {
    const r = await post({ kind: 'homework-list', mobile, lwsId })
    if (!r.ok) { setError(r.body?.error || 'Could not load homework.'); setHomework([]); return }
    setError('')
    const list = r.body.homework ?? []
    setHomework(list)
    if (!initialised.current) {
      initialised.current = true
      const due = list.filter(h => h.canSubmit).map(h => h.id)
      setOpenCards(new Set(due))
      setSectionOpen(due.length > 0)
    }
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

  const toggleMarks = id => setOpenMarks(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleCard = id => setOpenCards(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  // A calculation-errors row opens that homework's card as well as its marks:
  // the card is usually collapsed (it is graded, so nothing is due on it).
  const openFromSummary = id => {
    setOpenCards(prev => new Set(prev).add(id))
    setOpenMarks(prev => new Set(prev).add(id))
    requestAnimationFrame(() => document.getElementById(`homework-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setSectionOpen(o => !o)}
        aria-expanded={sectionOpen}
        aria-controls={bodyId}
        className="w-full flex items-center gap-2 mb-2 min-h-[44px] text-left rounded
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="text-[13px] font-extrabold text-ink uppercase tracking-wide">📤 Homework</span>
        <span className="ml-auto text-[12px] text-ink-3 text-right">{homeworkSummary(homework)}</span>
        <span aria-hidden="true" className="text-ink-3">{sectionOpen ? '▴' : '▾'}</span>
      </button>
      {sectionOpen && (
        <div id={bodyId}>
          <CalculationErrorsCard summary={summariseCalculationErrors(homework)} onOpen={openFromSummary} />
          <div className="space-y-2">
            {homework.map(h => (
              <HomeworkCard key={h.id} hw={h} mobile={mobile} lwsId={lwsId} onHandedIn={load}
                            open={openCards.has(h.id)} onToggle={() => toggleCard(h.id)}
                            showMarks={openMarks.has(h.id)} onToggleMarks={() => toggleMarks(h.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// "2 to do · 1 waiting · 4 graded · 1 missed" — the section header, so a
// closed section still says whether anything needs doing. Same buckets as the
// status badges: a sent-back hand-in that can be resubmitted is "to do", and a
// held grade reads as waiting, exactly as its badge does.
function homeworkSummary(list) {
  let toDo = 0, waiting = 0, graded = 0, missed = 0
  for (const h of list) {
    const s = h.submission?.status
    if (h.canSubmit) toDo++
    else if (s === 'graded') graded++
    else if (s === 'submitted') waiting++
    else if (h.state === 'closed') missed++
  }
  return [
    toDo && `${toDo} to do`, waiting && `${waiting} waiting`,
    graded && `${graded} graded`, missed && `${missed} missed`,
  ].filter(Boolean).join(' · ')
}

function statusBadge(hw) {
  const s = hw.submission?.status
  if (s === 'graded') return <Badge variant="green">Graded</Badge>
  if (s === 'submitted') return <Badge variant="yellow">Waiting to be graded</Badge>
  if (s === 'rejected' && hw.canSubmit) return <Badge variant="red">Sent back</Badge>
  if (hw.state === 'closed') return <Badge variant="gray">Not submitted</Badge>
  return <Badge variant="blue">To do</Badge>
}

// One row until tapped (2026-11-05): title, deadline, status and — once graded
// — the score, so a closed card still answers "how did I do". The parent
// decides which cards start open (only those that can still be handed in).
function HomeworkCard({ hw, mobile, lwsId, onHandedIn, open, onToggle, showMarks, onToggleMarks }) {
  const [replacing, setReplacing] = useState(false)
  const sub = hw.submission
  const graded = sub?.status === 'graded'

  return (
    <Card id={`homework-${hw.id}`} data-testid="homework-card" className="flex flex-col gap-2 scroll-mt-[80px]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-start gap-2 w-full text-left rounded min-h-[44px]
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-ink">{hw.title}</div>
          <div className="text-[11px] text-ink-3 font-mono">
            {hw.subject} · out of {hw.maxMarks} · {hw.state === 'open' ? 'due' : 'was due'} {fmtDeadline(hw.dueAt)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {statusBadge(hw)}
          {graded && <span className="text-[14px] font-bold font-mono text-ink">{sub.totalAwarded} / {sub.totalMax}</span>}
        </div>
        <span aria-hidden="true" className="text-ink-3 mt-0.5">{open ? '▴' : '▾'}</span>
      </button>

      {open && <>
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

      {graded && (
        <div className="flex flex-col gap-2">
          {/* The score sits on the card's row above, open or closed. */}
          <div>
            <button className="text-[12px] font-semibold text-accent hover:underline min-h-[32px] rounded
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-expanded={showMarks} onClick={onToggleMarks}>
              {showMarks ? 'Hide marks' : 'See marks'}
            </button>
          </div>
          {showMarks && <MarkedPaperReport sub={sub} />}
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
      </>}
    </Card>
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
