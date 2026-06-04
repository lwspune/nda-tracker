import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { parseFeedbackExcel } from '../../lib/excel'
import { detectBlockStarts, reshapeFeedbackMatrix } from '../../lib/teacherFeedback'

// Superadmin-only. Upload a Google Form responses export (XLSX/CSV), map each
// repeated question block → a teacher (the names live in the form's section
// titles, not the sheet), then import the reshaped per-(response, teacher) rows.
export default function ImportFeedbackModal({ onClose, onImported }) {
  const timetableTeachers   = useStore(s => s.timetableTeachers)
  const branches            = useStore(s => s.branches)
  const importTeacherFeedback = useStore(s => s.importTeacherFeedback)

  const [matrix, setMatrix]   = useState(null)
  const [fileName, setFileName] = useState('')
  const [names, setNames]     = useState([])      // block index → teacher name
  const [cycle, setCycle]     = useState('')
  const [branch, setBranch]   = useState('')
  const [parseError, setParseError] = useState('')
  const [busy, setBusy]       = useState(false)
  const [result, setResult]   = useState(null)

  const teacherOptions = useMemo(
    () => [...new Set((timetableTeachers || []).map(t => t.name).filter(Boolean))].sort(),
    [timetableTeachers]
  )

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(''); setResult(null)
    try {
      const m = await parseFeedbackExcel(file)
      const starts = detectBlockStarts(m[0])
      if (starts.length === 0) {
        setParseError('No teacher blocks found — the header should contain "Clarity:" columns.')
        setMatrix(null); return
      }
      setMatrix(m)
      setFileName(file.name)
      setNames(Array(starts.length).fill(''))
    } catch (err) {
      setParseError(`Could not read file: ${err.message}`)
      setMatrix(null)
    }
  }

  const preview = useMemo(() => {
    if (!matrix) return []
    return reshapeFeedbackMatrix(matrix, names, { cycle: cycle.trim(), branch: branch.trim() || null })
  }, [matrix, names, cycle, branch])

  const mappedTeachers = useMemo(() => [...new Set(preview.map(r => r.teacher_name))], [preview])
  const canImport = matrix && cycle.trim() && preview.length > 0 && !busy

  async function handleImport() {
    setBusy(true)
    const res = await importTeacherFeedback(preview)
    setBusy(false)
    if (res.ok) { onImported?.(res.inserted) }
    else setResult(res)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl flex flex-col overflow-hidden w-full"
        style={{ maxWidth: '600px', maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="text-[15px] font-bold text-ink">Import Teacher Feedback</div>
          <button onClick={onClose} disabled={busy} className="text-ink-3 hover:text-ink text-[20px] leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* File */}
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-ink-3 block mb-1">
              Google Form responses (XLSX or CSV)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              className="text-[12px] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-[12px] file:bg-accent-soft file:text-accent"
            />
            {fileName && <div className="text-[11px] text-ink-3 mt-1 font-mono">{fileName}</div>}
            {parseError && <div className="text-[12px] text-red-500 mt-1">{parseError}</div>}
          </div>

          {matrix && (
            <>
              {/* Cycle + branch */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Cycle label *</span>
                  <input
                    value={cycle}
                    onChange={e => setCycle(e.target.value)}
                    placeholder="e.g. 04 LWS Pune"
                    className="form-input text-[13px] min-h-[40px] px-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Branch</span>
                  <input
                    list="feedback-branches"
                    value={branch}
                    onChange={e => setBranch(e.target.value)}
                    placeholder="e.g. LWS Pune"
                    className="form-input text-[13px] min-h-[40px] px-2"
                  />
                  <datalist id="feedback-branches">
                    {(branches || []).map(b => <option key={b} value={b} />)}
                  </datalist>
                </label>
              </div>

              {/* Block → teacher mapping */}
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">
                  Map each question block to a teacher ({names.length} found)
                </div>
                <div className="space-y-2">
                  {names.map((n, i) => (
                    <label key={i} className="flex items-center gap-2">
                      <span className="text-[12px] text-ink-2 w-16 shrink-0">Block {i + 1}</span>
                      <input
                        list="feedback-teachers"
                        value={n}
                        onChange={e => setNames(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                        placeholder="Teacher name (blank = skip)"
                        className="form-input text-[13px] min-h-[40px] px-2 flex-1"
                      />
                    </label>
                  ))}
                  <datalist id="feedback-teachers">
                    {teacherOptions.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
              </div>

              {/* Preview */}
              <div className="text-[12px] text-ink-2">
                Preview: <span className="font-semibold">{preview.length}</span> teacher-responses across{' '}
                <span className="font-semibold">{mappedTeachers.length}</span> teacher{mappedTeachers.length !== 1 ? 's' : ''}
                {mappedTeachers.length > 0 && (
                  <span className="text-ink-3"> — {mappedTeachers.join(', ')}</span>
                )}
              </div>

              {result && !result.ok && (
                <div className="text-[12px] text-red-500">Import failed: {result.reason}</div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
          <button type="button" onClick={onClose} disabled={busy} className="btn text-[13px] min-h-[44px] px-4">Cancel</button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!canImport}
            className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Importing…' : `Import ${preview.length || ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
