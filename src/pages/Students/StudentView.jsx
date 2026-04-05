import useStore from '../../store/useStore'
import { Card, CardTitle, StatCard, Badge, EmptyState } from '../../components/ui'
import {
  getStudentExams, computeStudentChapterStats,
  computeAttemptQuality, computeConsistency,
  computeProjectedScore, computeWrongAudit,
  scoreBg
} from '../../lib/analytics'

const TREND_ICON  = { improving: '📈', declining: '📉', volatile: '⚡', stable: '➡️' }
const TREND_COLOR = { improving: 'green', declining: 'red', volatile: 'yellow', stable: 'gray' }

export default function StudentView({ name }) {
  const exams          = useStore(s => s.exams)
  const studentProfiles = useStore(s => s.studentProfiles)
  const savedInsights  = useStore(s => s.savedInsights)
  const ndaFreq        = useStore(s => s.ndaFreq)

  const examData = getStudentExams(name, exams)
  if (!examData.length) {
    return <EmptyState icon="🔍" title="No data" sub={`No exam records found for "${name}"`} />
  }

  const chapterStats  = computeStudentChapterStats(name, exams)
  const aq            = computeAttemptQuality(name, exams)
  const consistency   = computeConsistency(name, exams)
  const projected     = computeProjectedScore(name, exams, ndaFreq)
  const wrongAudit    = computeWrongAudit(name, exams)

  const scores = examData.map(({ exam, student }) => ({
    name: exam.name, date: exam.date,
    score: student.totalMarks,
    max: exam.questions.length * exam.marking.correct,
    pct: exam.questions.length * exam.marking.correct > 0
      ? student.totalMarks / (exam.questions.length * exam.marking.correct)
      : 0,
    correct: student.correct, wrong: student.incorrect, na: student.notAttempted,
  }))

  const latest = scores[scores.length - 1]
  const prev = scores.length >= 2 ? scores[scores.length - 2] : null
  const delta = prev ? latest.score - prev.score : null

  // Profile lookup
  const profile = studentProfiles[name] ||
    Object.values(studentProfiles).find(p => p.name?.toLowerCase() === name.toLowerCase())

  // Chapter summary for accordion
  const chapterSummary = Object.entries(chapterStats).map(([ch, subs]) => {
    const vals = Object.values(subs)
    const avg = vals.reduce((s, v) => s + v.weightedScore, 0) / vals.length
    const trends = vals.map(v => v.trend)
    const dominant = trends.sort((a, b) =>
      trends.filter(t => t === b).length - trends.filter(t => t === a).length
    )[0]
    return { ch, avg, trend: dominant, subs }
  }).sort((a, b) => a.avg - b.avg)

  const savedPlan = savedInsights.studentPlans?.[name]

  return (
    <div className="space-y-4">
      {/* Profile card */}
      {profile && (
        <Card className="flex items-center gap-5 flex-wrap">
          <div className="w-11 h-11 rounded-full bg-accent-soft flex items-center justify-center
                          text-[16px] font-extrabold text-accent flex-shrink-0">
            {name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="font-extrabold text-[15px]">{profile.name}</div>
            <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-ink-3 flex-wrap">
              {profile.lwsId && (
                <span className="bg-surface-2 border border-border px-2 py-0.5 rounded">{profile.lwsId}</span>
              )}
              {profile.gender && <span>{profile.gender === 'Male' ? '♂' : '♀'} {profile.gender}</span>}
              {profile.dob && <span>DOB: {profile.dob}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[12px]">
            {profile.batches?.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Batch</div>
                {profile.batches.map(b => (
                  <span key={b} className="bg-surface-2 border border-border text-[11px] font-mono px-2 py-0.5 rounded mr-1">{b}</span>
                ))}
              </div>
            )}
            {profile.branch && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Branch</div>
                <span className="font-semibold">{profile.branch}</span>
              </div>
            )}
            {profile.mobile && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Mobile</div>
                <span>{profile.mobile}</span>
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Status</div>
              <Badge variant={profile.accountStatus === 'Active' ? 'green' : 'yellow'}>
                {profile.accountStatus || '—'}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Latest Score"
          value={latest.score}
          color={latest.pct >= 0.7 ? 'text-success' : latest.pct >= 0.45 ? 'text-warning' : 'text-danger'}
          delta={delta !== null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} from prev` : null}
          deltaUp={delta >= 0}
        />
        <StatCard
          label="Exams Taken"
          value={examData.length}
          color="text-accent"
        />
        <StatCard
          label="Attempt Quality"
          value={aq !== null ? `${(aq * 100).toFixed(0)}%` : '—'}
          color={aq === null ? 'text-ink-3' : aq >= 0.8 ? 'text-success' : aq >= 0.6 ? 'text-warning' : 'text-danger'}
          delta={aq !== null ? 'correct ÷ attempted' : null}
          deltaUp={null}
        />
        <StatCard
          label="Consistency"
          value={consistency ? consistency.label : examData.length < 2 ? 'Need 2+ exams' : '—'}
          color={
            !consistency ? 'text-ink-3' :
            consistency.color === 'success' ? 'text-success' :
            consistency.color === 'warning' ? 'text-warning' : 'text-danger'
          }
          delta={consistency ? `σ = ${(consistency.sd * 100).toFixed(0)}%` : null}
          deltaUp={null}
        />
      </div>

      {/* Projected NDA Score */}
      {projected.total > 0 && (
        <Card>
          <CardTitle>🎯 Projected NDA Maths Score</CardTitle>
          <div className="flex items-end gap-4 mb-4 flex-wrap">
            <div>
              <div className="text-[42px] font-extrabold tracking-tight leading-none"
                   style={{ color: projected.total >= 200 ? '#16a34a' : projected.total >= 150 ? '#d97706' : projected.total >= 100 ? '#f59e0b' : '#e03e3e' }}>
                {projected.total}
              </div>
              <div className="text-[12px] text-ink-3 mt-1">out of 300</div>
            </div>
            <div className="flex-1 min-w-[200px] pb-1">
              <div className="bg-surface-2 rounded-full h-3 overflow-hidden mb-1">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min((projected.total / 300) * 100, 100)}%`,
                    background: projected.total >= 200 ? '#16a34a' : projected.total >= 150 ? '#d97706' : projected.total >= 100 ? '#f59e0b' : '#e03e3e'
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-ink-3 mt-1">
                <span>0</span>
                <span className="text-orange-400">100 SSB safe</span>
                <span className="text-warning">150 merit</span>
                <span className="text-success">200 rank</span>
                <span>300</span>
              </div>
            </div>
          </div>

          {/* Chapter breakdown — top opportunities */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
              Biggest Opportunities — chapters with highest marks at stake
            </div>
            <div className="space-y-1.5">
              {projected.breakdown.slice(0, 6).map(ch => (
                <div key={ch.chapter} className="flex items-center gap-3">
                  <div className="w-[140px] md:w-[180px] text-[11px] text-ink-2 truncate flex-shrink-0">
                    {ch.chapter}
                  </div>
                  <div className="flex-1 bg-surface-2 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${ch.marksAtStake > 0 ? (ch.projected / ch.marksAtStake) * 100 : 0}%`,
                        background: scoreBg(ch.accuracy || 0)
                      }}
                    />
                  </div>
                  <div className="text-[11px] font-mono flex-shrink-0 text-right w-24">
                    <span style={{ color: scoreBg(ch.accuracy || 0) }} className="font-bold">
                      {ch.projected.toFixed(1)}
                    </span>
                    <span className="text-ink-3"> / {ch.marksAtStake.toFixed(1)}</span>
                  </div>
                  {ch.accuracy === null && (
                    <span className="text-[10px] text-ink-3 italic flex-shrink-0">not tested</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10px] text-ink-3 leading-relaxed">
              Based on your accuracy per chapter × NDA weightage. Edit weightages in Dashboard → NDA Frequency Table.
            </div>
          </div>
        </Card>
      )}

      {/* Wrong Answer Audit */}
      {wrongAudit.length > 0 && (
        <Card>
          <CardTitle>🔴 Wrong Answer Audit</CardTitle>
          <div className="text-[12px] text-ink-3 mb-3">
            Subtopics sorted by wrong answer count — your highest-priority revision targets.
          </div>
          <div className="space-y-2">
            {wrongAudit.slice(0, 8).map((item, i) => (
              <div key={`${item.chapter}-${item.subtopic}`}
                   className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <span className="text-[11px] font-mono text-ink-3 w-5 flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-ink truncate">{item.subtopic}</div>
                  <div className="text-[10px] text-ink-3">{item.chapter}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-mono font-bold text-danger bg-red-50
                                   px-2 py-0.5 rounded-full">
                    {item.wrong} ❌
                  </span>
                  <div className="w-16 bg-surface-2 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-danger"
                      style={{ width: `${(item.wrongRate * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-ink-3 w-8 text-right">
                    {(item.wrongRate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          {wrongAudit.length > 8 && (
            <div className="mt-3 text-[11px] text-ink-3">
              +{wrongAudit.length - 8} more subtopics with wrong answers
            </div>
          )}
        </Card>
      )}

      {/* Chapter accordion */}
      <Card>
        <CardTitle>
          Chapter Performance (Recency-Weighted)
          <span className="ml-2 text-[9px] normal-case tracking-normal text-ink-3 font-normal">
            — click a chapter to expand subtopics
          </span>
        </CardTitle>
        <ChapterAccordion chapterSummary={chapterSummary} name={name} exams={exams} />
      </Card>

      {/* Exam history */}
      <Card>
        <CardTitle>Exam History</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left border-b border-border">
                {['Exam', 'Date', 'Score', '✅', '❌', '⬜', '%'].map(h => (
                  <th key={h} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                  <td className="py-2 pr-4 font-medium">{s.name}</td>
                  <td className="py-2 pr-4 font-mono text-ink-3">{s.date}</td>
                  <td className="py-2 pr-4 font-bold">{s.score}</td>
                  <td className="py-2 pr-4 text-success font-mono">{s.correct}</td>
                  <td className="py-2 pr-4 text-danger font-mono">{s.wrong}</td>
                  <td className="py-2 pr-4 text-ink-3 font-mono">{s.na}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={s.pct >= 0.7 ? 'green' : s.pct >= 0.45 ? 'yellow' : 'red'}>
                      {(s.pct * 100).toFixed(0)}%
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Improvement plan */}
      <Card>
        <CardTitle>Improvement Plan</CardTitle>
        {savedPlan ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <Badge variant="green">✅ Saved {new Date(savedPlan.generatedAt).toLocaleDateString('en-IN')}</Badge>
            </div>
            <div className="bg-surface-2 border border-border rounded-xl p-4 text-[13px]
                            leading-relaxed text-ink whitespace-pre-wrap font-sans max-h-[500px] overflow-y-auto">
              {savedPlan.text}
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">
            No plan saved yet. Export your data, upload to Claude, and import the enriched JSON.
          </p>
        )}
      </Card>
    </div>
  )
}

// ── Chapter Accordion ─────────────────────────────────────────
import { useState } from 'react'
import QuestionCard from '../../components/ui/QuestionCard'

// Format date from YYYY-MM-DD to "Mar 21" or "Mar 21, 2026"
function fmtDate(dateStr, includeYear = false) {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const mon = d.toLocaleString('en-IN', { month: 'short' })
    const day = d.getDate()
    return includeYear ? `${mon} ${day}, ${d.getFullYear()}` : `${mon} ${day}`
  } catch { return dateStr }
}

function ChapterAccordion({ chapterSummary, name, exams }) {
  const [openChapters, setOpenChapters]   = useState({})
  const [openWrong, setOpenWrong]         = useState({})
  const [openSkipped, setOpenSkipped]     = useState({})

  const toggleChapter  = ch  => setOpenChapters(o => ({ ...o, [ch]:  !o[ch]  }))
  const toggleWrong    = key => setOpenWrong(o    => ({ ...o, [key]: !o[key] }))
  const toggleSkipped  = key => setOpenSkipped(o  => ({ ...o, [key]: !o[key] }))

  // Returns { wrong: [{qObj, examName, examDate}], skipped: [...] }
  // grouped by exam for display
  function getSubtopicQuestions(ch, sub) {
    const wrong = []
    const skipped = []
    exams.forEach(exam => {
      const student = exam.students.find(s => s.name === name)
      if (!student) return
      exam.questions.forEach(q => {
        if (q.chapter !== ch || q.subtopic !== sub) return
        const resp = student.responses?.[q.q]
        if (resp === -1) {
          wrong.push({ qObj: q, examName: exam.name, examDate: exam.date, examId: exam.id, studentResult: -1 })
        } else if (resp === 0) {
          skipped.push({ qObj: q, examName: exam.name, examDate: exam.date, examId: exam.id, studentResult: 0 })
        }
      })
    })
    return { wrong, skipped }
  }

  // Group an array of questions by examName
  function groupByExam(qs) {
    const map = {}
    qs.forEach(item => {
      const key = `${item.examName}||${item.examDate}`
      if (!map[key]) map[key] = { examName: item.examName, examDate: item.examDate, examId: item.examId, items: [] }
      map[key].items.push(item)
    })
    return Object.values(map)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {chapterSummary.map(({ ch, avg, trend, subs }) => (
        <div key={ch}>

          {/* ── Chapter row ─────────────────────────────── */}
          <div
            className="flex items-center gap-2.5 py-2 cursor-pointer group"
            onClick={() => toggleChapter(ch)}
          >
            <div className="w-[175px] min-w-[175px] text-[12.5px] text-ink font-semibold
                            flex items-center gap-1.5 truncate">
              <span
                className="text-[10px] text-ink-3 inline-block transition-transform duration-200 flex-shrink-0"
                style={{ transform: openChapters[ch] ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >▶</span>
              <span className="truncate">{ch}</span>
              <span className="text-[9px] text-ink-3 font-normal font-mono flex-shrink-0">
                ({Object.keys(subs).length})
              </span>
            </div>
            <div className="flex-1 bg-surface-2 rounded-full h-6 overflow-hidden">
              {avg > 0 && (
                <div
                  className="h-full rounded-full flex items-center px-2.5 transition-all duration-500"
                  style={{ width: `${avg * 100}%`, background: scoreBg(avg) }}
                >
                  <span className="text-[10px] font-mono font-bold text-white drop-shadow">
                    {(avg * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
            <Badge variant={TREND_COLOR[trend]}>
              {TREND_ICON[trend]} {trend}
            </Badge>
          </div>

          {/* ── Subtopic cards ───────────────────────────── */}
          {openChapters[ch] && (
            <div className="flex flex-col gap-2.5 mb-3 ml-4">
              {Object.entries(subs)
                .sort((a, b) => a[1].weightedScore - b[1].weightedScore)
                .map(([sub, data]) => {
                  const subKey        = `${ch}::${sub}`
                  const { wrong, skipped } = getSubtopicQuestions(ch, sub)
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
                          <Badge variant={TREND_COLOR[data.trend]}>
                            {TREND_ICON[data.trend]} {data.trend}
                          </Badge>
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
                                {group.items.map(({ qObj, studentResult }) => (
                                  <QuestionCard
                                    key={`Q${qObj.q}`}
                                    q={qObj}
                                    examId={group.examId}
                                    studentAnswer={null}
                                    studentResult={studentResult}
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
      ))}
    </div>
  )
}
