import { useState } from 'react'
import { Card, CardTitle } from '../../components/ui'
import QuestionCard from '../../components/ui/QuestionCard'
import { getSubtopicQuestions, groupByExam, fmtDate } from './chapterAccordionHelpers'

const PAGE_SIZE = 5

// Props: skippedAudit, name, exams
export default function UnattemptedAudit({ skippedAudit, name, exams }) {
  const [page, setPage]                   = useState(0)
  const [openQuestions, setOpenQuestions] = useState({})

  const totalPages = Math.ceil(skippedAudit.length / PAGE_SIZE)
  const start      = page * PAGE_SIZE
  const end        = Math.min(start + PAGE_SIZE, skippedAudit.length)
  const visible    = skippedAudit.slice(start, end)
  const multiPage  = totalPages > 1

  function toggleQuestions(key) {
    setOpenQuestions(o => ({ ...o, [key]: !o[key] }))
  }

  return (
    <Card>
      <CardTitle>⬜ Unattempted Question Audit</CardTitle>
      <div className="text-[12px] text-ink-3 mb-4">
        Subtopics sorted by unattempted count — questions you skipped that need attention.
      </div>

      <div className="space-y-2 mb-4">
        {visible.map((item, i) => {
          const key    = `${item.chapter}::${item.subtopic}`
          const isOpen = !!openQuestions[key]
          const { skipped } = isOpen
            ? getSubtopicQuestions(item.chapter, item.subtopic, name, exams)
            : { skipped: [] }
          const groups = isOpen ? groupByExam(skipped) : []

          return (
            <div
              key={key}
              className="border border-border rounded-xl overflow-hidden"
            >
              {/* Row header */}
              <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                <span className="text-[11px] font-mono text-ink-3 w-5 flex-shrink-0">
                  {start + i + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-ink truncate">{item.subtopic}</div>
                  <div className="text-[10px] text-ink-3">{item.chapter}</div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <span className="text-[11px] font-mono font-bold text-warning bg-amber-50
                                   px-2 py-0.5 rounded-full">
                    {item.skipped} ⬜
                  </span>
                  <div className="w-16 bg-surface-2 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-warning"
                      style={{ width: `${Math.round(item.skipRate * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-ink-3 w-8 text-right">
                    {Math.round(item.skipRate * 100)}%
                  </span>

                  <button
                    onClick={() => toggleQuestions(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                text-[12px] font-semibold border transition-all
                      ${isOpen
                        ? 'bg-amber-50 text-warning border-amber-200'
                        : 'bg-surface-2 text-ink-2 border-border hover:bg-amber-50 hover:text-warning hover:border-amber-200'
                      }`}
                  >
                    ⬜ {isOpen ? 'Hide Questions' : 'Show Questions'} {isOpen ? '▲' : '▼'}
                  </button>
                </div>
              </div>

              {/* Expanded question cards */}
              {isOpen && (
                <div className="border-t border-border px-4 py-3 bg-amber-50/40 space-y-4">
                  {groups.length === 0 ? (
                    <div className="text-[12px] text-ink-3 py-2">
                      No question details available.
                    </div>
                  ) : groups.map(group => (
                    <div key={`${group.examName}-${group.examDate}`}>
                      <div className="text-[11px] font-semibold text-ink-2 mb-2 flex items-center gap-2">
                        <span className="font-mono text-ink-3">{fmtDate(group.examDate, true)}</span>
                        <span>·</span>
                        <span>{group.examName}</span>
                      </div>
                      <div className="space-y-2.5">
                        {group.items.map(({ qObj, studentResult }) => (
                          <QuestionCard
                            key={`Q${qObj.q}`}
                            q={qObj}
                            examId={group.examId}
                            studentAnswer={null}
                            studentResult={studentResult}
                            showRemediation={studentResult === -1 || studentResult === 0}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination — only when more than one page */}
      {multiPage && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page === 0}
            className={`btn btn-secondary btn-sm
              ${page === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            ← Prev
          </button>
          <span className="text-[12px] text-ink-3 font-mono">
            Showing {start + 1}–{end} of {skippedAudit.length}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page === totalPages - 1}
            className={`btn btn-secondary btn-sm
              ${page === totalPages - 1 ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            Next →
          </button>
        </div>
      )}
    </Card>
  )
}
