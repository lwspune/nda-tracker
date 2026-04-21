import { useState } from 'react'
import useStore from '../store/useStore'
import { PageHeader, EmptyState, Card, Badge } from '../components/ui'
import { useMode } from '../context/ModeContext'
import ReuploadTagsModal    from '../components/upload/ReuploadTagsModal'
import ReuploadResultsModal from '../components/upload/ReuploadResultsModal'
import ExamInsightsPanel    from './Exams/ExamInsightsPanel'
import { downloadExamPdf }  from '../lib/examPdf'

export default function ExamsPage() {
  const exams = useStore(s => s.exams)
  const deleteExam = useStore(s => s.deleteExam)
  const openUploadModal = useStore(s => s.openUploadModal)
  const mode = useMode()

  const [subjectFilter, setSubjectFilter] = useState('all')
  const [branchFilter, setBranchFilter]   = useState('all')
  const [batchFilter, setBatchFilter]     = useState('all')
  const [sortBy, setSortBy]               = useState('date-desc')
  const [reuploadTagsExam, setReuploadTagsExam]       = useState(null)
  const [reuploadResultsExam, setReuploadResultsExam] = useState(null)
  const [expandedExamId, setExpandedExamId]           = useState(null)
  const [pdfGenerating, setPdfGenerating]             = useState(null)

  function toggleInsights(id) {
    setExpandedExamId(prev => prev === id ? null : id)
  }

  const availableSubjects = [...new Set(exams.map(e => e.subject || 'Maths'))].sort()

  const subjectFiltered = subjectFilter === 'all'
    ? exams
    : exams.filter(e => (e.subject || 'Maths') === subjectFilter)

  const availableBranches = [...new Set(subjectFiltered.map(e => e.branch).filter(Boolean))].sort()

  const branchFiltered = branchFilter === 'all'
    ? subjectFiltered
    : subjectFiltered.filter(e => e.branch === branchFilter)

  const availableBatches = [...new Set(branchFiltered.map(e => e.batch).filter(Boolean))].sort()

  const filteredExams = batchFilter === 'all'
    ? branchFiltered
    : branchFiltered.filter(e => e.batch === batchFilter)

  const sortedExams = [...filteredExams].sort((a, b) => {
    if (sortBy === 'date-desc') return b.date.localeCompare(a.date)
    if (sortBy === 'date-asc')  return a.date.localeCompare(b.date)
    if (sortBy === 'subject')   return (a.subject || 'Maths').localeCompare(b.subject || 'Maths')
    return 0
  })

  const isFiltered = subjectFilter !== 'all' || branchFilter !== 'all' || batchFilter !== 'all'
  const countLabel = isFiltered
    ? `${filteredExams.length} of ${exams.length} exams`
    : `${exams.length} exams`

  return (
    <div>
      <PageHeader
        title="Exams"
        sub={countLabel}
        actions={exams.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Sort exams"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="form-input w-auto text-[13px] pr-8 cursor-pointer"
              style={{ minWidth: '160px' }}
            >
              <option value="date-desc">Date (newest first)</option>
              <option value="date-asc">Date (oldest first)</option>
              <option value="subject">Subject (A–Z)</option>
            </select>
            <select
              aria-label="Subject filter"
              value={subjectFilter}
              onChange={e => { setSubjectFilter(e.target.value); setBranchFilter('all'); setBatchFilter('all') }}
              className="form-input w-auto text-[13px] pr-8 cursor-pointer"
              style={{ minWidth: '160px' }}
            >
              <option value="all">All Subjects</option>
              {availableSubjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {availableBranches.length > 0 && (
              <select
                aria-label="Branch filter"
                value={branchFilter}
                onChange={e => { setBranchFilter(e.target.value); setBatchFilter('all') }}
                className="form-input w-auto text-[13px] pr-8 cursor-pointer"
                style={{ minWidth: '140px' }}
              >
                <option value="all">All Branches</option>
                {availableBranches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}
            {availableBatches.length > 0 && (
              <select
                aria-label="Batch filter"
                value={batchFilter}
                onChange={e => setBatchFilter(e.target.value)}
                className="form-input w-auto text-[13px] pr-8 cursor-pointer"
                style={{ minWidth: '140px' }}
              >
                <option value="all">All Batches</option>
                {availableBatches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}
            {mode === 'faculty' && (
              <button onClick={openUploadModal} className="btn btn-primary">
                + Add Exam
              </button>
            )}
          </div>
        )}
      />

      {exams.length === 0 ? (
        <EmptyState icon="📝" title="No exams yet" sub="Upload your first results Excel to get started" />
      ) : (
        <div className="flex flex-col gap-3">
          {sortedExams.map(exam => {
            const maxMarks = exam.questions.length * exam.marking.correct
            const scores   = exam.students.map(st => st.totalMarks)
            const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
            const minScore = scores.length ? Math.min(...scores) : 0
            const maxScore = scores.length ? Math.max(...scores) : 0
            const pct = v => maxMarks > 0 ? Math.round(v / maxMarks * 100) : 0
            const avgPct = pct(avgScore)
            const pctColor = p => p >= 70 ? 'text-success' : p >= 45 ? 'text-warning' : 'text-danger'
            const chapters = [...new Set(exam.questions.map(q => q.chapter))]

            const isExpanded = expandedExamId === exam.id

            return (
              <Card key={exam.id} className="!p-0 overflow-hidden hover:border-accent/40 transition-colors">
                {/* ── Main exam row ── */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[14px] text-ink truncate">{exam.name}</div>
                    <div className="flex items-center flex-wrap gap-3 mt-1 text-[11px] font-mono text-ink-3">
                      <span>{exam.date}</span>
                      <span>·</span>
                      <span>{exam.students.length} students</span>
                      <span>·</span>
                      <span>{exam.questions.length} questions</span>
                      <span>·</span>
                      <span>+{exam.marking.correct}/{exam.marking.wrong}</span>
                      {exam.batch && <><span>·</span><span className="text-accent">{exam.batch}</span></>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {chapters.map(c => (
                        <span key={c} className="text-[10px] font-mono bg-accent-soft text-accent px-2 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 md:gap-4 md:flex-shrink-0 flex-wrap">
                    {/* Min / Avg / Max */}
                    {scores.length > 0 && (
                      <div className="flex items-end gap-4">
                        <div className="text-center">
                          <div className="text-[10px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Min</div>
                          <div className={`text-[17px] font-extrabold font-mono ${pctColor(pct(minScore))}`}>
                            {pct(minScore)}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Avg</div>
                          <div className={`text-[17px] font-extrabold font-mono ${pctColor(avgPct)}`}>
                            {avgPct}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Max</div>
                          <div className={`text-[17px] font-extrabold font-mono ${pctColor(pct(maxScore))}`}>
                            {pct(maxScore)}%
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Insights toggle */}
                    {exam.students.length > 0 && exam.questions.length > 0 && (
                      <button
                        onClick={() => toggleInsights(exam.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]
                                    font-semibold border transition-all flex-shrink-0
                          ${isExpanded
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surface-2 text-ink-2 border-border hover:bg-accent-soft hover:text-accent hover:border-accent/30'
                          }`}
                      >
                        📊 Insights {isExpanded ? '▲' : '▼'}
                      </button>
                    )}

                    {/* PDF download */}
                    {exam.students.length > 0 && exam.questions.length > 0 && (
                      <button
                        onClick={async () => {
                          setPdfGenerating(exam.id)
                          await new Promise(r => setTimeout(r, 50))
                          downloadExamPdf(exam)
                          setPdfGenerating(null)
                        }}
                        disabled={pdfGenerating === exam.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]
                                   font-semibold border transition-all flex-shrink-0
                                   bg-surface-2 text-ink-2 border-border
                                   hover:bg-green-50 hover:text-green-700 hover:border-green-300
                                   disabled:opacity-50 disabled:cursor-wait"
                      >
                        {pdfGenerating === exam.id ? '⏳ Generating…' : '📄 PDF'}
                      </button>
                    )}

                    {mode === 'faculty' && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setReuploadResultsExam(exam)}
                          className="btn btn-sm btn-secondary text-[11px]"
                          title="Re-upload results Excel"
                        >
                          📊 Update Results
                        </button>
                        <button
                          onClick={() => setReuploadTagsExam(exam)}
                          className="btn btn-sm btn-secondary text-[11px]"
                          title="Re-upload tags Excel"
                        >
                          🏷️ Update Tags
                        </button>
                        <button
                          onClick={() => confirm(`Delete "${exam.name}"?`) && deleteExam(exam.id)}
                          className="text-ink-3 hover:text-danger text-[18px] transition-colors p-1"
                          title="Delete exam"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Insights panel ── */}
                {isExpanded && <ExamInsightsPanel exam={exam} />}
              </Card>
            )
          })}
        </div>
      )}

      {/* Re-upload modals — faculty only */}
      {reuploadTagsExam && (
        <ReuploadTagsModal
          exam={reuploadTagsExam}
          onClose={() => setReuploadTagsExam(null)}
        />
      )}
      {reuploadResultsExam && (
        <ReuploadResultsModal
          exam={reuploadResultsExam}
          onClose={() => setReuploadResultsExam(null)}
        />
      )}
    </div>
  )
}
