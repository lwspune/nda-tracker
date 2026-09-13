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
function gradeAll(readable, exam, roster) {
  return readable.map(s => {
    const outcomes = {}
    for (const d of s.result.decisions) {
      if (d.state === 'multi') outcomes[d.q] = 'multi'
      else if (d.choice) outcomes[d.q] = d.choice
    }
    const graded = gradeScannedSheet({
      outcomes, questions: exam.questions, marking: exam.marking,
    })
    const profile = roster.find(r => r.lwsId === s.result.student.lwsId)
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

  const layout = useMemo(() => {
    if (!exam) return null
    try { return buildSheetLayout({ questionCount: exam.questions.length }) } catch { return null }
  }, [exam])

  const duplicates = useMemo(
    () => findDuplicateRolls(sheets.map((s, i) => ({ sheet: i + 1, lwsId: s.result?.student?.lwsId ?? null }))),
    [sheets])

  const readable = sheets.filter(s => s.result?.ok)
  const blocked = sheets.some(s => !s.result?.ok || !s.result.complete) || duplicates.length > 0

  // What saving would do to results already filed. Computed from the sheets as
  // they stand so the counts and the provenance warning are the ones the button
  // will act on, not a second opinion about them.
  const plan = useMemo(
    () => (exam ? planScanSave({ exam, scanned: gradeAll(readable, exam, roster), roster }) : null),
    // `readable` is derived from `sheets` each render; depending on it directly
    // would rebuild on every keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exam, sheets, roster])

  const canSave = readable.length > 0 && !blocked && !busy
    && !(plan?.mixesProvenance && !mixOk)

  async function onFiles(e) {
    const files = [...(e.target.files || [])]
    if (!files.length || !layout) return
    setBusy(true); setSaved(null)
    const next = []
    for (const file of files) {
      try {
        const image = await decodeImage(file)
        next.push({ name: file.name, result: readSheetImage(image, { layout, roster }) })
      } catch (err) {
        console.error('[scan] could not read', file.name, err)
        next.push({ name: file.name, result: { ok: false, reason: 'Could not open that image.' } })
      }
    }
    setSheets(prev => [...prev, ...next])
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  /** Resolve one flagged question by hand. */
  function resolve(sheetIdx, q, outcome) {
    setSheets(prev => prev.map((s, i) => {
      if (i !== sheetIdx) return s
      const decisions = s.result.decisions.map(d =>
        d.q === q ? { ...d, review: false, choice: outcome === 'multi' || outcome === 'blank' ? null : outcome,
                      state: outcome === 'multi' ? 'multi' : outcome === 'blank' ? 'blank' : 'single',
                      resolvedByHand: true }
                  : d)
      const needsReview = decisions.filter(d => d.review)
      const answers = Object.fromEntries(decisions.map(d => [d.q, d.choice]))
      return {
        ...s,
        result: {
          ...s.result, decisions, needsReview, answers,
          reviewCount: needsReview.length,
          complete: needsReview.length === 0 && !s.result.roll.review && !s.result.student.review,
        },
      }
    }))
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
        <PageHeader title="Scan answer sheets" subtitle="Read filled OMR sheets into an exam" />
        <EmptyState
          icon="🫧"
          title="No exam to scan into"
          message="Scanning needs a paper with per-question data. Upload or push one first, then print its answer sheet from the Exams page."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Scan answer sheets" subtitle="Read filled OMR sheets into an exam" />

      {/* The link, not this screen, is what reaches the phone the sheets will
          be shot with — and it must be built with the base prefix, or the
          gh-pages build hands out a link that 404s silently. */}
      {locked && (
        <CopyLinkBar
          label="Scan link"
          url={buildScanUrl(exam.id, window.location.origin, import.meta.env.BASE_URL)}
          hint="Opens this exam's scanner straight away — send it to the phone doing the scanning."
        />
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

          {exam && (
            <div className="text-[12px] text-ink-3">
              {roster.length
                ? `${roster.length} students in this exam's batch`
                : 'No batch on this exam — every sheet will need its student set by hand'}
            </div>
          )}
        </div>
      </Card>

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
          roster={roster}
          onResolve={(q, outcome) => resolve(i, q, outcome)}
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

function SheetCard({ index, sheet, roster, onResolve }) {
  const r = sheet.result
  if (!r?.ok) {
    return (
      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="danger">Sheet {index + 1}</Badge>
          <span className="text-[13px] text-ink-1 font-semibold">{sheet.name}</span>
        </div>
        <div className="text-[12px] text-danger mt-1">{r?.reason || 'Could not read this sheet.'}</div>
      </Card>
    )
  }
  const student = roster.find(s => s.lwsId === r.student.lwsId)
  const answered = Object.values(r.answers).filter(Boolean).length
  return (
    <Card>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={r.complete ? 'success' : 'warning'}>Sheet {index + 1}</Badge>
        <span className="text-[13px] text-ink-1 font-semibold">
          {student ? student.name : 'Student not identified'}
        </span>
        <span className="text-[12px] text-ink-3">
          roll {r.roll.digits || '—'} · {answered} answered · {r.reviewCount} to check
        </span>
      </div>

      {r.student.review && (
        <div className="text-[12px] text-danger mt-1">{r.student.reason || r.roll.reason}</div>
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
