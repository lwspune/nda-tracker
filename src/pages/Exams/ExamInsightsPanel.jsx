import { useState, useMemo } from 'react'
import { Badge } from '../../components/ui'
import QuestionCard from '../../components/ui/QuestionCard'
import {
  getExamTopStudents, getExamBottomStudents,
  getExamWrongQuestions, getExamSkippedQuestions,
  getExamToppers, getExamScoreSummary, getExamAbsentees,
  examMaxMarks, examFormat, scoreColor,
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

// ── Written exams ─────────────────────────────────────────────
//
// A hand-graded paper records one number per student and nothing else, so the
// three-tab view collapses: two of its tabs read `responses`, which is empty.
// What IS knowable — every mark, the shape of the class, and who didn't sit it —
// gets shown at once instead of behind tabs.

function Stat({ label, value, sub, testId, colorClass = 'text-ink' }) {
  return (
    <div className="px-3 py-2 rounded-xl border border-border bg-surface min-w-[92px]">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-3">{label}</div>
      <div className={`text-[18px] font-extrabold font-mono leading-tight ${colorClass}`} data-testid={testId}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-3 font-mono">{sub}</div>}
    </div>
  )
}

// Marks can be fractional (0.5 steps) — trim a trailing .0 so a whole mark reads
// as "13", not "13.0", while a genuine half-mark still shows.
function fmtMark(v) {
  if (v === null || v === undefined) return '—'
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)))
}

function WrittenView({ exam, studentProfiles }) {
  const summary = useMemo(() => getExamScoreSummary(exam), [exam])
  const maxMarks = summary.maxMarks

  const ranked = useMemo(
    () => [...(exam.students ?? [])].sort((a, b) => b.totalMarks - a.totalMarks),
    [exam]
  )

  // Rostered students with no result. Derived from current batch membership the
  // same way the absence alert derives it, so the panel and the send preview
  // can't disagree about who was missing.
  const absentees = useMemo(
    () => getExamAbsentees(exam, studentProfiles),
    [exam, studentProfiles]
  )

  const pctOf = v => (maxMarks > 0 ? v / maxMarks : null)
  const fmtPct = p => (p === null ? '—' : `${Math.round(p * 100)}%`)

  return (
    <div className="space-y-5">
      {/* Class shape */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-2">
          Class Shape
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat label="Median" value={fmtMark(summary.median)} sub={fmtPct(summary.medianPct)}
                testId="written-median"
                colorClass={summary.medianPct === null ? 'text-ink' : scoreColor(summary.medianPct)} />
          <Stat label="Mean" value={fmtMark(summary.mean)} sub={fmtPct(summary.meanPct)}
                testId="written-mean" />
          <Stat label="Spread" value={fmtMark(summary.spread)} sub="std dev" testId="written-spread" />
          {summary.bands && (
            <>
              <Stat label="≥ 70%" value={summary.bands.strong} testId="band-strong" colorClass="text-success" />
              <Stat label="45–70%" value={summary.bands.fair}  testId="band-fair"   colorClass="text-warning" />
              <Stat label="< 45%"  value={summary.bands.weak}  testId="band-weak"   colorClass="text-danger" />
            </>
          )}
        </div>
      </div>

      {/* Every mark. A written class test is small enough that top-5/bottom-5
          would hide most of the room. */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-2">
          All Students — {ranked.length}
        </div>
        {ranked.length === 0 ? (
          <p className="text-[12px] text-ink-3 py-2">No marks recorded for this exam.</p>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden bg-surface">
            <table aria-label="All students" className="w-full text-[12px]">
              <thead>
                <tr className="bg-surface-2 text-ink-3 text-[10px] uppercase tracking-wide">
                  <th scope="col" className="text-left font-bold px-3 py-2 w-10">#</th>
                  <th scope="col" className="text-left font-bold px-3 py-2">Student</th>
                  <th scope="col" className="text-right font-bold px-3 py-2">Marks</th>
                  <th scope="col" className="text-right font-bold px-3 py-2 w-16">%</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s, i) => {
                  const p = pctOf(s.totalMarks)
                  return (
                    <tr key={s.name} className="border-t border-border">
                      <td className="px-3 py-1.5 font-mono text-ink-3">{i + 1}</td>
                      <td className="px-3 py-1.5 text-ink truncate">{s.name}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-ink">
                        {fmtMark(s.totalMarks)} / {maxMarks > 0 ? fmtMark(maxMarks) : '—'}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${p === null ? 'text-ink-3' : scoreColor(p)}`}>
                        {fmtPct(p)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Who wasn't there — reachable only inside the send preview until now. */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-2">
          Did Not Appear
        </div>
        <div data-testid="written-absentees" className="text-[12px] text-ink-2">
          {absentees.length === 0 ? (
            <span className="text-ink-3">Everyone on the batch roster has a mark.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {absentees.map(p => (
                <span key={p.lwsId || p.name}
                      className="text-[11px] font-mono bg-surface border border-border
                                 text-ink-2 px-2 py-0.5 rounded-full">
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────

export default function ExamInsightsPanel({ exam, studentProfiles }) {
  const [tab, setTab] = useState('students')

  // Format is derived from questions[], never stored — see analyticsHelpers.
  if (examFormat(exam) === 'written') {
    return (
      <div className="border-t border-border bg-surface-2/60 px-4 md:px-6 py-4">
        <WrittenView exam={exam} studentProfiles={studentProfiles} />
      </div>
    )
  }

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
