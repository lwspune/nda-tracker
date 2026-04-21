import { useState } from 'react'
import { Card } from '../../components/ui'
import { CONFIGURABLE_SUBJECTS, NDA_TOTAL_MARKS_BY_SUBJECT, deriveFreqFromExams, syncFreqChapters } from '../../lib/ndaFreq'

// Props: exams, ndaFreqBySubject, setNdaFreq, resetNdaFreq, ndaMarksBySubject, setSubjectTotalMarks
export default function FrequencyTableEditor({
  exams, ndaFreqBySubject, setNdaFreq, resetNdaFreq,
  ndaMarksBySubject, setSubjectTotalMarks,
}) {
  const [freqOpen, setFreqOpen]       = useState(false)
  const [freqSubject, setFreqSubject] = useState('Maths')
  const [localFreq, setLocalFreq]     = useState(null)
  const [syncResult, setSyncResult]   = useState(null)

  // Working freq rows for the currently selected subject — local edits before save
  const savedFreq   = ndaFreqBySubject?.[freqSubject] || []

  // When no saved freq exists, auto-derive chapters from uploaded exams for this subject.
  // Assigns equal weights as a starting point — faculty reviews and saves.
  const derivedFreq = savedFreq.length === 0
    ? deriveFreqFromExams(exams, freqSubject)
    : null

  const baseFreq    = savedFreq.length > 0 ? savedFreq : (derivedFreq || [])
  const workingFreq = localFreq || baseFreq

  // Total marks for this subject (from store, fallback to hard-coded default)
  const totalMarks = ndaMarksBySubject?.[freqSubject] ?? NDA_TOTAL_MARKS_BY_SUBJECT[freqSubject] ?? 300

  const isAutoDerived = savedFreq.length === 0 && (derivedFreq?.length ?? 0) > 0 && localFreq === null
  const freqTotal   = workingFreq.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
  const freqValid   = workingFreq.length === 0 || Math.abs(freqTotal - 100) < 0.15
  const hasUnsaved  = localFreq !== null || isAutoDerived

  function updateFreqRow(i, val) {
    const next = workingFreq.map((r, ri) =>
      ri === i ? { ...r, pct: parseFloat(val) || 0 } : r
    )
    setLocalFreq(next)
  }

  // Edit NDA Marks directly — back-computes pct from marks
  function updateFreqRowByMarks(i, marksVal) {
    const marks = parseFloat(marksVal) || 0
    const pct = totalMarks > 0 ? parseFloat(((marks / totalMarks) * 100).toFixed(2)) : 0
    const next = workingFreq.map((r, ri) =>
      ri === i ? { ...r, pct } : r
    )
    setLocalFreq(next)
  }

  function saveFreq() {
    if (!freqValid) return
    setNdaFreq(freqSubject, workingFreq)
    setLocalFreq(null)
    setSyncResult(null)
  }

  function handleReset() {
    if (!confirm(`Reset to default weights for ${freqSubject}?`)) return
    resetNdaFreq(freqSubject)
    setLocalFreq(null)
    setSyncResult(null)
  }

  function handleFreqSubjectChange(s) {
    setFreqSubject(s)
    setLocalFreq(null)
    setSyncResult(null)
  }

  function handleSyncChapters(e) {
    e.stopPropagation()
    const { rows, added, removed } = syncFreqChapters(workingFreq, exams, freqSubject)
    if (added.length === 0 && removed.length === 0) {
      setSyncResult({ added: [], removed: [], upToDate: true })
      return
    }
    setLocalFreq(rows)
    setSyncResult({ added, removed, upToDate: false })
  }

  function handleTotalMarksChange(val) {
    const marks = parseInt(val, 10)
    if (!isNaN(marks) && marks > 0 && setSubjectTotalMarks) {
      setSubjectTotalMarks(freqSubject, marks)
    }
  }

  return (
    <Card>
      {/* Collapsible header */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setFreqOpen(o => !o)}
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-ink-3">
            📊 Chapter Frequency Table
            {hasUnsaved && <span className="ml-2 text-warning font-bold">· Unsaved changes</span>}
          </div>
          <div className="text-[11px] text-ink-3 font-normal mt-1 normal-case tracking-normal">
            Weights used for projected NDA score per subject · click to edit
          </div>
        </div>
        <span
          className="text-[13px] text-ink-3 transition-transform duration-200 flex-shrink-0 ml-4"
          style={{ transform: freqOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >▶</span>
      </div>

      {/* Collapsible body */}
      {freqOpen && (
        <div className="mt-5">
          {/* Subject selector */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Subject</span>
            <div className="flex flex-wrap gap-1.5">
              {CONFIGURABLE_SUBJECTS.map(s => (
                <button
                  key={s}
                  onClick={e => { e.stopPropagation(); handleFreqSubjectChange(s) }}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition-colors
                    ${freqSubject === s
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-2 text-ink-2 border-border hover:border-accent hover:text-accent'
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Total marks input */}
          <div className="flex items-center gap-3 mb-4 px-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
              Total NDA Marks for {freqSubject}:
            </span>
            <input
              type="number"
              min="1" step="10"
              value={totalMarks}
              onChange={e => handleTotalMarksChange(e.target.value)}
              onClick={e => e.stopPropagation()}
              className="w-20 text-center text-[13px] font-mono font-bold border border-border
                         rounded-md px-2 py-1 outline-none bg-surface
                         focus:border-accent focus:bg-white transition-colors"
            />
            <span className="text-[11px] text-ink-3">
              (changes NDA Marks column; pct weights unchanged)
            </span>
          </div>

          {/* Column headers */}
          <div className="grid gap-2 px-2 mb-2"
               style={{ gridTemplateColumns: '1fr 70px 70px' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Chapter</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 text-center">Weight %</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 text-center">NDA Marks</div>
          </div>

          {/* Auto-derived banner */}
          {isAutoDerived && (
            <div className="flex items-start gap-2 px-3 py-2.5 mb-3 bg-indigo-50 border
                            border-indigo-200 rounded-xl text-[11.5px] text-indigo-800">
              <span className="flex-shrink-0 mt-0.5">✨</span>
              <span>
                Chapters auto-detected from uploaded <strong>{freqSubject}</strong> exams
                with equal weights. Adjust the percentages and click <strong>Save Weights</strong> to use them
                for projected score calculations.
              </span>
            </div>
          )}

          {/* Sync result banner */}
          {syncResult && (
            <div className={`flex items-start justify-between gap-2 px-3 py-2.5 mb-3 rounded-xl
                            text-[11.5px] border
                            ${syncResult.upToDate
                              ? 'bg-green-50 border-green-200 text-green-800'
                              : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 mt-0.5">{syncResult.upToDate ? '✅' : '🔄'}</span>
                {syncResult.upToDate ? (
                  <span>Chapter list is already up to date.</span>
                ) : (
                  <span>
                    {syncResult.added.length > 0 && (
                      <><strong>Added:</strong> {syncResult.added.join(', ')}. </>
                    )}
                    {syncResult.removed.length > 0 && (
                      <><strong>Removed:</strong> {syncResult.removed.join(', ')}. </>
                    )}
                    All chapters redistributed to equal weights — adjust and click <strong>Save Weights</strong>.
                  </span>
                )}
              </div>
              <button
                onClick={e => { e.stopPropagation(); setSyncResult(null) }}
                className="flex-shrink-0 text-[14px] leading-none opacity-50 hover:opacity-100"
              >×</button>
            </div>
          )}

          {/* Empty state — no exams for this subject either */}
          {workingFreq.length === 0 && (
            <div className="py-6 text-center text-[12px] text-ink-3 border border-dashed border-border rounded-xl mb-4">
              No chapter data for <strong>{freqSubject}</strong> yet.
              <br />Upload an exam with a tags file to auto-populate chapters here.
            </div>
          )}

          {/* Rows */}
          <div className="space-y-0.5 mb-4">
            {workingFreq.map((row, i) => {
              const rowMarks = totalMarks > 0
                ? parseFloat(((parseFloat(row.pct) || 0) / 100 * totalMarks).toFixed(1))
                : 0
              return (
                <div
                  key={row.chapter}
                  className={`grid gap-2 px-2 py-1.5 rounded-lg items-center
                              ${i % 2 === 0 ? 'bg-surface-2' : 'bg-surface'}`}
                  style={{ gridTemplateColumns: '1fr 70px 70px' }}
                >
                  <div className="text-[12px] font-medium text-ink">{row.chapter}</div>
                  <div className="text-center">
                    <input
                      type="number"
                      step="0.1" min="0" max="100"
                      value={row.pct}
                      onChange={e => updateFreqRow(i, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-16 text-center text-[12px] font-mono border border-border
                                 rounded-md px-2 py-1 outline-none bg-surface
                                 focus:border-accent focus:bg-white transition-colors"
                    />
                  </div>
                  <div className="text-center">
                    <input
                      type="number"
                      step="0.5" min="0"
                      value={rowMarks}
                      onChange={e => updateFreqRowByMarks(i, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-16 text-center text-[12px] font-mono border border-border
                                 rounded-md px-2 py-1 outline-none bg-surface
                                 focus:border-accent focus:bg-white transition-colors"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Total row */}
          <div className="grid gap-2 px-2 py-2 border-t border-border mb-4"
               style={{ gridTemplateColumns: '1fr 70px 70px' }}>
            <div className="text-[12px] font-bold text-ink">Total</div>
            <div className="text-center">
              <span className={`text-[13px] font-extrabold font-mono
                ${freqValid ? 'text-success' : 'text-danger'}`}>
                {freqTotal.toFixed(1)}%
              </span>
              {!freqValid && (
                <div className="text-[10px] text-danger mt-0.5">Must equal 100%</div>
              )}
            </div>
            <div className="text-center text-[12px] font-mono font-bold text-ink">
              {(freqTotal / 100 * totalMarks).toFixed(1)}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={saveFreq}
              disabled={!freqValid || !hasUnsaved}
              className={`btn btn-primary btn-sm
                ${(!freqValid || !hasUnsaved) ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              💾 Save Weights
            </button>
            <button
              onClick={handleSyncChapters}
              className="btn btn-secondary btn-sm"
            >
              🔄 Sync Chapters
            </button>
            <button
              onClick={handleReset}
              className="btn btn-secondary btn-sm"
            >
              ↺ Reset to Defaults
            </button>
            {!freqValid && (
              <span className="text-[11px] text-danger font-semibold">
                ⚠️ Total must equal 100% before saving
              </span>
            )}
            {freqValid && hasUnsaved && (
              <span className="text-[11px] text-warning font-semibold">
                {isAutoDerived
                  ? '✨ Auto-derived — review weights and save'
                  : 'Unsaved — click Save Weights to apply'}
              </span>
            )}
            {freqValid && !hasUnsaved && (
              <span className="text-[11px] text-success">
                ✅ Saved — projected scores are up to date
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
