import { Card, Badge } from '../../components/ui'
import { ExamIssuesPanel } from './ExamHistoryTable'

/**
 * FocusedExamResult — student-portal-only "you clicked the result link" landing.
 *
 * When a parent/student arrives via the WhatsApp result deep-link (`?exam=<id>`),
 * this surfaces THAT exam's report at the top of the portal — score summary +
 * the per-question wrong/skipped breakdown — so they don't have to hunt for it
 * in the full exam-history table below.
 *
 * Renders nothing when there's no `examId`, no matching exam, or no result row
 * (manual logins, deleted exams) — the normal dashboard is then unchanged.
 *
 * @param {string|null} examId  the `?exam=` value from the URL
 * @param {Array}       exams   the student's exams from the login payload
 *                              (each has `students: [theStudent]`)
 */
export default function FocusedExamResult({ examId, exams }) {
  if (!examId) return null
  const exam = (exams || []).find(e => e.id === examId)
  if (!exam) return null
  const student = exam.students?.[0]
  if (!student) return null

  const max = (exam.questions?.length || 0) * (exam.marking?.correct || 0)
  const pct = max > 0 ? Math.round((student.totalMarks / max) * 100) : null
  const pctVariant = pct === null ? 'yellow' : pct >= 70 ? 'green' : pct >= 45 ? 'yellow' : 'red'

  return (
    <Card className="border-accent/40 bg-accent-soft/30 mb-4">
      <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-accent mb-1">
        📊 Your Result
      </div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-[16px] font-extrabold text-ink leading-tight">{exam.name}</div>
          {exam.date && <div className="text-[11px] font-mono text-ink-3 mt-0.5">{exam.date}</div>}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[20px] font-extrabold text-ink">
            {student.totalMarks}
            {max ? <span className="text-[13px] font-semibold text-ink-3"> / {max}</span> : null}
          </div>
          {pct !== null && <Badge variant={pctVariant}>{pct}%</Badge>}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[12px] font-mono mb-1">
        <span className="text-success">✅ {student.correct} correct</span>
        <span className="text-danger">❌ {student.incorrect} wrong</span>
        <span className="text-ink-3">⬜ {student.notAttempted} skipped</span>
      </div>

      {/* Per-question wrong/skipped breakdown for this exam */}
      <div className="-mx-4 -mb-4 mt-2">
        <ExamIssuesPanel exam={exam} student={student} />
      </div>

      <div className="text-[11px] text-ink-3 mt-3 pt-3 border-t border-border">
        ↓ Scroll down for full performance history, attendance, and chapter analysis.
      </div>
    </Card>
  )
}
