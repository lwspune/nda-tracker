import useStore from '../../store/useStore'

export default function Step4Confirm({ state, onSave, onBack }) {
  const {
    examName, examDate, markCorrect, markWrong,
    students, tags, tagsSource, batch, detectedBatch, subject, branch,
  } = state

  const displayBatch  = batch || detectedBatch || null
  const displayBranch = branch || null

  const exams       = useStore(s => s.exams)
  const replaceExam = useStore(s => s.replaceExam)

  const maxMarks    = (tags?.length || 0) * markCorrect
  const chapters    = [...new Set((tags || []).map(t => t.chapter))].filter(Boolean)
  const hasQuestions = (tags || []).some(t => t.question)
  const hasSolutions = (tags || []).some(t => t.solution)
  const avgScore    = students?.length
    ? (students.reduce((s, st) => s + st.totalMarks, 0) / students.length).toFixed(1)
    : '—'

  // Duplicate detection — match on name + date
  const duplicate = exams.find(e =>
    e.name?.trim().toLowerCase() === examName?.trim().toLowerCase() &&
    e.date === examDate
  )

  function buildExam(id) {
    return {
      id: id || 'exam_' + Date.now(),
      name: examName,
      date: examDate,
      subject: subject || 'Maths',
      batch: state.batch || state.detectedBatch || null,
      branch: state.branch || null,
      marking: { correct: markCorrect, wrong: markWrong },
      questions: tags || [],
      students: students || [],
      createdAt: new Date().toISOString(),
    }
  }

  function handleSaveNew() {
    onSave(buildExam(null))
  }

  function handleReplace() {
    // Replace existing exam, keep its original id
    replaceExam(duplicate.id, buildExam(duplicate.id))
    onSave(null) // null signals UploadModal to just close, exam already saved
  }

  return (
    <div>
      {/* ── Duplicate warning ─────────────────────────── */}
      {duplicate && (
        <div className="mb-5 border border-yellow-300 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-yellow-50 border-b border-yellow-200">
            <span className="text-[15px]">⚠️</span>
            <div>
              <div className="text-[13px] font-bold text-yellow-900">This exam already exists</div>
              <div className="text-[11px] text-yellow-700 mt-0.5">
                "{duplicate.name}" · {duplicate.date} · {duplicate.students.length} students ·
                Added {new Date(duplicate.createdAt).toLocaleDateString('en-IN')}
              </div>
            </div>
          </div>
          <div className="px-4 py-3 bg-white flex flex-col gap-2">
            <p className="text-[12px] text-ink-2 mb-1">
              What would you like to do?
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleReplace}
                className="btn btn-sm bg-yellow-50 text-yellow-800 border border-yellow-300
                           hover:bg-yellow-100 font-semibold"
              >
                🔄 Replace existing
              </button>
              <button
                onClick={handleSaveNew}
                className="btn btn-sm btn-secondary"
              >
                ➕ Save as new
              </button>
              <button
                onClick={onBack}
                className="btn btn-sm btn-secondary"
              >
                ← Go back
              </button>
            </div>
            <p className="text-[10.5px] text-ink-3 mt-1">
              <strong>Replace</strong> — use this if results were corrected or tags were updated. ·{' '}
              <strong>Save as new</strong> — use this if this is intentionally a separate entry.
            </p>
          </div>
        </div>
      )}

      {!duplicate && (
        <div className="text-[13px] text-ink-2 mb-5">
          Review everything below. Click <strong>Save Exam</strong> to add it to your tracker.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <SummaryCard label="Exam Name" value={examName || '—'} />
        <SummaryCard label="Date" value={examDate || '—'} />
        <SummaryCard label="Subject" value={subject || 'Maths'} />
        <SummaryCard label="Batch"   value={displayBatch  || 'Not assigned'} valueColor={displayBatch  ? 'text-ink' : 'text-ink-3'} />
        <SummaryCard label="Branch"  value={displayBranch || 'Not assigned'} valueColor={displayBranch ? 'text-ink' : 'text-ink-3'} />
        <SummaryCard label="Students" value={students?.length || 0} />
        <SummaryCard label="Questions" value={tags?.length || 0} />
        <SummaryCard label="Marking" value={`+${markCorrect} / ${markWrong}`} />
        <SummaryCard label="Max Marks" value={maxMarks} />
        <SummaryCard label="Class Avg" value={avgScore} />
        <SummaryCard
          label="Tags"
          value={tagsSource ? '✅ From file' : '✏️ Manual'}
          valueColor={tagsSource ? 'text-success' : 'text-warning'}
        />
      </div>

      {/* Chapters */}
      {chapters.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">Chapters</div>
          <div className="flex flex-wrap gap-1.5">
            {chapters.map(c => (
              <span key={c} className="text-[11px] font-mono bg-accent-soft text-accent
                                       px-2.5 py-0.5 rounded-full">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Enrichment status */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <EnrichBadge label="Question Text" active={hasQuestions} />
        <EnrichBadge label="Options A–D"   active={hasQuestions} />
        <EnrichBadge label="Solutions"     active={hasSolutions} />
      </div>

      {/* Actions — only show Save if no duplicate */}
      {!duplicate && (
        <div className="flex justify-end gap-3">
          <button onClick={onBack} className="btn btn-secondary">← Back</button>
          <button onClick={handleSaveNew} className="btn btn-primary">
            💾 Save Exam
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, valueColor = 'text-ink' }) {
  return (
    <div className="bg-surface-2 border border-border rounded-xl px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">{label}</div>
      <div className={`text-[14px] font-bold truncate ${valueColor}`}>{value}</div>
    </div>
  )
}

function EnrichBadge({ label, active }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg
                     ${active
                       ? 'bg-green-50 text-success border border-green-200'
                       : 'bg-surface-2 text-ink-3 border border-border'}`}>
      <span>{active ? '✅' : '○'}</span>
      {label}
    </div>
  )
}
