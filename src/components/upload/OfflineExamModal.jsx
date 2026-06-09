import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import useStore from '../../store/useStore'
import { parseOfflineResults, buildOfflineTemplateRows } from '../../lib/excel'
import { getExamBatches } from '../../lib/analytics'
import { SUBJECTS } from '../../lib/ndaFreq'
import { Alert, Spinner, DropZone } from '../ui'

// Add an exam conducted OFFLINE (hand-graded paper) where only a TOTAL mark per
// student is available — no per-question data. Stored as a normal exam with
// questions: [] and an explicit maxMarks (the paper ceiling), so it still feeds
// %-of-max trends / Toppers while per-question analytics show an offline notice.
export default function OfflineExamModal({ onClose }) {
  const addExam          = useStore(s => s.addExam)
  const exams            = useStore(s => s.exams)
  const replaceExam      = useStore(s => s.replaceExam)
  const studentProfiles  = useStore(s => s.studentProfiles)
  const syllabusBatches  = useStore(s => s.syllabusBatches) || []

  const today = new Date().toISOString().split('T')[0]
  const [file, setFile]         = useState(null)
  const [dragging, setDragging] = useState(false)
  const [students, setStudents] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const [name, setName]         = useState('')
  const [date, setDate]         = useState(today)
  const [subject, setSubject]   = useState('Maths')
  const [maxMarks, setMaxMarks] = useState('')
  const [batch, setBatch]       = useState('')
  const [branch, setBranch]     = useState('')
  const [notifyAbsentees, setNotifyAbsentees] = useState(false)

  const fileRef = useRef()

  const allBranches = [...new Set(
    Object.values(studentProfiles).map(p => p.branch).filter(Boolean)
  )].sort()
  const selectedBatches = new Set(getExamBatches({ batch }))

  async function handleFile(f) {
    setFile(f); setStudents(null); setError(null)
    if (!f) return
    setLoading(true)
    try {
      const { students: parsed } = await parseOfflineResults(f)
      if (!parsed.length) { setError('No student rows with marks found in the file.'); setLoading(false); return }
      setStudents(parsed)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet(buildOfflineTemplateRows())
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

  const maxNum = parseFloat(maxMarks)
  const overMax = students && Number.isFinite(maxNum) && maxNum > 0
    ? students.filter(s => s.totalMarks > maxNum)
    : []
  const canSave = !!students?.length && name.trim() && Number.isFinite(maxNum) && maxNum > 0 && !overMax.length

  function buildExam(id) {
    return {
      id,
      name: name.trim(),
      date,
      subject: subject || 'Maths',
      batch: batch || null,
      branch: branch || null,
      marking: { correct: 1, wrong: 0 },  // inert for offline — maxMarks drives %-of-max
      questions: [],
      maxMarks: maxNum,
      students,
      createdAt: new Date().toISOString(),
    }
  }

  const duplicate = exams.find(e =>
    e.name?.trim().toLowerCase() === name.trim().toLowerCase() && e.date === date
  )

  function handleSave() {
    if (!canSave) return
    if (duplicate) {
      replaceExam(duplicate.id, buildExam(duplicate.id), { syncAbsences: notifyAbsentees })
    } else {
      addExam(buildExam('exam_' + Date.now()), { syncAbsences: notifyAbsentees })
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-2xl shadow-lg w-[560px] max-w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-7 pt-6 pb-1">
          <h2 className="text-[18px] font-extrabold tracking-tight">Add Offline Exam</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-[20px] leading-none">×</button>
        </div>
        <p className="px-7 text-[12px] text-ink-3 mb-4">
          Record a hand-graded paper — total marks only. Per-question analytics (chapters, audits)
          aren't available for offline exams.
        </p>

        <div className="px-7 pb-7 flex flex-col gap-4">
          {/* Upload + template */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="form-label mb-0">Marks file <span className="text-danger">*</span></label>
              <button onClick={downloadTemplate} className="text-[11px] text-accent hover:underline font-semibold">
                ↓ Download template
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
            {students && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-[12.5px] text-green-900">
                <span>✅</span><span><strong>{students.length}</strong> students parsed</span>
              </div>
            )}
          </div>

          {students && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Exam Name <span className="text-danger">*</span></label>
                  <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Algebra Class Test" />
                </div>
                <div>
                  <label className="form-label">Date</label>
                  <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Subject</label>
                  <select className="form-input" value={subject} onChange={e => setSubject(e.target.value)}>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Max Marks <span className="text-danger">*</span></label>
                  <input type="number" min="1" step="0.5" className="form-input" value={maxMarks}
                         onChange={e => setMaxMarks(e.target.value)} placeholder="e.g. 100" />
                </div>
              </div>

              {/* Batches */}
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
                <label className="form-label">Branch</label>
                {allBranches.length ? (
                  <select className="form-input" value={branch} onChange={e => setBranch(e.target.value)}>
                    <option value="">— No branch assigned —</option>
                    {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : (
                  <input className="form-input" value={branch} onChange={e => setBranch(e.target.value)} placeholder="e.g. LWS Pune" />
                )}
              </div>

              {/* Absentee opt-in */}
              <label className="flex items-start gap-2.5 px-3 py-2.5 border border-border rounded-lg bg-surface-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-accent" checked={notifyAbsentees} onChange={e => setNotifyAbsentees(e.target.checked)} />
                <span className="text-[12px] text-ink-2">
                  <strong>Flag absentees</strong> — mark rostered students not in this file as absent and enable the
                  absence WhatsApp alert. Off by default for offline exams.
                </span>
              </label>

              {overMax.length > 0 && (
                <Alert type="error">
                  <span>⚠️</span>
                  <span>{overMax.length} student{overMax.length > 1 ? 's have' : ' has'} marks above the max ({maxNum}) — e.g. {overMax[0].name} ({overMax[0].totalMarks}). Fix the file or raise Max Marks.</span>
                </Alert>
              )}

              {duplicate && (
                <Alert type="warning">
                  <span>⚠️</span>
                  <span>An exam named "{duplicate.name}" on {duplicate.date} already exists — saving will <strong>replace</strong> it.</span>
                </Alert>
              )}
            </>
          )}

          {error && <Alert type="error"><span>⚠️</span><span>{error}</span></Alert>}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={!canSave}
                    className={`btn btn-primary ${!canSave ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {duplicate ? '🔄 Replace Exam' : '💾 Save Exam'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
