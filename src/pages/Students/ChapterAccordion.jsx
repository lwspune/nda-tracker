import { useState } from 'react'
import QuestionCard from '../../components/ui/QuestionCard'
import { scoreBg } from '../../lib/analytics'
import { fmtDate, getSubtopicQuestions, groupByExam } from './chapterAccordionHelpers'

export default function ChapterAccordion({ chapterSummary, name, exams }) {
  const [openChapters, setOpenChapters]   = useState({})
  const [openWrong, setOpenWrong]         = useState({})
  const [openSkipped, setOpenSkipped]     = useState({})


  const toggleChapter  = ch  => setOpenChapters(o => ({ ...o, [ch]:  !o[ch]  }))
  const toggleWrong    = key => setOpenWrong(o    => ({ ...o, [key]: !o[key] }))
  const toggleSkipped  = key => setOpenSkipped(o  => ({ ...o, [key]: !o[key] }))

  // Wrappers that bind the name + exams closure args
  function getQuestions(ch, sub) { return getSubtopicQuestions(ch, sub, name, exams) }

  return (
    <div className="flex flex-col gap-1.5">
      {chapterSummary.map(({ ch, avg, subs }) => {
        const { wrong: chWrong, skipped: chSkipped } = chapterCounts(subs)
        return (
        <div key={ch}>

          {/* ── Chapter row ───────────────────────────────
              A button so it opens from the keyboard. The name wraps rather than
              truncating ("Trigonome…" could not be told apart on a phone), and the
              % sits beside the bar so a 0% chapter still says 0%. The wrong /
              skipped line replaced a "(n)" subtopic count that never matched what
              opened — subtopics with nothing to review are hidden below. */}
          <button
            type="button"
            onClick={() => toggleChapter(ch)}
            aria-expanded={!!openChapters[ch]}
            className="w-full text-left flex items-center gap-2.5 py-2.5 min-h-[44px] group rounded
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="w-[150px] md:w-[220px] flex-shrink-0 min-w-0">
              <div className="flex items-start gap-1.5 text-[13px] text-ink font-semibold leading-snug">
                <span
                  aria-hidden="true"
                  className="text-[10px] text-ink-3 inline-block transition-transform duration-200 flex-shrink-0 mt-[3px]"
                  style={{ transform: openChapters[ch] ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >▶</span>
                <span className="break-words min-w-0">{ch}</span>
              </div>
              <div className="text-[11px] text-ink-3 pl-[18px] mt-0.5">
                {chWrong} wrong · {chSkipped} skipped
              </div>
            </div>
            <div className="flex-1 bg-surface-2 rounded-full h-2.5 overflow-hidden">
              {avg > 0 && (
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${avg * 100}%`, background: scoreBg(avg) }}
                />
              )}
            </div>
            <span
              className="w-10 text-right text-[13px] font-mono font-bold flex-shrink-0"
              style={{ color: avg > 0 ? scoreBg(avg) : undefined }}
            >
              {(avg * 100).toFixed(0)}%
            </span>
          </button>

          {/* ── Subtopic cards ───────────────────────────── */}
          {openChapters[ch] && (
            <div className="flex flex-col gap-2.5 mb-3 ml-4">
              {Object.entries(subs)
                .sort((a, b) => a[1].weightedScore - b[1].weightedScore)
                .map(([sub, data]) => {
                  const subKey        = `${ch}::${sub}`
                  const { wrong, skipped } = getQuestions(ch, sub)

                  // Hide subtopics with no wrong or skipped questions — nothing to review
                  if (wrong.length === 0 && skipped.length === 0) return null

                  const wrongGroups   = groupByExam(wrong)
                  const skippedGroups = groupByExam(skipped)
                  const isWrongOpen   = openWrong[subKey]
                  const isSkipOpen    = openSkipped[subKey]
                  const pct           = (data.weightedScore * 100).toFixed(0)

                  return (
                    <div
                      key={sub}
                      className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm"
                      style={{ borderLeft: `4px solid ${scoreBg(data.weightedScore)}` }}
                    >
                      {/* Card header */}
                      <div className="px-4 pt-3.5 pb-3">

                        {/* Name + trend */}
                        <div className="flex items-start justify-between gap-3 mb-2.5">
                          <div className="text-[13px] font-semibold text-ink leading-snug">{sub}</div>
                        </div>

                        {/* Score bar */}
                        <div className="flex items-center gap-2.5 mb-3">
                          <div className="flex-1 bg-surface-2 rounded-full h-2 overflow-hidden">
                            {data.weightedScore > 0 && (
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, background: scoreBg(data.weightedScore) }}
                              />
                            )}
                          </div>
                          <span
                            className="text-[13px] font-bold font-mono flex-shrink-0"
                            style={{ color: scoreBg(data.weightedScore) }}
                          >
                            {pct}%
                          </span>
                        </div>

                        {/* Per-exam breakdown — plain English */}
                        <div className="flex flex-col gap-1 mb-3">
                          {data.examsArr.map(ea => (
                            <div key={ea.examId} className="flex items-center gap-2 text-[12px]">
                              <span className="text-ink-3 font-mono text-[11px] w-14 flex-shrink-0">
                                {fmtDate(ea.date)}
                              </span>
                              <span className="text-ink-2">{ea.examName}</span>
                              <span className="ml-auto flex items-center gap-2 text-[11px] font-mono flex-shrink-0">
                                {ea.correct > 0 && (
                                  <span className="text-success font-semibold">{ea.correct} correct</span>
                                )}
                                {ea.wrong > 0 && (
                                  <span className="text-danger font-semibold">{ea.wrong} wrong</span>
                                )}
                                {ea.skipped > 0 && (
                                  <span className="text-ink-3">{ea.skipped} skipped</span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Action buttons */}
                        {(wrong.length > 0 || skipped.length > 0) && (
                          <div className="flex gap-2 flex-wrap">
                            {wrong.length > 0 && (
                              <button
                                onClick={() => toggleWrong(subKey)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                            text-[12px] font-semibold border transition-all
                                  ${isWrongOpen
                                    ? 'bg-red-50 text-danger border-red-200'
                                    : 'bg-surface-2 text-ink-2 border-border hover:bg-red-50 hover:text-danger hover:border-red-200'
                                  }`}
                              >
                                ❌ {wrong.length} Wrong {isWrongOpen ? '▲' : '▼'}
                              </button>
                            )}
                            {skipped.length > 0 && (
                              <button
                                onClick={() => toggleSkipped(subKey)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                            text-[12px] font-semibold border transition-all
                                  ${isSkipOpen
                                    ? 'bg-surface-3 text-ink-2 border-border-2'
                                    : 'bg-surface-2 text-ink-2 border-border hover:bg-surface-3 hover:border-border-2'
                                  }`}
                              >
                                ⬜ {skipped.length} Not Attempted {isSkipOpen ? '▲' : '▼'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Wrong questions expanded */}
                      {isWrongOpen && wrong.length > 0 && (
                        <div className="border-t border-border px-4 py-3 bg-red-50/40 space-y-4">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-danger">
                            ❌ Wrong Answers — {wrong.length} question{wrong.length > 1 ? 's' : ''}
                          </div>
                          {wrongGroups.map(group => (
                            <div key={`${group.examName}-${group.examDate}`}>
                              <div className="text-[11px] font-semibold text-ink-2 mb-2 flex items-center gap-2">
                                <span className="font-mono text-ink-3">{fmtDate(group.examDate, true)}</span>
                                <span>·</span>
                                <span>{group.examName}</span>
                              </div>
                              <div className="space-y-2.5">
                                {group.items.map(({ qObj, studentResult, studentAnswer }) => (
                                  <QuestionCard
                                    key={`Q${qObj.q}`}
                                    q={qObj}
                                    examId={group.examId}
                                    studentAnswer={studentAnswer}
                                    studentResult={studentResult}
                                    showRemediation={studentResult === -1 || studentResult === 0}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Skipped questions expanded */}
                      {isSkipOpen && skipped.length > 0 && (
                        <div className="border-t border-border px-4 py-3 bg-surface-2/60 space-y-4">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
                            ⬜ Not Attempted — {skipped.length} question{skipped.length > 1 ? 's' : ''}
                          </div>
                          {skippedGroups.map(group => (
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
          )}

        </div>
        )
      })}
    </div>
  )
}

// Wrong and skipped questions across a chapter: every subtopic, every exam.
function chapterCounts(subs) {
  let wrong = 0, skipped = 0
  for (const data of Object.values(subs || {})) {
    for (const ea of data.examsArr || []) {
      wrong   += ea.wrong   || 0
      skipped += ea.skipped || 0
    }
  }
  return { wrong, skipped }
}
