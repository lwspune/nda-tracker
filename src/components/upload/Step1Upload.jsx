import { useState, useRef } from 'react'
import { parseExcelFull, parseTagsFile } from '../../lib/excel'
import { validateTags, validateGatSubjects } from '../../lib/validateTags'
import { detectBatch } from '../../lib/matchStudents'
import { Alert, Spinner, DropZone } from '../ui'
import ValidationIssuesPanel from './ValidationIssuesPanel'
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
  const [parsedTags, setParsedTags]           = useState(null)
  const [tagIssues, setTagIssues]             = useState([])
  const [fixedTags, setFixedTags]             = useState(null)
  const [tagsSubject, setTagsSubject]         = useState('Maths')
  const [detectedSubjectFromTags, setDetectedSubjectFromTags] = useState(null)

  const xlsxRef = useRef()
  const tagsRef = useRef()

  function handleDrop(e, type) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (type === 'xlsx') { setXlsxFile(file); setXlsxDragging(false) }
    // tags drop is handled entirely by handleTagsChange — do not set state here
    else setTagsDragging(false)
  }

  async function handleTagsChange(file) {
    setTagsFile(file)
    setParsedTags(null)
    setTagIssues([])
    setFixedTags(null)
    setDetectedSubjectFromTags(null)
    if (!file) return

    try {
      const tags = await parseTagsFile(file)

      // Detect primary subject from the tags file's Subject column (if present).
      // Returns 'GAT' when multiple distinct subjects are found (combined exam).
      const detected = detectSubjectFromTags(tags)
      setDetectedSubjectFromTags(detected)

      // For GAT exams: every question must have a Subject value — block if any missing
      if (detected === 'GAT') {
        const { valid, missingQs } = validateGatSubjects(tags)
        if (!valid) {
          const sample = missingQs.slice(0, 3).map(q => `Q${q}`).join(', ')
          const extra = missingQs.length > 3 ? ` (+${missingQs.length - 3} more)` : ''
          setError(`GAT exams require a Subject for every question. Missing: ${sample}${extra}.`)
          return
        }
      }

      // Validate: per-tag subject takes priority (via validateTags internals),
      // fall back to detected subject or Maths. Non-Maths subjects with no freq
      // data skip validation automatically.
      const fallback = detected === 'GAT' ? 'GAT' : (detected || 'Maths')
      const { issues } = validateTags(tags, fallback)
      setParsedTags(tags)
      setFixedTags([...tags])
      setTagIssues(issues)
      setTagsSubject(fallback)
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

      // Resolve final subject:
      // - tags-file detection is most reliable (explicit data)
      // - GAT exam names contain "GAT" but filename-stripping leaves artifacts like "GAT  1"
      //   so we normalise those to plain 'GAT'
      const looksLikeGAT = /\bgat\b/i.test(extracted.examName)
      const finalSubject = detectedSubjectFromTags ||
        (looksLikeGAT ? 'GAT' : extracted.subject) ||
        'Maths'

      // For GAT exams: if tags exist they must have a Subject column
      let tags = fixedTags || null
      if (finalSubject === 'GAT' && tags) {
        const hasSubjectColumn = tags.some(t => t.subject !== null)
        if (!hasSubjectColumn) {
          setError('GAT exams require a Subject column in the tags file so each question is routed to its subject.')
          setLoading(false)
          return
        }
      }

      // Re-validate with the resolved subject (handles edge case where tags were
      // initially validated against a different subject before Excel was parsed).
      if (tags) {
        const { issues } = validateTags(tags, finalSubject)
        setTagIssues(issues)
        setTagsSubject(finalSubject)
        if (issues.length > 0) {
          setLoading(false)
          return // block — user must fix remaining issues
        }
      }

      let tagsSource = null
      if (tagsFile && tags) {
        tagsSource = `${tagsFile.name} — ${tags.length} questions tagged`
      }

      onNext({
        examName:    extracted.examName,
        examDate:    extracted.examDate,
        subject:     finalSubject,
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
            hint="Q · Chapter · Subtopic · Question · Options · Answer · Solution · Subject (required for GAT)"
            inputRef={tagsRef}
            onDragOver={e => { e.preventDefault(); setTagsDragging(true) }}
            onDragLeave={() => setTagsDragging(false)}
            onDrop={e => { handleDrop(e, 'tags'); handleTagsChange(e.dataTransfer.files[0] || null) }}
            onChange={e => handleTagsChange(e.target.files[0])}
          />
        </div>
      </div>

      {/* Validation issues — hard block */}
      {tagIssues.length > 0 && (
        <ValidationIssuesPanel
          tagIssues={tagIssues}
          tagsSubject={tagsSubject}
          onAccept={acceptSuggestion}
          onAcceptAll={acceptAll}
        />
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

// Returns the subject from tags' Subject column:
// - null when no Subject column present
// - 'GAT' when multiple distinct subjects found (combined exam)
// - single subject name when all tags share one subject
function detectSubjectFromTags(tags) {
  const counts = {}
  tags.forEach(t => { if (t.subject) counts[t.subject] = (counts[t.subject] || 0) + 1 })
  const entries = Object.entries(counts)
  if (!entries.length) return null
  if (entries.length > 1) return 'GAT'
  return entries[0][0]
}
