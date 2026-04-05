import useStore from '../store/useStore'
import { PageHeader, EmptyState, Card, Badge } from '../components/ui'
import { IS_READ_ONLY } from '../config'

export default function ExamsPage() {
  const exams = useStore(s => s.exams)
  const deleteExam = useStore(s => s.deleteExam)
  const openUploadModal = useStore(s => s.openUploadModal)

  return (
    <div>
      <PageHeader
        title="Exams"
        sub="All uploaded exam results"
        actions={!IS_READ_ONLY && (
          <button onClick={openUploadModal} className="btn btn-primary">
            + Add Exam
          </button>
        )}
      />

      {exams.length === 0 ? (
        <EmptyState icon="📝" title="No exams yet" sub="Upload your first results Excel to get started" />
      ) : (
        <div className="flex flex-col gap-3">
          {[...exams].reverse().map(exam => {
            const maxMarks = exam.questions.length * exam.marking.correct
            const avgScore = exam.students.length
              ? exam.students.reduce((s, st) => s + st.totalMarks, 0) / exam.students.length
              : 0
            const avgPct = maxMarks > 0 ? avgScore / maxMarks : 0
            const chapters = [...new Set(exam.questions.map(q => q.chapter))]

            return (
              <Card key={exam.id} className="flex items-center justify-between gap-4 hover:border-accent/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[14px] text-ink truncate">{exam.name}</div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-ink-3">
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

                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-[11px] text-ink-3 uppercase tracking-wide font-bold">Class Avg</div>
                    <div className={`text-[20px] font-extrabold font-mono tracking-tight ${avgPct >= 0.7 ? 'text-success' : avgPct >= 0.45 ? 'text-warning' : 'text-danger'}`}>
                      {avgScore.toFixed(1)}
                    </div>
                    <div className="text-[10px] font-mono text-ink-3">/ {maxMarks}</div>
                  </div>

                  {!IS_READ_ONLY && (
                    <button
                      onClick={() => confirm(`Delete "${exam.name}"?`) && deleteExam(exam.id)}
                      className="text-ink-3 hover:text-danger text-[18px] transition-colors p-1"
                      title="Delete exam"
                    >
                      ×
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
