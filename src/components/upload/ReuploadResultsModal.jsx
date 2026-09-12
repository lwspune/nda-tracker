import { useState, useRef } from 'react'
import { parseExcelFull } from '../../lib/excel'
import { assessMarking } from '../../lib/markingCheck'
import { findKeyMismatches, applyKeyChoices } from '../../lib/answerKeyCheck'
import { detectBatch } from '../../lib/matchStudents'
import { dominantBranch } from '../../lib/students/dominantBranch'
import { visibleBatchOptions, isArchivedBatch } from '../../lib/batchVisibility'
import { getExamBatches } from '../../lib/analytics'
import { SUBJECTS } from '../../lib/ndaFreq'
import { Alert, DropZone, Spinner } from '../ui'
import KeyMismatchPanel from './KeyMismatchPanel'
import useStore from '../../store/useStore'

// Attach an Evalbee results sheet to an exam that already exists — and, from that
// same sheet, complete the exam facts nothing else in the app can supply.
//
// That second job exists because of the PYQ Vault paper push: a pushed paper
// arrives as a draft dated TODAY, with a placeholder +4/-1 and no batch, because
// the vault cannot know any of those. No other admin surface edits an MCQ exam's
// metadata, so without this the draft could never be corrected. See
// RESULTS_REUPLOAD.md — and note the sheet itself carries no date column: the only
// date it ships is in its FILENAME.
export default function ReuploadResultsModal({ exam, onClose }) {
  const replaceExam     = useStore(s => s.replaceExam)
  const studentProfiles = useStore(s => s.studentProfiles) || {}
  const syllabusBatches = useStore(s => s.syllabusBatches) || []
  const archivedBatches = useStore(s => s.archivedBatches) || []

  const [resultsFile, setResultsFile] = useState(null)
  const [dragging, setDragging]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [parsed, setParsed]           = useState(null)
  const fileRef = useRef()

  // Exam facts, seeded from the exam and then from the file (below).
  const [date, setDate]               = useState(exam.date)
  const [markCorrect, setMarkCorrect] = useState(exam.marking?.correct ?? 4)
  const [markWrong, setMarkWrong]     = useState(exam.marking?.wrong ?? 0)
  const [subject, setSubject]         = useState(exam.subject || 'Maths')
  const [batch, setBatch]             = useState(exam.batch || '')
  const [branch, setBranch]           = useState(exam.branch || '')
  const [syncAbsences, setSyncAbsences] = useState(true)
  const [markingAck, setMarkingAck]   = useState(false)
  const [keyChoices, setKeyChoices]   = useState({})

  // Defensive `|| []`: an exam pushed from PYQ Vault is created with NO results,
  // and this modal is exactly where faculty then attach the Evalbee output — so
  // a crash here would land at the worst possible moment. The Supabase read path
  // already defaults these (`persist.js` maps `students: resultsByExam[id] ?? []`),
  // so this guards the paths that don't go through it rather than a known break.
  const oldStudents      = exam.students  || []
  const storedQuestions  = exam.questions || []
  const oldStudentCount  = oldStudents.length
  const oldQuestionCount = storedQuestions.length

  const assess = parsed ? assessMarking(parsed) : null

  // Seed the exam facts from the parsed file. Keyed on the parsed object and done
  // in RENDER rather than an effect, so a re-render cannot clobber what is being
  // typed — the pattern OfflineExamModal already uses for its edit view.
  const [seededFor, setSeededFor] = useState(null)
  if (parsed && seededFor !== parsed) {
    setSeededFor(parsed)
    // The stored date is the fallback, NEVER today: `parsed.examDate` still falls
    // back to today for the upload wizard, and using it here would stamp today on
    // a historical exam and look exactly like a real answer.
    setDate(parsed.examDateFromFile ?? exam.date)
    // A refused scheme is not seeded at all — the fields keep what the exam holds,
    // so a number we just said we could not read is never put in the box.
    if (assess.status !== 'refuse') {
      setMarkCorrect(assess.correct)
      setMarkWrong(assess.wrong)
    }
    // Fill-only: never overwrite a batch/branch faculty already set.
    if (!exam.batch) {
      const detected = detectBatch(parsed.students || [], studentProfiles)
      if (detected.batch) setBatch(detected.batch)
    }
    if (!exam.branch) {
      const auto = dominantBranch(Object.values(studentProfiles))
      if (auto) setBranch(auto)
    }
    setMarkingAck(false)
    setKeyChoices({})
  }

  async function handleFileChange(file) {
    setResultsFile(file)
    setParsed(null)
    setError(null)
    if (!file) return

    setLoading(true)
    try {
      setParsed(await parseExcelFull(file))
    } catch (e) {
      setError('Error reading Excel: ' + e.message)
    }
    setLoading(false)
  }

  const newStudents      = parsed?.students ?? null
  const newQuestionCount = parsed?.totalQs ?? null
  const answerKeys       = parsed?.answerKeys || {}
  const hasAnswerKeys    = Object.keys(answerKeys).length > 0
  const questionCountChanged =
    newQuestionCount !== null && newQuestionCount !== oldQuestionCount

  // Two independent keys for the same paper. Silently letting the sheet win was
  // defensible when the stored answer was a hand-typed tags cell; it is not when
  // it came from the bank, and it also reverted a decision faculty made at the
  // original upload. Same resolver as the wizard, same default.
  const keyMismatches = parsed ? findKeyMismatches(storedQuestions, answerKeys) : []
  const hasBankIds    = storedQuestions.some(q => q?.questionId)
  const storedLabel   = hasBankIds ? 'Bank' : 'Stored'
  const storedPicks   = keyMismatches.filter(m => (keyChoices[m.q] || 'results') === 'stored')

  const storedMarking = { correct: exam.marking?.correct, wrong: exam.marking?.wrong ?? 0 }
  const markingChanged = parsed &&
    (markCorrect !== storedMarking.correct || markWrong !== storedMarking.wrong)
  const batchChanged  = parsed && (batch || '') !== (exam.batch || '')
  const branchChanged = parsed && (branch || '') !== (exam.branch || '')
  const dateChanged   = parsed && date !== exam.date
  const subjectChanged = parsed && subject !== (exam.subject || 'Maths')

  const changes = []
  if (dateChanged)   changes.push({ label: 'Date', from: exam.date, to: date })
  if (markingChanged) changes.push({
    label: 'Marking',
    from: `+${storedMarking.correct}/${storedMarking.wrong}`,
    to: `+${markCorrect}/${markWrong}`,
  })
  if (subjectChanged) changes.push({ label: 'Subject', from: exam.subject || 'Maths', to: subject })
  if (batchChanged)  changes.push({ label: 'Batches', from: exam.batch || '— none —', to: batch || '— none —' })
  if (branchChanged) changes.push({ label: 'Branch', from: exam.branch || '— none —', to: branch || '— none —' })

  // Marks-for-a-correct-answer is the examMaxMarks denominator, so moving it moves
  // every percentage already quoted for this exam. An exam with no results has
  // nothing to move, which is the pushed-draft case — no tick there.
  const needsMarkingAck = markingChanged && oldStudentCount > 0
  const canSave = !!newStudents && assess?.status !== 'refuse' && (!needsMarkingAck || markingAck)

  const selectedBatches = new Set(getExamBatches({ batch }))
  // Unlike the upload wizard, this edits exams that may PREDATE the central batch
  // namespace — live data holds `LWS_NDA_2Y_ (26-28)` against a list offering
  // `LWS_NDA_2Y_(26-28)_A`. A picker that cannot display its own value destroys
  // it, so an already-selected batch the central list doesn't know is appended to
  // the list rather than hidden: it renders checked, it can be deselected, and it
  // survives the rebuild below ([[feedback_control_cannot_represent_value]]).
  const batchUniverse = [
    ...syllabusBatches,
    ...[...selectedBatches].filter(b => !syllabusBatches.includes(b)),
  ]
  const visibleBatches = visibleBatchOptions(batchUniverse, archivedBatches, selectedBatches)
  // Preserve batchUniverse order so the joined tag is stable, and filter the FULL
  // list — feeding the visible list here would silently drop an archived tag.
  function toggleBatch(b) {
    const next = new Set(selectedBatches)
    if (next.has(b)) next.delete(b); else next.add(b)
    setBatch(batchUniverse.filter(x => next.has(x)).join(', '))
  }

  const allBranches = [...new Set(
    Object.values(studentProfiles).map(p => p.branch).filter(Boolean)
  )].sort()
  // A <select> renders the FIRST option when its value isn't in the list, so an
  // off-list subject would read as "Maths" and be saved as Maths on the next save.
  const subjectOptions = SUBJECTS.includes(subject) ? SUBJECTS : [subject, ...SUBJECTS]

  function handleSave() {
    if (!canSave) return
    replaceExam(exam.id, {
      // Spread first so fields this modal doesn't edit survive the round-trip —
      // `source` and `createdBy` carry the Written Quiz badge and its author, and
      // `questions[].questionId` / `imageUrl` carry the bank link and diagrams.
      ...exam,
      date,
      subject: subject || 'Maths',
      batch: batch || null,
      branch: branch || null,
      marking: { correct: markCorrect, wrong: markWrong },
      students: newStudents,
      questions: applyKeyChoices(storedQuestions, keyMismatches, keyChoices, answerKeys),
    }, { syncAbsences })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[620px] max-w-[95vw] max-h-[90vh]
                   overflow-y-auto flex flex-col"
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-tight">
              📊 Update Results
            </h2>
            <p className="text-[12px] text-ink-3 mt-0.5">{exam.name} · {exam.date}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-ink-3 hover:text-ink text-[20px] leading-none transition-colors"
          >×</button>
        </div>

        <div className="px-7 py-6 flex-1">
          <p className="text-[13px] text-ink-2 mb-4">
            Upload the results Excel to attach or replace student scores. Question tags
            (chapters, subtopics, solutions, diagrams) are preserved.
          </p>

          {/* File drop zone */}
          <div className="mb-5">
            <label className="form-label">Results Excel <span className="text-danger">*</span></label>
            <DropZone
              file={resultsFile}
              dragging={dragging}
              accept=".xlsx,.xls"
              icon="📊"
              hint="Student responses file (same format as original upload)"
              inputRef={fileRef}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault()
                setDragging(false)
                handleFileChange(e.dataTransfer.files[0] || null)
              }}
              onChange={e => handleFileChange(e.target.files[0])}
            />
          </div>

          {/* ── Exam details, read off this file ──────────────────────────── */}
          {parsed && (
            <div className="mb-5 border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2 border-b border-border
                              text-[10px] font-bold uppercase tracking-wide text-ink-3">
                Exam details — from this file
              </div>

              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label className="form-label !mb-0" htmlFor="rr-date">Date</label>
                      {parsed.examDateFromFile && <AutoBadge>from file</AutoBadge>}
                    </div>
                    <input
                      id="rr-date"
                      type="date"
                      className="form-input mt-1.5"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                    />
                    {!parsed.examDateFromFile && (
                      <p className="text-[10.5px] text-ink-3 mt-1">
                        This file&rsquo;s name carries no date — showing the exam&rsquo;s current date.
                        Evalbee names its exports <code>Exam Name_YYYY-MM-DD.xlsx</code>.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="form-label !mb-0" htmlFor="rr-subject">Subject</label>
                    <select
                      id="rr-subject"
                      className="form-input mt-1.5"
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                    >
                      {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label !mb-0" htmlFor="rr-mark-correct">Marks — Correct</label>
                    <input
                      id="rr-mark-correct"
                      type="number" step="0.01"
                      className="form-input mt-1.5"
                      value={markCorrect}
                      onChange={e => setMarkCorrect(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="form-label !mb-0" htmlFor="rr-mark-wrong">Marks — Wrong</label>
                    <input
                      id="rr-mark-wrong"
                      type="number" step="0.01"
                      className="form-input mt-1.5"
                      value={markWrong}
                      onChange={e => setMarkWrong(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                {/* The scheme is read off the sheet's distinct mark values and
                    checked against the sum identity — never inferred and trusted. */}
                <p className={`text-[11px] mt-2 font-mono ${
                  assess.status === 'verified' ? 'text-success'
                  : assess.status === 'warn'   ? 'text-warning'
                  : 'text-danger font-bold'}`}>
                  {assess.status === 'verified' ? '✓ ' : '⚠ '}{assess.detail}
                </p>
                {assess.status !== 'verified' && parsed.totalsReconcile?.failed?.length > 0 && (
                  <ul className="text-[10.5px] text-ink-3 mt-1 font-mono list-disc pl-4">
                    {parsed.totalsReconcile.failed.map(f => (
                      <li key={f.name}>
                        {f.name} — sheet says {f.sheetTotal}, marks add to {f.sumOfMarks}
                      </li>
                    ))}
                  </ul>
                )}

                {/* ── Batches ── */}
                <div className="mt-4">
                  <label className="form-label" id="rr-batch-label">
                    Batches
                    <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-ink-3">
                      drives absence flagging — a batchless exam can never flag one
                    </span>
                  </label>
                  {visibleBatches.length > 0 ? (
                    <div
                      role="group"
                      aria-labelledby="rr-batch-label"
                      className="flex flex-wrap gap-2 p-2 border border-border rounded-lg bg-surface-2"
                    >
                      {visibleBatches.map(b => {
                        const checked  = selectedBatches.has(b)
                        const archived = isArchivedBatch(archivedBatches, b)
                        // Tagged on this exam but absent from Settings → Batches —
                        // usually a name predating the central namespace.
                        const offList  = !syllabusBatches.includes(b)
                        return (
                          <label
                            key={b}
                            title={
                              offList  ? 'Not in Settings → Batches — this exam was tagged with it before the central list existed'
                              : archived ? 'Archived batch — shown because this exam is already tagged with it'
                              : undefined}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-mono border cursor-pointer transition-colors min-h-[36px]
                              ${checked
                                ? 'bg-accent text-white border-accent'
                                : 'bg-surface text-ink-2 border-border hover:border-accent hover:text-accent'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBatch(b)}
                              aria-label={archived ? `${b} (archived)` : offList ? `${b} (not in the central list)` : undefined}
                              className="accent-current"
                            />
                            <span>{b}</span>
                            {(archived || offList) && (
                              <span aria-hidden="true" className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-50 text-amber-700">
                                {archived ? 'archived' : 'off-list'}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[12px] text-ink-3 italic px-3 py-2 border border-dashed border-border rounded-lg">
                      No central batches yet. Add one in Settings → Batches.
                    </div>
                  )}
                </div>

                {/* ── Branch ── */}
                <div className="mt-4">
                  <label className="form-label !mb-0" htmlFor="rr-branch">Branch</label>
                  {allBranches.length > 0 ? (
                    <select
                      id="rr-branch"
                      className="form-input mt-1.5"
                      value={branch}
                      onChange={e => setBranch(e.target.value)}
                    >
                      <option value="">— No branch assigned —</option>
                      {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input
                      id="rr-branch"
                      className="form-input mt-1.5"
                      value={branch}
                      onChange={e => setBranch(e.target.value)}
                      placeholder="e.g. LWS Pune"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── What will change ──────────────────────────────────────────── */}
          {changes.length > 0 && (
            <div data-testid="exam-changes" className="mb-4 border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2 border-b border-border
                              text-[10px] font-bold uppercase tracking-wide text-ink-3">
                Changes to this exam
              </div>
              <ul className="divide-y divide-border">
                {changes.map(c => (
                  <li key={c.label} className="px-4 py-2 flex items-center gap-3 text-[12px] font-mono">
                    <span className="w-[68px] text-ink-3 flex-shrink-0">{c.label}</span>
                    <span className="text-ink-3 line-through">{c.from}</span>
                    <span aria-hidden="true" className="text-ink-3">→</span>
                    <span className="text-ink font-bold">{c.to}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {needsMarkingAck && (
            <label className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-xl
                              bg-amber-50 border border-amber-300 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-amber-600"
                checked={markingAck}
                onChange={e => setMarkingAck(e.target.checked)}
              />
              <span className="text-[12px] text-amber-900">
                This exam already has {oldStudentCount} results. I understand that changing the
                marking changes <strong>every percentage</strong> quoted for it — the Dashboard,
                Toppers, the projected score, the monthly report PDF and the WhatsApp result
                message. Student marks themselves are Evalbee&rsquo;s and are not recalculated.
              </span>
            </label>
          )}

          {batchChanged && exam.batch && (
            <Alert type="warning">
              <span>⚠️</span>
              <span>
                Absence rows already filed under <strong>{exam.batch}</strong> are
                {' '}<strong>not removed</strong> by this change — only new ones are added for
                the batches selected above.
              </span>
            </Alert>
          )}

          {/* Diff preview */}
          {newStudents && (
            <div className="mb-4 border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2 border-b border-border
                              text-[10px] font-bold uppercase tracking-wide text-ink-3">
                Preview — what will change
              </div>
              <div className="grid grid-cols-2 divide-x divide-border">
                {/* Current */}
                <div className="px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                    Current
                  </div>
                  <div className="text-[28px] font-extrabold text-ink leading-none">
                    {oldStudentCount}
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1">students</div>
                </div>
                {/* New */}
                <div className="px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
                    New file
                  </div>
                  <div className={`text-[28px] font-extrabold leading-none
                    ${newStudents.length > oldStudentCount ? 'text-success'
                    : newStudents.length < oldStudentCount ? 'text-warning'
                    : 'text-ink'}`}>
                    {newStudents.length}
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1">students</div>
                </div>
              </div>
            </div>
          )}

          {/* Question count mismatch warning */}
          {questionCountChanged && (
            <Alert type="warning">
              <span>⚠️</span>
              <span>
                <strong>Question count mismatch:</strong> this exam has {oldQuestionCount} tagged
                questions but the new file has {newQuestionCount}. Tags for extra questions will
                default to the first chapter. Consider re-uploading tags after saving.
              </span>
            </Alert>
          )}

          {/* Answer-key cross-check — stored/bank key vs the results Excel */}
          <KeyMismatchPanel
            mismatches={keyMismatches}
            choices={keyChoices}
            onPick={(q, source) => setKeyChoices(prev => ({ ...prev, [q]: source }))}
            storedLabel={storedLabel}
          />

          {storedPicks.length > 0 && (
            <Alert type="warning">
              <span>⚠️</span>
              <span>
                {storedPicks.length === 1 ? 'Q' : 'Questions '}
                {storedPicks.map(m => m.q).join(', ')} will show the {storedLabel.toLowerCase()} key.
                Those questions were <strong>graded by Evalbee against its own key</strong>, and
                those marks are <strong>not corrected</strong> here — re-grading from the stored
                choices is a separate, unbuilt action.
              </span>
            </Alert>
          )}

          {hasAnswerKeys && keyMismatches.length === 0 && (
            <Alert type="info">
              <span>🔑</span>
              <span>
                <strong>Answer keys</strong> — {Object.keys(answerKeys).length} from this
                file&rsquo;s <code>Q N Key</code> columns agree with (or fill in) the stored
                answers. Nothing conflicts.
              </span>
            </Alert>
          )}

          {/* Absence sync */}
          {parsed && (
            <label className="mb-4 flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-accent"
                checked={syncAbsences}
                onChange={e => setSyncAbsences(e.target.checked)}
              />
              <span className="text-[12px] text-ink-2">
                <strong>Flag absentees</strong> — recompute which rostered students have no
                result here and enable the absence WhatsApp alert. Leave on unless you are only
                correcting marks.
              </span>
            </label>
          )}

          {error && (
            <Alert type="error"><span>⚠️</span><span>{error}</span></Alert>
          )}

          <div className="flex justify-end gap-3 mt-2">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleSave}
              disabled={loading || !canSave}
              className="btn btn-primary"
            >
              {loading ? <><Spinner size="sm" /> Reading…</> : '🔄 Replace Results'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(16px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function AutoBadge({ children }) {
  return (
    <span className="inline-block text-[9px] font-bold bg-green-50 text-success
                     border border-green-200 rounded-full px-2 py-0.5 font-mono">
      {children}
    </span>
  )
}
