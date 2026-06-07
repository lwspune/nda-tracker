import { useState } from 'react'
import { Card, CardTitle, Badge } from '../../components/ui'
import QuestionCard from '../../components/ui/QuestionCard'

const PAGE_SIZE = 5

// ── Helpers ───────────────────────────────────────────────────

/**
 * Format a marks total for the bracketed suffix beside a #-questions count.
 * Positive → "+72", negative keeps its sign → "-2", zero → "0".
 * Rounds to 2 dp to strip float noise from non-integer marking schemes.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function fmtMarks(total) {
  const r = Math.round(total * 100) / 100
  return r > 0 ? `+${r}` : String(r === 0 ? 0 : r)  // String(-0) is "0"; force 0 too
}

/** All wrong (-1) and skipped (0) questions for one exam + student pair. */
function getIssues(exam, student) {
  return (exam.questions || [])
    .filter(q => {
      const r = student.responses?.[q.q]
      return r === -1 || r === 0
    })
    .map(q => ({ q, result: student.responses[q.q] }))
}

/** Bucket issues into difficulty groups. */
function groupByDifficulty(items) {
  const groups = { Easy: [], Moderate: [], Hard: [], Untagged: [] }
  items.forEach(item => {
    const d = (item.q.difficulty || '').toLowerCase()
    if (d === 'easy')                     groups.Easy.push(item)
    else if (d === 'moderate' || d === 'medium') groups.Moderate.push(item)
    else if (d === 'hard')                groups.Hard.push(item)
    else                                  groups.Untagged.push(item)
  })
  return groups
}

const DIFFICULTY_META = {
  Easy:     { label: 'Easy',     cls: 'bg-green-50 text-green-700 border-green-200' },
  Moderate: { label: 'Moderate', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  Hard:     { label: 'Hard',     cls: 'bg-red-50 text-red-700 border-red-200' },
  Untagged: { label: 'Untagged', cls: 'bg-surface-2 text-ink-3 border-border' },
}

// ── Question row inside the expanded panel ────────────────────

function IssueRow({ item, examId }) {
  const [open, setOpen] = useState(false)
  const isWrong = item.result === -1
  const hasContent = item.q.question || item.q.optionA

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-semibold text-ink">Q{item.q.q}</span>
          {item.q.subtopic && (
            <span className="ml-2 text-[11px] font-normal text-ink-2">— {item.q.subtopic}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border
            ${isWrong
              ? 'bg-red-50 text-danger border-red-200'
              : 'bg-surface-2 text-ink-3 border-border'}`}>
            {isWrong ? '❌ Wrong' : '⬜ Skipped'}
          </span>
          <button
            onClick={() => setOpen(o => !o)}
            disabled={!hasContent}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold
                        border transition-all disabled:opacity-40 disabled:cursor-not-allowed
              ${open
                ? (isWrong
                    ? 'bg-red-50 text-danger border-red-200'
                    : 'bg-surface-2 text-ink-3 border-border')
                : 'bg-surface-2 text-ink-2 border-border hover:bg-accent-soft hover:text-accent hover:border-accent/30'
              }`}
          >
            {open ? 'Hide ▲' : 'Show ▼'}
          </button>
        </div>
      </div>
      {open && (
        <div className={`px-4 py-3 border-t ${isWrong ? 'bg-red-50/40 border-red-100' : 'bg-surface-2/60 border-border'}`}>
          <QuestionCard
            q={item.q}
            examId={examId}
            studentAnswer={null}
            studentResult={item.result}
          />
        </div>
      )}
    </div>
  )
}

// ── Difficulty group section ──────────────────────────────────

function DifficultyGroup({ label, items, examId }) {
  if (!items.length) return null
  const meta = DIFFICULTY_META[label]
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5
                          rounded-full border font-mono ${meta.cls}`}>
          {meta.label}
        </span>
        <span className="text-[10px] text-ink-3 font-mono">{items.length} question{items.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <IssueRow key={item.q.q} item={item} examId={examId} />
        ))}
      </div>
    </div>
  )
}

// ── Expanded panel for one exam row ──────────────────────────

export function ExamIssuesPanel({ exam, student }) {
  const issues = getIssues(exam, student)
  if (!issues.length) return null
  const groups = groupByDifficulty(issues)

  return (
    <div className="px-4 py-3 bg-surface-2/50 border-t border-border space-y-4">
      {['Easy', 'Moderate', 'Hard', 'Untagged'].map(label => (
        <DifficultyGroup
          key={label}
          label={label}
          items={groups[label]}
          examId={exam.id}
        />
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────

export default function ExamHistoryTable({ scores }) {
  const [page, setPage]         = useState(0)
  const [openRows, setOpenRows] = useState(new Set())

  // Display newest first; scores prop stays chronological for stat-card calculations
  const display    = [...scores].reverse()
  const totalPages = Math.ceil(display.length / PAGE_SIZE)
  const start      = page * PAGE_SIZE
  const visible    = display.slice(start, start + PAGE_SIZE)

  function toggleRow(idx) {
    setOpenRows(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <CardTitle>Exam History</CardTitle>
        {totalPages > 1 && (
          <span className="text-[11px] font-mono text-ink-3">
            Page {page + 1} of {totalPages}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-border">
              {['Exam', 'Date', 'Score', '✅', '❌', '⬜', '%', ''].map((h, i) => (
                <th key={i} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-3 pl-4 first:pl-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => {
              const absIdx   = start + i
              const isOpen   = openRows.has(absIdx)
              const issues   = s.exam && s.student ? getIssues(s.exam, s.student) : []
              const hasIssues = issues.length > 0

              return (
                <>
                  <tr key={absIdx} className="border-b border-border/50 hover:bg-surface-2">
                    <td className="py-2 pr-3 pl-4 font-medium">{s.name}</td>
                    <td className="py-2 pr-3 font-mono text-ink-3 whitespace-nowrap">{s.date}</td>
                    <td className="py-2 pr-3 font-bold">{s.score}</td>
                    <td className="py-2 pr-3 text-success font-mono">
                      {s.correct}
                      {s.exam?.marking && (
                        <span className="text-ink-3"> ({fmtMarks(s.correct * s.exam.marking.correct)})</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-danger font-mono">
                      {s.wrong}
                      {s.exam?.marking && (
                        <span className="text-ink-3"> ({fmtMarks(s.wrong * s.exam.marking.wrong)})</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-ink-3 font-mono">
                      {s.na}
                      {s.exam?.marking && <span className="text-ink-3"> (0)</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={s.pct >= 0.7 ? 'green' : s.pct >= 0.45 ? 'yellow' : 'red'}>
                        {(s.pct * 100).toFixed(0)}%
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">
                      {hasIssues && (
                        <button
                          onClick={() => toggleRow(absIdx)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px]
                                      font-semibold border transition-all whitespace-nowrap
                            ${isOpen
                              ? 'bg-accent text-white border-accent'
                              : 'bg-surface-2 text-ink-2 border-border hover:bg-accent-soft hover:text-accent hover:border-accent/30'
                            }`}
                        >
                          {isOpen ? '▲' : '▼'} {issues.length} issues
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && s.exam && s.student && (
                    <tr key={`${absIdx}-panel`}>
                      <td colSpan={8} className="p-0">
                        <ExamIssuesPanel exam={s.exam} student={s.student} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <button
            onClick={() => { setPage(p => p - 1); setOpenRows(new Set()) }}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-border
                       bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent
                       hover:border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            ← Prev
          </button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => { setPage(i); setOpenRows(new Set()) }}
                className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg text-[11px] font-bold transition-all flex items-center justify-center
                  ${i === page
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-3 hover:bg-accent-soft hover:text-accent'
                  }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setPage(p => p + 1); setOpenRows(new Set()) }}
            disabled={page === totalPages - 1}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-border
                       bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent
                       hover:border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next →
          </button>
        </div>
      )}
    </Card>
  )
}
