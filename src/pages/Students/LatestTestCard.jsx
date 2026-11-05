import { useState } from 'react'
import { Card, Badge } from '../../components/ui'
import { fmtDate } from '../../lib/dates'
import FocusedExamResult from './FocusedExamResult'

// "Your latest test" — the student portal's answer to the first thing a student
// opens it for. Score out of the paper's max, the %, and the right / wrong /
// skipped split; "See full result" opens the same report the WhatsApp result
// link opens (FocusedExamResult), so there is one exam report, not two.
//
// No change-from-last-test figure: owner decision, 2026-11-05.
//
// `s` is one entry of StudentView's `scores` (exam + this student's row).
export default function LatestTestCard({ s }) {
  const [open, setOpen] = useState(false)
  if (!s?.exam || !s?.student) return null

  const offline = !s.exam.questions?.length
  const pct = s.max > 0 ? Math.round(s.pct * 100) : null
  const tone = pct === null ? 'yellow' : pct >= 70 ? 'green' : pct >= 45 ? 'yellow' : 'red'

  return (
    <Card>
      <div className="text-[12px] font-semibold text-ink-3 mb-1">Your latest test</div>
      <div className="text-[16px] font-extrabold text-ink leading-snug">{s.exam.name}</div>
      <div className="text-[13px] text-ink-3 mb-3">{fmtDate(s.exam.date) || s.exam.date}</div>

      <div className="flex items-end gap-3 mb-3">
        <div className="text-[30px] font-extrabold leading-none text-ink">
          {s.score}
          {s.max > 0 && <span className="text-[15px] font-semibold text-ink-3"> / {s.max}</span>}
        </div>
        {pct !== null && <Badge variant={tone}>{pct}%</Badge>}
      </div>

      {/* A marks-only paper has no per-question data; three zeros would read as
          "nothing right". Same rule as the exam report itself. */}
      {!offline && (
        <div className="flex gap-3 text-[13px] mb-4">
          <span className="text-success font-semibold">{s.correct} right</span>
          <span className="text-danger font-semibold">{s.wrong} wrong</span>
          <span className="text-ink-3">{s.na} skipped</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="btn btn-primary w-full min-h-[44px] text-[14px]"
      >
        {open ? 'Hide full result ▴' : 'See full result →'}
      </button>

      {open && (
        <div className="mt-4">
          <FocusedExamResult examId={s.exam.id} exams={[{ ...s.exam, students: [s.student] }]} />
        </div>
      )}
    </Card>
  )
}
