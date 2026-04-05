import { useState, useRef } from 'react'
import { parseExcelFull, parseTagsFile } from '../../lib/excel'
import { validateTags, VALID_CHAPTERS } from '../../lib/validateTags'
import { detectBatch } from '../../lib/matchStudents'
import { Alert, Spinner } from '../ui'
import useStore from '../../store/useStore'

export default function Step1Upload({ onNext, onCancel }) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [xlsxFile, setXlsxFile]       = useState(null)
  const [tagsFile, setTagsFile]       = useState(null)
  const [xlsxDragging, setXlsxDragging] = useState(false)
  const [tagsDragging, setTagsDragging] = useState(false)

  // Validation state
  const [parsedTags, setParsedTags]   = useState(null)
  const [tagIssues, setTagIssues]     = useState([])  // [{q, chapter, suggestion, type}]
  const [fixedTags, setFixedTags]     = useState(null) // working copy with accepted fixes

  const xlsxRef = useRef()
  const tagsRef = useRef()

  function handleDrop(e, type) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (type === 'xlsx') setXlsxFile(file)
    else { setTagsFile(file); setParsedTags(null); setTagIssues([]); setFixedTags(null) }
    if (type === 'xlsx') setXlsxDragging(false)
    else setTagsDragging(false)
  }

  async function handleTagsChange(file) {
    setTagsFile(file)
    setParsedTags(null)
    setTagIssues([])
    setFixedTags(null)
    if (!file) return

    try {
      const tags = await parseTagsFile(file)
      const { valid, issues } = validateTags(tags)
      setParsedTags(tags)
      setFixedTags([...tags])
      setTagIssues(issues)
    } catch (e) {
      setError(`Tags file error: ${e.message}`)
    }
  }

  // Accept a suggestion — updates fixedTags in memory
  function acceptSuggestion(q, suggestion) {
    setFixedTags(prev => prev.map(t =>
      t.q === q ? { ...t, chapter: suggestion } : t
    ))
    setTagIssues(prev => prev.filter(i => i.q !== q))
  }

  // Accept all suggestions at once
  function acceptAll() {
    const updates = {}
    tagIssues.forEach(i => { if (i.suggestion) updates[i.q] = i.suggestion })
    setFixedTags(prev => prev.map(t =>
      updates[t.q] ? { ...t, chapter: updates[t.q] } : t
    ))
    setTagIssues(prev => prev.filter(i => !i.suggestion))
  }

  const allSuggestable  = tagIssues.length > 0 && tagIssues.every(i => i.suggestion)
  const hasBlockingIssues = tagIssues.length > 0

  async function handleNext() {
    if (!xlsxFile) { setError('Please upload the Results Excel file.'); return }
    if (hasBlockingIssues) { setError('Fix all chapter name issues before proceeding.'); return }
    setError(null)
    setLoading(true)

    try {
      const extracted = await parseExcelFull(xlsxFile)

      // Detect batch from student names + profiles
      const batchResult = detectBatch(extracted.students, studentProfiles)

      let tags = fixedTags || null
      let tagsSource = null
      if (tagsFile && tags) {
        tagsSource = `${tagsFile.name} — ${tags.length} questions tagged`
      }

      onNext({
        examName:    extracted.examName,
        examDate:    extracted.examDate,
        subject:     extracted.subject,
        markCorrect: extracted.markCorrect,
        markWrong:   extracted.markWrong,
        hasNegative: extracted.hasNegative,
        totalQs:     extracted.totalQs,
        students:    extracted.students,
        tags,
        tagsSource,
        // Batch detection
        detectedBatch:      batchResult.batch,
        batchConfidence:    batchResult.confidence,
        batchMatchedCount:  batchResult.matchedCount,
        batchTotalCount:    batchResult.totalCount,
        batchCounts:        batchResult.batchCounts,
      })
    } catch (e) {
      setError('Error reading Excel: ' + e.message)
    }
    setLoading(false)
  }

  return (
    <div>
      <Alert type="info">
        <span>ℹ️</span>
        <span>
          Upload your results Excel (required) and an enriched Tags XLSX (optional).
          Chapter names in the tags file must match the approved NDA chapter list exactly.
        </span>
      </Alert>

      <div className="grid grid-cols-2 gap-4 mt-4 mb-4">
        {/* Results Excel */}
        <div>
          <label className="form-label">Results Excel <span className="text-danger">*</span></label>
          <DropZone
            file={xlsxFile}
            dragging={xlsxDragging}
            accept=".xlsx,.xls"
            icon="📊"
            hint="Student responses file"
            inputRef={xlsxRef}
            onDragOver={e => { e.preventDefault(); setXlsxDragging(true) }}
            onDragLeave={() => setXlsxDragging(false)}
            onDrop={e => handleDrop(e, 'xlsx')}
            onChange={e => setXlsxFile(e.target.files[0])}
          />
        </div>

        {/* Tags XLSX */}
        <div>
          <label className="form-label">
            Tags File
            <span className="text-ink-3 font-normal normal-case tracking-normal ml-1">optional</span>
          </label>
          <DropZone
            file={tagsFile}
            dragging={tagsDragging}
            accept=".xlsx,.xls"
            icon="🏷️"
            hint="Q · Chapter · Subtopic · Question · Options · Answer · Solution"
            inputRef={tagsRef}
            onDragOver={e => { e.preventDefault(); setTagsDragging(true) }}
            onDragLeave={() => setTagsDragging(false)}
            onDrop={e => { handleDrop(e, 'tags'); handleTagsChange(e.dataTransfer.files[0]) }}
            onChange={e => handleTagsChange(e.target.files[0])}
          />
        </div>
      </div>

      {/* ── Validation issues — hard block ─────────────── */}
      {tagIssues.length > 0 && (
        <div className="mb-4 border border-red-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-200">
            <div className="flex items-center gap-2">
              <span className="text-danger font-bold text-[13px]">
                ❌ {tagIssues.length} chapter name issue{tagIssues.length > 1 ? 's' : ''} — fix to continue
              </span>
            </div>
            {allSuggestable && tagIssues.length > 1 && (
              <button
                onClick={acceptAll}
                className="text-[11px] font-bold text-accent bg-accent-soft border border-accent/25
                           px-3 py-1.5 rounded-lg hover:bg-accent hover:text-white transition-colors"
              >
                ✓ Accept All Suggestions
              </button>
            )}
          </div>

          {/* Issue rows */}
          <div className="divide-y divide-red-100">
            {tagIssues.map(issue => (
              <div key={issue.q} className="px-4 py-3 bg-white flex items-center gap-3 flex-wrap">
                <span className="font-mono font-bold text-[11px] text-ink-3 flex-shrink-0 w-8">
                  Q{issue.q}
                </span>

                {/* Wrong name */}
                <span className="text-[12px] font-semibold text-danger bg-red-50
                                 px-2 py-0.5 rounded border border-red-200">
                  {issue.chapter || '(empty)'}
                </span>

                {issue.suggestion ? (
                  <>
                    <span className="text-ink-3 text-[11px]">→ Did you mean:</span>
                    <span className="text-[12px] font-semibold text-success bg-green-50
                                     px-2 py-0.5 rounded border border-green-200">
                      {issue.suggestion}
                    </span>
                    <button
                      onClick={() => acceptSuggestion(issue.q, issue.suggestion)}
                      className="ml-auto text-[11px] font-bold text-accent bg-accent-soft
                                 border border-accent/25 px-3 py-1 rounded-lg
                                 hover:bg-accent hover:text-white transition-colors flex-shrink-0"
                    >
                      Accept
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-ink-3 italic ml-1">
                    No suggestion found — fix in Excel and re-upload
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2.5 bg-red-50 border-t border-red-100">
            <span className="text-[10.5px] text-danger/70">
              Valid chapters: {VALID_CHAPTERS.join(' · ')}
            </span>
          </div>
        </div>
      )}

      {/* Tags valid confirmation */}
      {tagsFile && parsedTags && !hasBlockingIssues && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-[12.5px] text-green-900">
          <span>✅</span>
          <span>All {parsedTags.length} chapter names validated — ready to proceed</span>
        </div>
      )}

      {error && (
        <Alert type="error">
          <span>⚠️</span><span>{error}</span>
        </Alert>
      )}

      <div className="flex justify-end gap-3 mt-2">
        <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
        <button
          onClick={handleNext}
          disabled={loading || !xlsxFile || hasBlockingIssues}
          className={`btn btn-primary ${hasBlockingIssues ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {loading ? <><Spinner size="sm" /> Reading files…</> : 'Extract Details →'}
        </button>
      </div>
    </div>
  )
}

function DropZone({ file, dragging, accept, icon, hint, inputRef, onDragOver, onDragLeave, onDrop, onChange }) {
  const hasFile = !!file
  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`
        border-2 rounded-xl p-5 text-center cursor-pointer transition-all duration-200
        ${hasFile
          ? 'border-success bg-green-50 border-solid'
          : dragging
          ? 'border-accent bg-accent-soft border-dashed'
          : 'border-border-2 bg-surface-2 border-dashed hover:border-accent hover:bg-accent-soft'
        }
      `}
    >
      <div className="text-2xl mb-1.5">{hasFile ? '✅' : icon}</div>
      <div className="text-[13px] font-medium text-ink-2 truncate px-2">
        {hasFile ? file.name : 'Click or drag file here'}
      </div>
      <div className="text-[11px] text-ink-3 mt-1">
        {hasFile ? `${(file.size / 1024).toFixed(1)} KB` : hint}
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onChange} />
    </div>
  )
}
