import { useState, useMemo } from 'react'
import { Badge } from '../../components/ui'
import QuestionCard from '../../components/ui/QuestionCard'
import {
  getExamTopStudents, getExamBottomStudents,
  getExamWrongQuestions, getExamSkippedQuestions,
  getExamToppers, examMaxMarks,
} from '../../lib/analytics'

// ── Shared sub-components ─────────────────────────────────────

function TabBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 text-[12px] font-semibold rounded-lg transition-colors
        ${active
          ? 'bg-accent text-white'
          : 'bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent'}`}
    >
      {label}
    </button>
  )
}

// A single student row used in top/bottom lists
function StudentRow({ rank, name, score, pct, colorClass }) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-border last:border-0">
      <span className="text-[11px] font-mono text-ink-3 w-5 flex-shrink-0">{rank}</span>
      <span className="flex-1 text-[12px] font-medium text-ink truncate">{name}</span>
      <span className={`text-[12px] font-bold font-mono ${colorClass}`}>{score}</span>
      <Badge variant={pct >= 0.7 ? 'green' : pct >= 0.45 ? 'yellow' : 'red'}>
        {Math.round(pct * 100)}%
      </Badge>
    </div>
  )
}

// A single question row with expand toggle and QuestionCard beneath
function QuestionRow({ rank, item, type, examId }) {
  const [open, setOpen] = useState(false)

  const isWrong  = type === 'wrong'
  const count    = isWrong ? item.wrong   : item.skipped
  const rate     = isWrong ? item.wrongRate : item.skipRate
  const countLabel = isWrong ? '❌' : '⬜'
  const barColor   = isWrong ? 'bg-danger' : 'bg-amber-400'
  const badgeColor = isWrong
    ? 'bg-red-50 text-danger border border-red-200'
    : 'bg-amber-50 text-amber-800 border border-amber-200'
  const expandColor = isWrong
    ? 'bg-red-50/50 border-t border-red-100'
    : 'bg-amber-50/50 border-t border-amber-100'

  const hasContent = item.q.question || item.q.optionA

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
        <span className="text-[11px] font-mono text-ink-3 w-5 flex-shrink-0">{rank}</span>

        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-ink">
            Q{item.q.q}
            {item.q.subtopic && (
              <span className="ml-2 font-normal text-ink-2">— {item.q.subtopic}</span>
            )}
          </div>
          <div className="text-[10px] text-ink-3">{item.q.chapter}</div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
            {count} {countLabel}
          </span>
          <div className="w-14 bg-surface-2 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor}`}
              style={{ width: `${Math.round(rate * 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-ink-3 w-8 text-right">
            {Math.round(rate * 100)}%
          </span>
          <button
            onClick={() => setOpen(o => !o)}
            disabled={!hasContent}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold
                        border transition-all disabled:opacity-40 disabled:cursor-not-allowed
              ${open
                ? (isWrong ? 'bg-red-50 text-danger border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200')
                : 'bg-surface-2 text-ink-2 border-border hover:bg-accent-soft hover:text-accent hover:border-accent/30'
              }`}
          >
            {open ? 'Hide ▲' : 'Show ▼'}
          </button>
        </div>
      </div>

      {open && (
        <div className={`px-4 py-3 ${expandColor}`}>
          <QuestionCard
            q={item.q}
            examId={examId}
            studentAnswer={null}
            studentResult={null}
            showRemediation={true}
          />
        </div>
      )}
    </div>
  )
}

// ── Questions section (wrong or skipped) ──────────────────────

function QuestionsSection({ title, items, type, examId, emptyMsg }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-3 py-2">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <QuestionRow
              key={item.q.q}
              rank={i + 1}
              item={item}
              type={type}
              examId={examId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab: Students ─────────────────────────────────────────────

function StudentsTab({ exam }) {
  const top    = useMemo(() => getExamTopStudents(exam, 5),    [exam])
  const bottom = useMemo(() => getExamBottomStudents(exam, 5), [exam])

  if (!exam.students.length) {
    return <p className="text-[12px] text-ink-3">No student data for this exam.</p>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Top 5 */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-2">
          Top 5 Students
        </div>
        <div>
          {top.map((s, i) => (
            <StudentRow
              key={s.name}
              rank={i + 1}
              name={s.name}
              score={s.score}
              pct={s.pct}
              colorClass="text-success"
            />
          ))}
        </div>
      </div>

      {/* Bottom 5 */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-2">
          Bottom 5 Students
        </div>
        <div>
          {bottom.map((s, i) => (
            <StudentRow
              key={s.name}
              rank={exam.students.length - bottom.length + i + 1}
              name={s.name}
              score={s.score}
              pct={s.pct}
              colorClass="text-danger"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab: Questions ────────────────────────────────────────────

function QuestionsTab({ exam }) {
  const wrong   = useMemo(() => getExamWrongQuestions(exam, null, 5),   [exam])
  const skipped = useMemo(() => getExamSkippedQuestions(exam, null, 5), [exam])

  return (
    <div className="space-y-6">
      <QuestionsSection
        title="Top 5 Wrong Questions"
        items={wrong}
        type="wrong"
        examId={exam.id}
        emptyMsg="No wrong answers recorded."
      />
      <QuestionsSection
        title="Top 5 Unattempted Questions"
        items={skipped}
        type="skipped"
        examId={exam.id}
        emptyMsg="No unattempted questions recorded."
      />
    </div>
  )
}

// ── Tab: Toppers ──────────────────────────────────────────────

function ToppersTab({ exam }) {
  const { toppers, names, count, cutoffScore } = useMemo(
    () => getExamToppers(exam, 0.25), [exam]
  )
  const maxMarks    = examMaxMarks(exam)
  const cutoffPct   = maxMarks > 0 ? Math.round(cutoffScore / maxMarks * 100) : 0
  const wrong       = useMemo(() => getExamWrongQuestions(exam, names, 5),   [exam, names])
  const skipped     = useMemo(() => getExamSkippedQuestions(exam, names, 5), [exam, names])

  if (!exam.students.length) {
    return <p className="text-[12px] text-ink-3">No student data for this exam.</p>
  }

  return (
    <div className="space-y-5">
      {/* Topper header */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-accent-soft rounded-xl border border-accent/20">
        <span className="text-[13px] font-bold text-accent">🏆 Top 25%</span>
        <span className="text-[12px] text-ink-2">
          {count} student{count !== 1 ? 's' : ''} · cutoff ≥ {cutoffScore} ({cutoffPct}%)
        </span>
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {toppers.map(s => (
            <span key={s.name} className="text-[10px] font-mono bg-white border border-accent/20
                                           text-accent px-2 py-0.5 rounded-full truncate max-w-[140px]">
              {s.name}
            </span>
          ))}
        </div>
      </div>

      {/* Wrong & skipped among toppers */}
      <QuestionsSection
        title="Top 5 Wrong Questions (among toppers)"
        items={wrong}
        type="wrong"
        examId={exam.id}
        emptyMsg="No wrong answers among toppers."
      />
      <QuestionsSection
        title="Top 5 Unattempted Questions (among toppers)"
        items={skipped}
        type="skipped"
        examId={exam.id}
        emptyMsg="No unattempted questions among toppers."
      />
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────

export default function ExamInsightsPanel({ exam }) {
  const [tab, setTab] = useState('students')

  return (
    <div className="border-t border-border bg-surface-2/60 px-4 md:px-6 py-4">
      {/* Tab bar */}
      <div className="flex gap-2 mb-4">
        <TabBtn label="Students"  active={tab === 'students'}  onClick={() => setTab('students')} />
        <TabBtn label="Questions" active={tab === 'questions'} onClick={() => setTab('questions')} />
        <TabBtn label="Toppers"   active={tab === 'toppers'}   onClick={() => setTab('toppers')} />
      </div>

      {/* Tab body */}
      {tab === 'students'  && <StudentsTab  exam={exam} />}
      {tab === 'questions' && <QuestionsTab exam={exam} />}
      {tab === 'toppers'   && <ToppersTab   exam={exam} />}
    </div>
  )
}
