// Scanning OMR answer sheets.
//
// A page of its own rather than a modal on the Exams card, for the reason
// routing.js gives for the other capture surfaces: it is a different job, done
// standing over a stack of paper with a phone, while the Exams page manages
// exams at a desk and already carries eight controls per card.
//
// The reading is all done by tested pure modules; what lives here is choosing an
// exam, getting pixels out of a file, showing what came back, and refusing to
// save anything a human has not resolved.

import { useMemo, useRef, useState } from 'react'
import useStore from '../store/useStore'
import { PageHeader, EmptyState, Card, Badge } from '../components/ui'
import CopyLinkBar from '../components/ui/CopyLinkBar'
import { buildScanUrl } from '../lib/routing'
import { fmtDate } from '../lib/dates'
import { getExamBatches, examFormat } from '../lib/analytics'
import { buildSheetLayout } from '../lib/omr/layout'
import { readSheetImage } from '../lib/omr/readSheetImage'
import { buildScanRoster } from '../lib/omr/scanRoster'
import { gradeScannedSheet } from '../lib/omr/gradeSheet'
import { findDuplicateRolls } from '../lib/omr/resolveRoll'
import { planScanSave } from '../lib/omr/mergeResults'
import { resolveQuestion, assignStudent } from '../lib/omr/reviewSheet'
import SheetScanner from '../components/scan/SheetScanner'

/**
 * A File to ImageData, via a canvas.
 *
 * Downscaled to 1600px on the long edge: Evalbee reads its own sheets from
 * 1080x1440, so a 12 MP frame buys nothing but memory and time, and an operator
 * working through 300 sheets feels every megabyte.
 */
async function fileToImageData(file, maxEdge = 1600) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return ctx.getImageData(0, 0, width, height)
}

/**
 * The read sheets as exam result rows.
 *
 * Hoisted out of the save handler so the preview counts and the save itself are
 * built from the SAME rows — a preview that grades the stack its own way stops
 * being a preview of what the button does.
 */
function gradeAll(readable, exam, people) {
  return readable.map(s => {
    const outcomes = {}
    for (const d of s.result.decisions) {
      if (d.state === 'multi') outcomes[d.q] = 'multi'
      else if (d.choice) outcomes[d.q] = d.choice
    }
    const graded = gradeScannedSheet({
      outcomes, questions: exam.questions, marking: exam.marking,
    })
    // `people`, not the roster: a sheet attributed by hand may name somebody
    // outside this exam's batch, and filing their marks under a bare LWS id
    // would mint a result row nothing else can match.
    const profile = people.find(r => r.lwsId === s.result.student.lwsId)
    return {
      name: profile?.name || s.result.student.lwsId,
      rollNo: s.result.roll.digits || '',
      totalMarks: graded.totalMarks,
      correct: graded.correct,
      incorrect: graded.incorrect,
      notAttempted: graded.notAttempted,
      responses: graded.responses,
      choices: graded.choices,
    }
  })
}

/** How a print format is named to the operator, wherever it is shown. */
const FORMAT_LABEL = { 1: 'one per page', 2: 'two per page' }

export default function ScanSheetsPage({ decodeImage = fileToImageData }) {
  const exams = useStore(s => s.exams)
  // Not defaulted here: `x || []` mints a new array every render, so the memo
  // below would rebuild the roster on each one.
  const studentList = useStore(s => s.studentList)
  const replaceExam = useStore(s => s.replaceExam)
  // Set when the scanner was opened FROM an exam — its card, or a /scan?exam=
  // link. Null when it was opened from the sidebar, and then the picker shows.
  const scanExamId = useStore(s => s.scanExamId)

  const [examId, setExamId] = useState('')
  // Opened on one exam, the picker is out of the way until it is wanted.
  const [picking, setPicking] = useState(false)
  const [sheets, setSheets] = useState([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(null)
  // An explicit yes to mixing scanner-graded marks into a vendor-graded exam.
  const [mixOk, setMixOk] = useState(false)
  // Which print format to read against — 'auto' lets the sheet answer for
  // itself, and is only worth overriding for the counts where it cannot.
  const [format, setFormat] = useState('auto')
  const fileRef = useRef(null)

  // Only a paper with per-question data can be scanned; a written exam records a
  // total and has no bubbles to read.
  //
  // Newest first. The list holds every MCQ exam the school has ever run, and the
  // one being scanned was almost certainly sat this week — store order buried it
  // a hundred rows down.
  const scannable = useMemo(
    () => (exams || [])
      .filter(e => examFormat(e) === 'mcq')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [exams])

  // The exam named on the way in wins, until the operator asks to change it.
  // A named exam that is not here (a stale link, a deleted paper) falls back to
  // the picker rather than to nothing.
  const named = scanExamId && !picking ? scannable.find(e => e.id === scanExamId) : null
  const exam = named || scannable.find(e => e.id === examId) || null
  const locked = Boolean(named)

  const roster = useMemo(
    () => (exam ? buildScanRoster(studentList || [], getExamBatches(exam)) : []),
    [exam, studentList])

  // Who a sheet may be attributed to BY HAND. Wider than `roster` on purpose:
  // the roster is what a roll NUMBER is matched against, and keeping that narrow
  // is what stops a misread digit landing on another cohort's student. A person
  // reading the sheet in their hand is not misreading anything, and batch
  // membership is CURRENT while the exam is historical — the student who moved
  // last term still sat this paper.
  const people = useMemo(() => {
    const inBatch = new Set(roster.map(r => r.lwsId))
    const everyone = (studentList || [])
      .filter(s => s?.lws_id)
      .map(s => ({ lwsId: s.lws_id, name: s.canonical_name || s.name || s.lws_id }))
    return [
      ...everyone.filter(p => inBatch.has(p.lwsId)),
      ...everyone.filter(p => !inBatch.has(p.lwsId)),
    ]
  }, [roster, studentList])

  /**
   * The formats this paper can be printed in, as layouts.
   *
   * Both are offered to the reader by default. The printed sheet carries no
   * legible format marking — the stamp that names it is a few millimetres of
   * type — so requiring the operator to remember which button they printed from
   * is a setting they can only get wrong, and getting it wrong reads as "is it
   * the right paper?" about paper that is correct. The detected grid settles it
   * for every question count except the 28 where both formats print the same
   * shape; there the reader refuses and `format` below is the way out.
   */
  const formats = useMemo(() => {
    if (!exam) return []
    return [1, 2].flatMap(perPage => {
      try { return [buildSheetLayout({ questionCount: exam.questions.length, perPage })] }
      catch { return [] }       // longer than that format can hold
    })
  }, [exam])

  const layouts = useMemo(
    () => (format === 'auto' ? formats : formats.filter(l => String(l.perPage) === format)),
    [formats, format])
  const layout = layouts[0] || null

  const duplicates = useMemo(
    () => findDuplicateRolls(sheets.map((s, i) => ({ sheet: i + 1, lwsId: s.result?.student?.lwsId ?? null }))),
    [sheets])

  const readable = sheets.filter(s => s.result?.ok)
  const blocked = sheets.some(s => !s.result?.ok || !s.result.complete) || duplicates.length > 0

  // What saving would do to results already filed. Computed from the sheets as
  // they stand so the counts and the provenance warning are the ones the button
  // will act on, not a second opinion about them.
  const plan = useMemo(
    () => (exam ? planScanSave({ exam, scanned: gradeAll(readable, exam, people), roster }) : null),
    // `readable` is derived from `sheets` each render; depending on it directly
    // would rebuild on every keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exam, sheets, roster, people])

  const canSave = readable.length > 0 && !blocked && !busy
    && !(plan?.mixesProvenance && !mixOk)

  async function onFiles(e) {
    const files = [...(e.target.files || [])]
    if (!files.length || !layouts.length) return
    setBusy(true); setSaved(null)
    const next = []
    for (const file of files) {
      try {
        const image = await decodeImage(file)
        next.push({ name: file.name, result: readSheetImage(image, { layouts, roster }) })
      } catch (err) {
        console.error('[scan] could not read', file.name, err)
        next.push({ name: file.name, result: { ok: false, reason: 'Could not open that image.' } })
      }
    }
    setSheets(prev => [...prev, ...next])
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  /**
   * A sheet the viewfinder read.
   *
   * Lands in the same list the file input fills, and is named so a bad one can
   * be told apart from the files beside it — one review list decides what may be
   * saved, whatever the pixels came from.
   */
  function onCamera(result) {
    setSaved(null)
    setSheets(prev => [
      ...prev,
      { name: `Camera sheet ${prev.filter(s => s.fromCamera).length + 1}`, fromCamera: true, result },
    ])
  }

  /** Apply one human decision to one sheet. */
  function amend(sheetIdx, fn) {
    setSheets(prev => prev.map((s, i) => (i === sheetIdx ? { ...s, result: fn(s.result) } : s)))
  }

  /**
   * Drop a sheet from the stack.
   *
   * A sheet that could not be read blocks the save for everything beside it, and
   * a blurry photograph in the middle of a batch is ordinary. Without this the
   * only way out was changing the exam, which discards every sheet scanned so far.
   */
  function discard(sheetIdx) {
    setSheets(prev => prev.filter((_, i) => i !== sheetIdx))
    setSaved(null)
  }

  function save() {
    if (!exam || !canSave || !plan) return
    // Merged, never replaced: a stack is scanned over several sittings, and the
    // sheets in hand are not the exam's whole result set. `gradedBy` comes from
    // the plan, which keeps the vendor's label while any vendor-graded row
    // survives — that is what a later key correction reads before deciding
    // whether it may re-grade.
    replaceExam(exam.id, { ...exam, students: plan.students, gradedBy: plan.gradedBy })
    setSaved({ added: plan.added, replaced: plan.replaced })
    setSheets([])
    setMixOk(false)
  }

  if (!scannable.length) {
    return (
      <div className="space-y-4">
        <PageHeader title="Scan answer sheets" sub="Read filled OMR sheets into an exam" />
        <EmptyState
          icon="🫧"
          title="No exam to scan into"
          sub="Scanning needs a paper with per-question data. Upload or push one first, then print its answer sheet from the Exams page."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Scan answer sheets" sub="Read filled OMR sheets into an exam" />

      {/* The link, not this screen, is what reaches the phone the sheets will
          be shot with — and it must be built with the base prefix, or the
          gh-pages build hands out a link that 404s silently.

          Which is also why it is hidden below the md breakpoint: on a phone this
          is a 200px card quoting a URL to the device already sitting at it, and
          those 200px are most of what pushes the camera button off the bottom of
          a 360x640 screen. It stays on the desk screen, which is the one the
          link is sent FROM. */}
      {locked && (
        <div className="max-md:hidden">
          <CopyLinkBar
            label="Scan link"
            url={buildScanUrl(exam.id, window.location.origin, import.meta.env.BASE_URL)}
            hint="Opens this exam's scanner straight away — send it to the phone doing the scanning."
          />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          {locked ? (
            <div className="flex flex-col gap-1 text-[12px] text-ink-2">
              Exam
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-semibold text-ink-1">{exam.name}</span>
                <span className="text-[12px] text-ink-3">
                  {exam.questions.length}Q · {fmtDate(exam.date)}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary text-[11px]"
                  onClick={() => { setPicking(true); setSheets([]); setSaved(null); setMixOk(false) }}
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            Exam
            <select
              className="form-input min-w-[220px]"
              value={examId}
              onChange={e => {
                setExamId(e.target.value); setSheets([]); setSaved(null); setMixOk(false)
              }}
            >
              <option value="">Choose an exam…</option>
              {scannable.map(e => (
                <option key={e.id} value={e.id}>{e.name} · {e.questions.length}Q</option>
              ))}
            </select>
          </label>
          )}

          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            Sheets
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              disabled={!exam || busy}
              onChange={onFiles}
              className="form-input"
              aria-label="Choose sheet photographs"
            />
          </label>

          {/* Only worth showing when there is something to choose between. For
              most papers the grid answers it, and the operator never has to
              know this exists — it is here for the counts where both formats
              print the same shape and the reader rightly refuses to guess. */}
          {formats.length > 1 && (
            <label className="flex flex-col gap-1 text-[12px] text-ink-2">
              Sheet format
              <select
                className="form-input"
                value={format}
                onChange={e => setFormat(e.target.value)}
                aria-label="Sheet format"
              >
                <option value="auto">Detect from the sheet</option>
                {formats.map(l => (
                  <option key={l.perPage} value={String(l.perPage)}>
                    {FORMAT_LABEL[l.perPage]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {exam && (
            <div className="text-[12px] text-ink-3">
              {roster.length
                ? `${roster.length} students in this exam's batch`
                : 'No batch on this exam — every sheet will need its student set by hand'}
            </div>
          )}
        </div>
      </Card>

      {/* The camera reads the sheet as it sees it, so a stack is one motion per
          sheet instead of photograph-then-wait. The file input stays for
          desktops, for a device that refuses the camera, and for re-reading a
          shot somebody already took. */}
      {exam && layout && (
        <Card>
          <SheetScanner layouts={layouts} roster={roster} onCapture={onCamera} />
        </Card>
      )}

      {busy && <Card><div className="text-[13px] text-ink-2">Reading sheets…</div></Card>}

      {saved && (
        <Card>
          <div className="text-[13px] text-accent font-semibold">
            Saved to {exam?.name} — {saved.added} new
            {saved.replaced > 0 && `, ${saved.replaced} re-scanned`}.
          </div>
        </Card>
      )}

      {duplicates.length > 0 && (
        <Card>
          <div className="text-[13px] text-danger font-semibold mb-1">
            Two sheets for the same student
          </div>
          <div className="text-[12px] text-ink-2">
            {duplicates.map(d => `${d.lwsId} (sheets ${d.sheets.join(' and ')})`).join('; ')}.
            One of them belongs to somebody else — fix it before saving.
          </div>
        </Card>
      )}

      {sheets.map((s, i) => (
        <SheetCard
          key={`${s.name}-${i}`}
          index={i}
          sheet={s}
          people={people}
          showFormat={formats.length > 1}
          onResolve={(q, outcome) => amend(i, r => resolveQuestion(r, q, outcome))}
          onAssign={lwsId => amend(i, r => assignStudent(r, lwsId))}
          onDiscard={() => discard(i)}
        />
      ))}

      {/* Scanning into an exam somebody else graded. Both labels would then be
          true of the same result set, so the exam keeps the vendor's — and that
          is a call for a human, not a default. */}
      {plan?.mixesProvenance && sheets.length > 0 && (
        <Card>
          <div className="text-[13px] text-ink-1 font-semibold mb-1">
            This exam already has results graded by Evalbee
          </div>
          <div className="text-[12px] text-ink-2 mb-2">
            Scanned marks are graded here, against the answer key; Evalbee&rsquo;s are its own
            verdict and must never be re-derived from a key. Saving mixes the two, so the
            exam stays labelled Evalbee-graded and a future key correction will leave it alone.
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mixOk}
              onChange={e => setMixOk(e.target.checked)}
              className="accent-accent"
            />
            Mix scanned marks into this exam
          </label>
        </Card>
      )}

      {sheets.length > 0 && (
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-ink-2">
              {readable.length} of {sheets.length} read
              {plan?.kept > 0 && ` · ${plan.kept} kept`}
              {plan?.replaced > 0 && ` · ${plan.replaced} re-scanned`}
              {blocked && ' · something still needs resolving'}
            </div>
            <button className="btn btn-primary" disabled={!canSave} onClick={save}>
              Save {readable.length} result{readable.length === 1 ? '' : 's'}
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

/** Drop this sheet. Every card carries one — see `discard`. */
function DiscardButton({ index, onDiscard }) {
  return (
    <button
      type="button"
      onClick={onDiscard}
      aria-label={`Discard sheet ${index + 1}`}
      title="Remove this sheet from the stack"
      className="ml-auto text-ink-3 hover:text-danger text-[12px] font-semibold
                 min-h-[44px] px-2 rounded focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      ✕ Discard
    </button>
  )
}

function SheetCard({ index, sheet, people, showFormat, onResolve, onAssign, onDiscard }) {
  const r = sheet.result
  if (!r?.ok) {
    return (
      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="red">Sheet {index + 1}</Badge>
          <span className="text-[13px] text-ink-1 font-semibold">{sheet.name}</span>
          <DiscardButton index={index} onDiscard={onDiscard} />
        </div>
        <div className="text-[12px] text-danger mt-1">{r?.reason || 'Could not read this sheet.'}</div>
      </Card>
    )
  }
  const student = people.find(s => s.lwsId === r.student.lwsId)
  const answered = Object.values(r.answers).filter(Boolean).length
  return (
    <Card>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={r.complete ? 'green' : 'yellow'}>Sheet {index + 1}</Badge>
        <span className="text-[13px] text-ink-1 font-semibold">
          {student ? student.name : 'Student not identified'}
        </span>
        <span className="text-[12px] text-ink-3">
          roll {r.roll.digits || '—'} · {answered} answered · {r.reviewCount} to check
        </span>
        {/* Which capture this row came from. Only matters when a row looks
            wrong, so it sits last and quiet — but then it is the only way to
            know which photograph or which pass of the camera to redo. */}
        <span className="text-[11px] text-ink-3 font-mono">{sheet.name}</span>
        {/* Which format this one read as. A stack printed one way reads the
            same way all through, so an odd row out is the tell that a sheet
            from another print run got into the pile. */}
        {showFormat && FORMAT_LABEL[r.perPage] && (
          <span className="text-[11px] text-ink-3">{FORMAT_LABEL[r.perPage]}</span>
        )}
        <DiscardButton index={index} onDiscard={onDiscard} />
      </div>

      {/* A refusal with no answer is a dead end: an unattributed sheet blocks
          the save for the whole stack. `candidates` is what the roll matched
          when it matched more than one student — offered first, because that is
          the case where the reader already knows both names. */}
      {r.student.review && (
        <div className="mt-1 space-y-1">
          <div className="text-[12px] text-danger">{r.student.reason || r.roll.reason}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {(r.student.candidates || []).map(c => (
              <button
                key={c.lwsId}
                className="btn btn-sm btn-secondary text-[11px]"
                onClick={() => onAssign(c.lwsId)}
              >
                {c.name || c.lwsId}
              </button>
            ))}
            {/* A <select> IS right here, unlike the tag controls in Step3Tags.
                That rule exists because a select cannot display a value absent
                from its options, so correct-but-unlisted data read as missing.
                Here there is no held value to display — it is a choose-once
                action that resets — and an id that is not a real student must
                never be acceptable. Batch members are listed first. */}
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              Whose sheet is this?
              <select
                className="form-input text-[12px] min-w-[200px]"
                value=""
                onChange={e => e.target.value && onAssign(e.target.value)}
              >
                <option value="">Choose a student…</option>
                {people.map(p => (
                  <option key={p.lwsId} value={p.lwsId}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {r.needsReview.map(d => (
        <div key={d.q} className="mt-2 flex items-center gap-2 flex-wrap text-[12px]">
          <span className="text-ink-2">
            Q{d.q} · {d.state === 'multi' ? 'more than one mark' : 'unclear mark'}
            {' · '}
            {d.scores.map((s, i) => `${'ABCD'[i]} ${(s * 100).toFixed(0)}%`).join('  ')}
          </span>
          {['A', 'B', 'C', 'D'].map(letter => (
            <button key={letter} className="btn btn-sm btn-secondary"
              onClick={() => onResolve(d.q, letter)}>{letter}</button>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={() => onResolve(d.q, 'blank')}>Blank</button>
          <button className="btn btn-sm btn-secondary" onClick={() => onResolve(d.q, 'multi')}>Both / wrong</button>
        </div>
      ))}
    </Card>
  )
}
