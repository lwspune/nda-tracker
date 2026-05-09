import { useState, useRef } from 'react'
import { parseExcelFull } from '../../lib/excel'
import { Alert, DropZone, Spinner } from '../ui'
import useStore from '../../store/useStore'

export default function ReuploadResultsModal({ exam, onClose }) {
  const replaceExam = useStore(s => s.replaceExam)

  const [resultsFile, setResultsFile]     = useState(null)
  const [dragging, setDragging]           = useState(false)
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState(null)
  const [newStudents, setNewStudents]     = useState(null)
  const [newQuestionCount, setNewQuestionCount] = useState(null)
  const [newAnswerKeys, setNewAnswerKeys] = useState({})
  const fileRef = useRef()

  const oldStudentCount  = exam.students.length
  const oldQuestionCount = exam.questions.length

  const questionCountChanged =
    newQuestionCount !== null && newQuestionCount !== oldQuestionCount

  async function handleFileChange(file) {
    setResultsFile(file)
    setNewStudents(null)
    setNewQuestionCount(null)
    setNewAnswerKeys({})
    setError(null)
    if (!file) return

    setLoading(true)
    try {
      const extracted = await parseExcelFull(file)
      setNewStudents(extracted.students)
      setNewQuestionCount(extracted.totalQs)
      setNewAnswerKeys(extracted.answerKeys || {})
    } catch (e) {
      setError('Error reading Excel: ' + e.message)
    }
    setLoading(false)
  }

  // Results-Excel "Q N Key" wins over any prior tags-file Answer.
  // Only overwrite when the new file has a key for that question.
  const newQuestions = exam.questions.map(q =>
    newAnswerKeys[q.q] ? { ...q, answer: newAnswerKeys[q.q] } : q
  )
  const hasAnswerKeys = Object.keys(newAnswerKeys).length > 0

  function handleSave() {
    replaceExam(exam.id, { ...exam, students: newStudents, questions: newQuestions })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[560px] max-w-[95vw] max-h-[90vh]
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
            className="text-ink-3 hover:text-ink text-[20px] leading-none transition-colors"
          >×</button>
        </div>

        <div className="px-7 py-6 flex-1">
          <p className="text-[13px] text-ink-2 mb-4">
            Upload a corrected results Excel to replace student scores. Existing
            question tags (chapters, subtopics, solutions) are preserved.
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

          {/* Destructive answer-key overwrite warning */}
          {hasAnswerKeys && (
            <Alert type="warning">
              <span>⚠️</span>
              <span>
                <strong>Answer keys will be refreshed</strong> from this file&rsquo;s
                {' '}<code>Q N Key</code> columns ({Object.keys(newAnswerKeys).length} keys).
                Any answers previously set from a tags file will be overwritten.
              </span>
            </Alert>
          )}

          {error && (
            <Alert type="error"><span>⚠️</span><span>{error}</span></Alert>
          )}

          <div className="flex justify-end gap-3 mt-2">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleSave}
              disabled={loading || !newStudents}
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
