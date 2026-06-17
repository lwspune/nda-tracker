import { useState } from 'react'
import { Card, Badge } from '../../components/ui'
import QuestionCard from '../../components/ui/QuestionCard'
import { getIssues } from './ExamHistoryTable'

/**
 * FocusedExamResult — student-portal-only "you clicked the result link" landing.
 *
 * When a parent/student arrives via the WhatsApp result deep-link (`?exam=<id>`),
 * this surfaces THAT exam's report at the top of the portal — score summary +
 * a simple per-question table (Q no · your answer · correct answer · show
 * question) — so they don't have to hunt for it in the full exam-history table
 * below. The detailed difficulty-grouped panel (ExamIssuesPanel) is deliberately
 * NOT used here: parents found it confusing. The table defaults to ALL questions
 * in sequence; a toggle narrows it to wrong + skipped only.
 *
 * Renders nothing when there's no `examId`, no matching exam, or no result row
 * (manual logins, deleted exams) — the normal dashboard is then unchanged.
 *
 * @param {string|null} examId  the `?exam=` value from the URL
 * @param {Array}       exams   the student's exams from the login payload
 *                              (each has `students: [theStudent]`)
 */
export default function FocusedExamResult({ examId, exams }) {
  // Default to ALL questions (sequential, no gaps) — parents asked for the whole
  // paper, not just the misses. The toggle narrows to wrong + skipped only.
  const [showAll, setShowAll] = useState(true)

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

      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-3 text-[12px] font-mono">
          <span className="text-success">✅ {student.correct} correct</span>
          <span className="text-danger">❌ {student.incorrect} wrong</span>
          <span className="text-ink-3">⬜ {student.notAttempted} skipped</span>
        </div>
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-border
                     bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent
                     hover:border-accent/30 transition-all min-h-[32px]
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {showAll ? 'Show only wrong & skipped' : 'Show all questions'}
        </button>
      </div>

      {/* Simple per-question table — all questions by default, wrong/skipped when toggled */}
      <div className="-mx-4 -mb-4 mt-2">
        <SimpleResultTable exam={exam} student={student} includeAll={showAll} />
      </div>
    </Card>
  )
}

// ── Per-answer styling for the "Your answer" cell ─────────────
function answerClass(result) {
  if (result === -1) return 'font-mono font-bold text-danger'
  if (result === 1)  return 'font-mono font-bold text-success'
  return 'font-mono text-ink-3' // skipped / unknown
}

/**
 * SimpleResultTable — the parent-friendly per-question breakdown.
 * A flat, sequential table (Q · your answer · correct answer · show-question),
 * reusing `getIssues` for the row set and the full `QuestionCard` for the
 * expanded view. Single-open: showing one question collapses the previous.
 */
function SimpleResultTable({ exam, student, includeAll }) {
  const [openQ, setOpenQ] = useState(null)

  if (!exam.questions?.length) {
    return (
      <div className="px-4 py-3 border-t border-border text-[12px] text-ink-3">
        Per-question breakdown isn't available for this exam.
      </div>
    )
  }

  const rows = getIssues(exam, student, includeAll)
    .slice()
    .sort((a, b) => Number(a.q.q) - Number(b.q.q))

  if (!rows.length) {
    return (
      <div className="px-4 py-3 border-t border-border text-[12px] text-success font-medium">
        No wrong or skipped questions — well done! 🎉
      </div>
    )
  }

  return (
    <div className="border-t border-border overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-surface-2 text-[10px] uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 font-bold">Q</th>
            <th className="px-3 py-2 font-bold">Your answer</th>
            <th className="px-3 py-2 font-bold">Correct answer</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ q, result, studentAnswer }) => {
            const open       = openQ === q.q
            const hasContent = !!(q.question || q.optionA)
            return (
              <FragmentRow
                key={q.q}
                q={q}
                examId={exam.id}
                result={result}
                studentAnswer={studentAnswer}
                open={open}
                hasContent={hasContent}
                onToggle={() => setOpenQ(prev => (prev === q.q ? null : q.q))}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FragmentRow({ q, examId, result, studentAnswer, open, hasContent, onToggle }) {
  return (
    <>
      <tr className="border-b border-border">
        <td className="px-3 py-2 font-mono font-bold text-[12px] text-ink whitespace-nowrap">Q{q.q}</td>
        <td className="px-3 py-2 text-[12px]">
          <span className={answerClass(result)}>{studentAnswer ?? '—'}</span>
        </td>
        <td className="px-3 py-2 text-[12px]">
          <span className="font-mono font-bold text-success">{q.answer || '—'}</span>
        </td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={onToggle}
            disabled={!hasContent}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} question ${q.q}`}
            className="text-[11px] font-semibold px-3 py-1 rounded-lg border border-border
                       bg-surface text-ink-2 hover:bg-accent-soft hover:text-accent
                       hover:border-accent/30 transition-all whitespace-nowrap
                       disabled:opacity-40 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {open ? 'Hide ▲' : 'Show question ▼'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="px-3 py-3 bg-surface-2/40 border-b border-border">
            <QuestionCard
              q={q}
              examId={examId}
              studentAnswer={studentAnswer}
              studentResult={result}
              showRemediation={result === -1 || result === 0}
            />
          </td>
        </tr>
      )}
    </>
  )
}
