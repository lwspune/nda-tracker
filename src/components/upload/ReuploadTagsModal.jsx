import { useState, useRef } from 'react'
import { parseTagsFile } from '../../lib/excel'
import { validateTags, getValidChapters } from '../../lib/validateTags'
import { Alert, DropZone, Spinner } from '../ui'
import ValidationIssuesPanel from './ValidationIssuesPanel'
import useStore from '../../store/useStore'

export default function ReuploadTagsModal({ exam, onClose }) {
  const replaceExam = useStore(s => s.replaceExam)

  // ── Step 1 state ─────────────────────────────────────────────
  const [step, setStep]             = useState(1)
  const [tagsFile, setTagsFile]     = useState(null)
  const [dragging, setDragging]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [parsedTags, setParsedTags] = useState(null)
  const [tagIssues, setTagIssues]   = useState([])
  const [fixedTags, setFixedTags]   = useState(null)
  const fileRef = useRef()

  // ── Step 2 state ─────────────────────────────────────────────
  const [workingTags, setWorkingTags] = useState(null)

  const subject        = exam.subject || 'Maths'
  const validChapters  = getValidChapters(subject)
  const hasChapterList = validChapters.length > 0
  const hasBlockingIssues = tagIssues.length > 0

  // ── Step 1: file handling ─────────────────────────────────────

  async function handleFileChange(file) {
    setTagsFile(file)
    setError(null)
    setParsedTags(null)
    setTagIssues([])
    setFixedTags(null)
    if (!file) return

    setLoading(true)
    try {
      const tags = await parseTagsFile(file)
      const { issues } = validateTags(tags, subject)
      setParsedTags(tags)
      setFixedTags([...tags])
      setTagIssues(issues)
    } catch (e) {
      setError(`Tags file error: ${e.message}`)
    }
    setLoading(false)
  }

  function acceptSuggestion(q, suggestion) {
    setFixedTags(prev => prev.map(t => t.q === q ? { ...t, chapter: suggestion } : t))
    setTagIssues(prev => prev.filter(i => i.q !== q))
  }

  function acceptAll() {
    const updates = {}
    tagIssues.forEach(i => { if (i.suggestion) updates[i.q] = i.suggestion })
    setFixedTags(prev => prev.map(t => updates[t.q] ? { ...t, chapter: updates[t.q] } : t))
    setTagIssues(prev => prev.filter(i => !i.suggestion))
  }

  function handleProceedToReview() {
    const tagMap = {}
    fixedTags.forEach(t => { tagMap[t.q] = t })

    // Merge new tags into existing exam questions — only update tag-side fields
    const merged = exam.questions.map(q => {
      const newTag = tagMap[q.q]
      if (!newTag) return q
      return {
        ...q,
        chapter:  newTag.chapter  ?? q.chapter,
        subtopic: newTag.subtopic ?? q.subtopic,
        question: newTag.question ?? q.question,
        optionA:  newTag.optionA  ?? q.optionA,
        optionB:  newTag.optionB  ?? q.optionB,
        optionC:  newTag.optionC  ?? q.optionC,
        optionD:  newTag.optionD  ?? q.optionD,
        answer:   newTag.answer   ?? q.answer,
        solution: newTag.solution ?? q.solution,
      }
    })

    setWorkingTags(merged)
    setStep(2)
  }

  function updateTag(i, field, value) {
    setWorkingTags(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  function handleSave() {
    replaceExam(exam.id, { ...exam, questions: workingTags })
    onClose()
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[600px] max-w-[95vw] max-h-[90vh]
                   overflow-y-auto flex flex-col"
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-tight">
              🏷️ Update Tags
            </h2>
            <p className="text-[12px] text-ink-3 mt-0.5">{exam.name} · {exam.date}</p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none transition-colors"
          >×</button>
        </div>

        <div className="px-7 py-6 flex-1">

          {/* ── Step 1: Upload ─────────────────────────────── */}
          {step === 1 && (
            <div>
              <p className="text-[13px] text-ink-2 mb-4">
                Upload a new tags Excel to replace chapter assignments, subtopics, question
                text, options, answers, and solutions. Student results are not affected.
              </p>

              <div className="mb-4">
                <label className="form-label">Tags File <span className="text-danger">*</span></label>
                <DropZone
                  file={tagsFile}
                  dragging={dragging}
                  accept=".xlsx,.xls"
                  icon="🏷️"
                  hint="Q · Chapter · Subtopic · Question · Options · Answer · Solution"
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

              {/* Validation issues */}
              {tagIssues.length > 0 && (
                <ValidationIssuesPanel
                  tagIssues={tagIssues}
                  tagsSubject={subject}
                  onAccept={acceptSuggestion}
                  onAcceptAll={acceptAll}
                />
              )}

              {/* Valid confirmation */}
              {tagsFile && parsedTags && !hasBlockingIssues && (
                <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50
                                border border-green-200 rounded-xl text-[12.5px] text-green-900">
                  <span>✅</span>
                  <span>All {parsedTags.length} chapter names validated — ready to review</span>
                </div>
              )}

              {error && (
                <Alert type="error"><span>⚠️</span><span>{error}</span></Alert>
              )}

              <div className="flex justify-end gap-3 mt-2">
                <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                <button
                  onClick={handleProceedToReview}
                  disabled={loading || !tagsFile || hasBlockingIssues || !parsedTags}
                  className="btn btn-primary"
                >
                  {loading ? <><Spinner size="sm" /> Reading…</> : 'Review Tags →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Review & save ───────────────────────── */}
          {step === 2 && workingTags && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] text-ink-2">
                  Review and edit tags before saving. Editing here updates the exam directly.
                </p>
                <span className="text-[12px] font-mono text-ink-3">
                  {workingTags.length} questions
                </span>
              </div>

              {/* Column headers */}
              <div className="grid gap-2 px-2 mb-1"
                   style={{ gridTemplateColumns: '44px 1fr 1fr' }}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Q#</div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Chapter</div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Subtopic</div>
              </div>

              {/* Tag rows */}
              <div className="max-h-[340px] overflow-y-auto border border-border rounded-xl overflow-hidden">
                {workingTags.map((tag, i) => (
                  <div
                    key={tag.q}
                    className={`grid gap-2 px-3 py-1.5 border-b border-border/50 last:border-0 items-center
                                ${i % 2 === 0 ? 'bg-surface' : 'bg-surface-2/50'}`}
                    style={{ gridTemplateColumns: '44px 1fr 1fr' }}
                  >
                    <span className="font-mono text-[11px] font-bold text-ink-3">Q{tag.q}</span>

                    {hasChapterList ? (
                      <select
                        className="text-[11px] border border-border rounded-md px-2 py-1
                                   outline-none bg-surface cursor-pointer focus:border-accent"
                        value={tag.chapter || ''}
                        onChange={e => updateTag(i, 'chapter', e.target.value)}
                      >
                        <option value="">— select —</option>
                        {validChapters.map(ch => (
                          <option key={ch} value={ch}>{ch}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="text-[11px] border border-border rounded-md px-2 py-1
                                   outline-none bg-surface focus:border-accent"
                        value={tag.chapter || ''}
                        onChange={e => updateTag(i, 'chapter', e.target.value)}
                        placeholder="Chapter"
                      />
                    )}

                    <input
                      className="text-[11px] border border-border rounded-md px-2 py-1
                                 outline-none bg-surface focus:border-accent"
                      value={tag.subtopic || ''}
                      onChange={e => updateTag(i, 'subtopic', e.target.value)}
                      placeholder="Subtopic"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setStep(1)} className="btn btn-secondary">← Back</button>
                <button onClick={handleSave} className="btn btn-primary">
                  💾 Save Tags
                </button>
              </div>
            </div>
          )}
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
