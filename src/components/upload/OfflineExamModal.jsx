import { useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import useStore from '../../store/useStore'
import { parseOfflineResults, buildOfflineTemplateRows } from '../../lib/excel'
import { buildOfflineRoster, buildOfflineStudentRows, parseMarksPaste } from '../../lib/offlineRoster'
import { getExamBatches } from '../../lib/analytics'
import { SUBJECTS } from '../../lib/ndaFreq'
import { Alert, Spinner, DropZone } from '../ui'

// Add an exam conducted OFFLINE (hand-graded paper) where only a TOTAL mark per
// student is available — no per-question data. Stored as a normal exam with
// questions: [] and an explicit maxMarks (the paper ceiling), so it still feeds
// %-of-max trends / Toppers while per-question analytics show an offline notice.
//
// Two ways in, and the grid is the default: pick the batches and type the marks
// straight into the roster the app already holds. The file upload stays for bulk
// or legacy sheets. Both converge on the same student-row shape.
//
// Passing `exam` opens the same grid on an existing exam, pre-filled. That is
// also the ONLY correction path a written exam has: the re-upload modals both
// need per-question data (an Evalbee sheet / a tags file merged over
// exam.questions), which a hand-graded paper does not have. Before this, fixing
// one typo'd mark meant deleting the exam and re-entering the whole class.
export default function OfflineExamModal({ exam = null, onClose }) {
  const addExam          = useStore(s => s.addExam)
  const exams            = useStore(s => s.exams)
  const replaceExam      = useStore(s => s.replaceExam)
  const studentProfiles  = useStore(s => s.studentProfiles)
  const syllabusBatches  = useStore(s => s.syllabusBatches) || []

  const today = new Date().toISOString().split('T')[0]
  const [source, setSource]     = useState('manual')   // 'manual' | 'file'
  const [file, setFile]         = useState(null)
  const [dragging, setDragging] = useState(false)
  const [fileStudents, setFileStudents] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const [marks, setMarks]           = useState({})     // { [canonical name]: string }
  const [pasteOpen, setPasteOpen]   = useState(false)
  const [pasteText, setPasteText]   = useState('')

  const [name, setName]         = useState('')
  const [date, setDate]         = useState(today)
  const [subject, setSubject]   = useState('Maths')
  const [maxMarks, setMaxMarks] = useState('')
  const [batch, setBatch]       = useState('')
  const [branch, setBranch]     = useState('')
  const [notifyAbsentees, setNotifyAbsentees] = useState(false)

  const fileRef = useRef()

  // Seed the fields from the exam being edited. Keyed on the exam id and done in
  // render rather than an effect so a re-render can't clobber what's being typed.
  const [seeded, setSeeded] = useState(null)
  if (exam?.id && seeded !== exam.id) {
    setSeeded(exam.id)
    setName(exam.name ?? '')
    setDate(exam.date ?? today)
    setSubject(exam.subject || 'Maths')
    setMaxMarks(exam.maxMarks != null ? String(exam.maxMarks) : '')
    setBatch(exam.batch || '')
    setBranch(exam.branch || '')
    setSource('manual')
    // A stored result is a mark that was entered; anyone absent has no row, so
    // they seed blank — which is exactly what a blank means on this grid.
    setMarks(Object.fromEntries(
      (exam.students ?? [])
        .filter(s => s?.name != null && s?.totalMarks != null)
        .map(s => [s.name, String(s.totalMarks)])
    ))
  }

  const allBranches = [...new Set(
    Object.values(studentProfiles).map(p => p.branch).filter(Boolean)
  )].sort()
  const selectedBatches = new Set(getExamBatches({ batch }))

  // Current members of the selected batches — the grid's rows.
  //
  // When editing, anyone who already has a result but is no longer in those
  // batches is appended: batch membership is current, the exam is historical, so
  // deriving rows from the batch alone would drop a student who has since moved
  // and saving would then erase their mark.
  const roster = useMemo(() => {
    const current = buildOfflineRoster(studentProfiles, getExamBatches({ batch }))
    if (!exam) return current
    const present = new Set(current.map(r => r.name))
    const departed = (exam.students ?? [])
      .filter(s => s?.name && !present.has(s.name))
      .map(s => ({ lwsId: '', name: s.name }))
    return [...current, ...departed]
  }, [studentProfiles, batch, exam])
  const manualStudents = useMemo(() => buildOfflineStudentRows(roster, marks), [roster, marks])

  const students = source === 'manual' ? manualStudents : fileStudents

  async function handleFile(f) {
    setFile(f); setFileStudents(null); setError(null)
    if (!f) return
    setLoading(true)
    try {
      const { students: parsed } = await parseOfflineResults(f)
      if (!parsed.length) { setError('No student rows with marks found in the file.'); setLoading(false); return }
      setFileStudents(parsed)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  // Pre-fills the Name column from the selected batches so only marks are typed.
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet(buildOfflineTemplateRows(roster.map(r => r.name)))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Marks')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'offline-marks-template.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleBatch(b) {
    const next = new Set(selectedBatches)
    next.has(b) ? next.delete(b) : next.add(b)
    setBatch(syllabusBatches.filter(x => next.has(x)).join(', '))
  }

  // Fills the grid top-down in roster order. Rows beyond the pasted column are
  // left untouched (a short paste tops up, it doesn't wipe what's already typed).
  function applyPaste() {
    const values = parseMarksPaste(pasteText)
    setMarks(prev => {
      const next = { ...prev }
      roster.forEach((r, i) => {
        if (i >= values.length) return
        next[r.name] = values[i] === null ? '' : String(values[i])
      })
      return next
    })
    setPasteText('')
    setPasteOpen(false)
  }

  const maxNum = parseFloat(maxMarks)
  const overMax = students && Number.isFinite(maxNum) && maxNum > 0
    ? students.filter(s => s.totalMarks > maxNum)
    : []
  const canSave = !!students?.length && name.trim() && Number.isFinite(maxNum) && maxNum > 0 && !overMax.length

  function buildExam(id) {
    return {
      // Spread first so fields this modal doesn't edit survive a round-trip —
      // notably `source` and `createdBy`, which carry the Written Quiz badge and
      // the "by <teacher>" attribution on the Exams page.
      ...(exam ?? {}),
      id,
      name: name.trim(),
      date,
      subject: subject || 'Maths',
      batch: batch || null,
      branch: branch || null,
      marking: { correct: 1, wrong: 0 },  // inert for offline — maxMarks drives %-of-max
      questions: [],                      // this grid only ever produces totals
      maxMarks: maxNum,
      students,
      createdAt: exam?.createdAt ?? new Date().toISOString(),
    }
  }

  // Editing never counts as a duplicate of itself.
  const duplicate = exams.find(e =>
    e.id !== exam?.id &&
    e.name?.trim().toLowerCase() === name.trim().toLowerCase() && e.date === date
  )

  function handleSave() {
    if (!canSave) return
    const target = exam ?? duplicate
    if (target) {
      replaceExam(target.id, buildExam(target.id), { syncAbsences: notifyAbsentees })
    } else {
      addExam(buildExam('exam_' + Date.now()), { syncAbsences: notifyAbsentees })
    }
    onClose()
  }

  const tabClass = (key) => `px-3.5 py-2 text-[12.5px] font-semibold rounded-lg border transition-colors
    ${source === key ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-2 border-border hover:border-accent hover:text-accent'}`

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-2xl shadow-lg w-[560px] max-w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-7 pt-6 pb-1">
          <h2 className="text-[18px] font-extrabold tracking-tight">
            {exam ? 'Edit marks' : 'Add Offline Exam'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink text-[20px] leading-none">×</button>
        </div>
        <p className="px-7 text-[12px] text-ink-3 mb-4">
          {exam
            ? `Correct the marks for ${exam.name}. Saving replaces this exam's results — students left blank are recorded as not having appeared.`
            : "Record a hand-graded paper — total marks only. Per-question analytics (chapters, audits) aren't available for offline exams."}
        </p>

        <div className="px-7 pb-7 flex flex-col gap-4">
          {/* Exam meta */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label" htmlFor="off-name">Exam Name <span className="text-danger">*</span></label>
              <input id="off-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Algebra Class Test" />
            </div>
            <div>
              <label className="form-label" htmlFor="off-date">Date</label>
              <input id="off-date" type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label" htmlFor="off-subject">Subject</label>
              <select id="off-subject" className="form-input" value={subject} onChange={e => setSubject(e.target.value)}>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="off-max">Max Marks <span className="text-danger">*</span></label>
              <input id="off-max" type="number" min="1" step="0.5" className="form-input" value={maxMarks}
                     onChange={e => setMaxMarks(e.target.value)} placeholder="e.g. 100" />
            </div>
          </div>

          {/* Batches — also the source of the marks grid's roster */}
          <div>
            <label className="form-label" id="off-batch-label">Batches</label>
            {syllabusBatches.length ? (
              <div role="group" aria-labelledby="off-batch-label" className="flex flex-wrap gap-2 p-2 border border-border rounded-lg bg-surface-2">
                {syllabusBatches.map(b => {
                  const checked = selectedBatches.has(b)
                  return (
                    <label key={b} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-mono border cursor-pointer min-h-[36px]
                      ${checked ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-2 border-border hover:border-accent hover:text-accent'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleBatch(b)} className="accent-current" />
                      <span>{b}</span>
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

          {/* Branch */}
          <div>
            <label className="form-label" htmlFor="off-branch">Branch</label>
            {allBranches.length ? (
              <select id="off-branch" className="form-input" value={branch} onChange={e => setBranch(e.target.value)}>
                <option value="">— No branch assigned —</option>
                {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            ) : (
              <input id="off-branch" className="form-input" value={branch} onChange={e => setBranch(e.target.value)} placeholder="e.g. LWS Pune" />
            )}
          </div>

          {/* Marks source */}
          <div>
            <label className="form-label">Marks <span className="text-danger">*</span></label>
            <div role="tablist" aria-label="Marks source" className="flex gap-2 mb-3">
              <button role="tab" aria-selected={source === 'manual'} onClick={() => setSource('manual')} className={tabClass('manual')}>
                ⌨ Enter marks
              </button>
              <button role="tab" aria-selected={source === 'file'} onClick={() => setSource('file')} className={tabClass('file')}>
                📄 Upload file
              </button>
            </div>

            {source === 'manual' ? (
              roster.length ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-border">
                    <span className="text-[11.5px] text-ink-2 font-semibold">
                      {manualStudents.length} of {roster.length} entered
                    </span>
                    <button onClick={() => setPasteOpen(o => !o)} className="text-[11px] text-accent hover:underline font-semibold">
                      📋 Paste a column
                    </button>
                  </div>

                  {pasteOpen && (
                    <div className="px-3 py-2.5 border-b border-border bg-surface-2 flex flex-col gap-2">
                      <label className="text-[11.5px] text-ink-2" htmlFor="off-paste">
                        Paste marks — one per line, in the order listed below. Blank line = didn't appear.
                      </label>
                      <textarea id="off-paste" rows={4} value={pasteText} onChange={e => setPasteText(e.target.value)}
                                className="form-input font-mono text-[12px]" placeholder={'72\n55\n40'} />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setPasteOpen(false); setPasteText('') }} className="btn btn-secondary text-[12px] py-1.5">Cancel</button>
                        <button onClick={applyPaste} className="btn btn-primary text-[12px] py-1.5">Apply</button>
                      </div>
                    </div>
                  )}

                  <div className="max-h-[260px] overflow-y-auto">
                    <table aria-label="Marks" className="w-full text-[12.5px]">
                      <tbody>
                        {roster.map(r => (
                          <tr key={r.lwsId || r.name} className="border-b border-border last:border-0">
                            <td className="px-3 py-1.5 text-ink-2">{r.name}</td>
                            <td className="px-3 py-1.5 w-[110px]">
                              <input
                                type="number" min="0" step="0.5"
                                aria-label={`Marks for ${r.name}`}
                                className="form-input py-1 text-[12.5px]"
                                value={marks[r.name] ?? ''}
                                onChange={e => setMarks(m => ({ ...m, [r.name]: e.target.value }))}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-3 py-2 bg-surface-2 border-t border-border text-[11px] text-ink-3">
                    Leave a student blank if they didn't appear.
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-ink-3 italic px-3 py-2 border border-dashed border-border rounded-lg">
                  Select a batch above to load its students.
                </div>
              )
            ) : (
              <>
                <div className="flex justify-end mb-1.5">
                  <button onClick={downloadTemplate} className="text-[11px] text-accent hover:underline font-semibold">
                    ↓ Download template{roster.length ? ' (roster pre-filled)' : ''}
                  </button>
                </div>
                <DropZone
                  file={file}
                  dragging={dragging}
                  accept=".xlsx,.xls"
                  icon="📄"
                  hint="Columns: Name · Marks (Roll No optional)"
                  inputRef={fileRef}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0] || null) }}
                  onChange={e => handleFile(e.target.files[0])}
                />
                {loading && <div className="mt-2 text-[12px] text-ink-3 flex items-center gap-2"><Spinner size="sm" /> Reading file…</div>}
                {fileStudents && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-[12.5px] text-green-900">
                    <span>✅</span><span><strong>{fileStudents.length}</strong> students parsed</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Absentee opt-in */}
          <label className="flex items-start gap-2.5 px-3 py-2.5 border border-border rounded-lg bg-surface-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-accent" checked={notifyAbsentees} onChange={e => setNotifyAbsentees(e.target.checked)} />
            <span className="text-[12px] text-ink-2">
              <strong>Flag absentees</strong> — mark rostered students with no marks as absent and enable the
              absence WhatsApp alert. Off by default for offline exams.
            </span>
          </label>

          {overMax.length > 0 && (
            <Alert type="error">
              <span>⚠️</span>
              <span>{overMax.length} student{overMax.length > 1 ? 's have' : ' has'} marks above the max ({maxNum}) — e.g. {overMax[0].name} ({overMax[0].totalMarks}). Fix the marks or raise Max Marks.</span>
            </Alert>
          )}

          {duplicate && (
            <Alert type="warning">
              <span>⚠️</span>
              <span>An exam named "{duplicate.name}" on {duplicate.date} already exists — saving will <strong>replace</strong> it.</span>
            </Alert>
          )}

          {error && <Alert type="error"><span>⚠️</span><span>{error}</span></Alert>}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={!canSave}
                    className={`btn btn-primary ${!canSave ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {exam ? '💾 Save changes' : duplicate ? '🔄 Replace Exam' : '💾 Save Exam'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
