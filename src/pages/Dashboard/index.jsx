import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { EmptyState, PageHeader, Card, CardTitle, HeatBar, Badge } from '../../components/ui'
import {
  computeChapterStats, getAtRisk, getHardestQuestions, getAllStudents, getValidStudentNames,
  getBatchOptions, getExamsForBatch, computeTrend,
  getPerformanceSeries, getClassProjectedAvg, getPriorityChapters, getBatchComparison,
} from '../../lib/analytics'
import { getFreqForSubject, NDA_TOTAL_MARKS_BY_SUBJECT } from '../../lib/ndaFreq'
import KpiStrip from './KpiStrip'
import PerformanceTrend from './PerformanceTrend'
import PriorityChapters from './PriorityChapters'
import BatchComparison from './BatchComparison'

export default function DashboardPage() {
  const exams              = useStore(s => s.exams)
  const ndaFreqBySubject   = useStore(s => s.ndaFreqBySubject)
  const ndaMarksBySubject  = useStore(s => s.ndaMarksBySubject)
  const studentProfiles    = useStore(s => s.studentProfiles)
  const setActiveStudent   = useStore(s => s.setActiveStudent)

  const [subjectFilter, setSubjectFilter] = useState('all')
  const [branchFilter, setBranchFilter]   = useState('all')
  const [batchFilter, setBatchFilter]     = useState('all')
  const [filterVal, setFilterVal]         = useState('all')

  // ── Filter chain — computed unconditionally (hooks must not come after early returns) ──
  const availableSubjects = [...new Set(exams.map(e => e.subject || 'Maths'))].sort()

  const subjectFiltered = subjectFilter === 'all'
    ? exams
    : exams.filter(e => (e.subject || 'Maths') === subjectFilter)

  const allBranches = [...new Set(subjectFiltered.map(e => e.branch).filter(Boolean))].sort()

  const branchFiltered = branchFilter === 'all'
    ? subjectFiltered
    : subjectFiltered.filter(e => e.branch === branchFilter)

  const allBatches = getBatchOptions(branchFiltered, studentProfiles)

  const batchFiltered = batchFilter === 'all'
    ? branchFiltered
    : getExamsForBatch(branchFiltered, studentProfiles, batchFilter)

  const filtered = filterVal === 'all'
    ? batchFiltered
    : batchFiltered.filter(e => e.id === filterVal)

  const validNames = useMemo(() => {
    if (!Object.keys(studentProfiles).length) return null
    return getValidStudentNames(filtered, studentProfiles)
  }, [filtered, studentProfiles])

  // Subject whose weightage table drives projection + priority chapters.
  const prioritySubject = subjectFilter === 'all' ? 'Maths' : subjectFilter
  const freq      = getFreqForSubject(ndaFreqBySubject, prioritySubject)
  const totalMarks = ndaMarksBySubject?.[prioritySubject] ?? NDA_TOTAL_MARKS_BY_SUBJECT[prioritySubject] ?? 300

  if (!exams.length) {
    return (
      <div>
        <PageHeader title="Dashboard" sub="Overview of class performance across all exams" />
        <EmptyState icon="📊" title="No data yet" sub="Add your first exam to see the dashboard" />
      </div>
    )
  }

  const students     = getAllStudents(filtered, validNames)
  const chapterStats = computeChapterStats(filtered, validNames)
  const atRisk       = getAtRisk(filtered, validNames)
  const hardest      = getHardestQuestions(filtered, 8, validNames)
  const totalInExams = validNames !== null ? getAllStudents(filtered).length : null

  // Performance over time + KPI deltas (class avg %-of-max per exam, chronological)
  const series       = getPerformanceSeries(filtered, validNames)
  const classTrend   = computeTrend(series.map(p => p.avgPct))
  const latestPct    = series.length ? series[series.length - 1].avgPct : null
  const prevPct      = series.length >= 2 ? series[series.length - 2].avgPct : null

  // At-risk change vs the class state before the most recent exam
  const sortedByDate = [...filtered].sort((a, b) => a.date.localeCompare(b.date))
  const atRiskPrior  = sortedByDate.length >= 2
    ? getAtRisk(sortedByDate.slice(0, -1), validNames).length
    : null

  // Class projected NDA score (subject-scoped to prioritySubject)
  const prioritySubjectExams = subjectFilter === 'all'
    ? filtered.filter(e => (e.subject || 'Maths') === prioritySubject)
    : filtered
  const projected = getClassProjectedAvg(prioritySubjectExams, freq, totalMarks, { validNames, studentProfiles })

  // Weak × high-yield priorities + per-batch comparison
  const priorityRows = getPriorityChapters(prioritySubjectExams, freq, totalMarks, { validNames })
  const batchRows    = getBatchComparison(prioritySubjectExams, studentProfiles, freq, totalMarks)

  const chapterRows = Object.entries(chapterStats).map(([ch, subs]) => {
    let correct = 0, total = 0
    Object.values(subs).forEach(s => { correct += s.correct; total += s.total })
    return { name: ch, pct: total > 0 ? correct / total : 0, correct, total }
  }).sort((a, b) => a.pct - b.pct)

  const selectCls = 'form-input w-auto text-[13px] pr-8 cursor-pointer'

  return (
    <div>
      {/* Header + filters */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 md:mb-7">
        <div>
          <h1 className="text-[24px] font-extrabold text-ink tracking-tight leading-tight">Dashboard</h1>
          <p className="text-[13px] text-ink-2 mt-1">Class performance overview</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            aria-label="Subject filter"
            value={subjectFilter}
            onChange={e => { setSubjectFilter(e.target.value); setBranchFilter('all'); setBatchFilter('all'); setFilterVal('all') }}
            className={selectCls} style={{ minWidth: '160px' }}
          >
            <option value="all">All Subjects</option>
            {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {allBranches.length > 0 && (
            <select
              aria-label="Branch filter"
              value={branchFilter}
              onChange={e => { setBranchFilter(e.target.value); setBatchFilter('all'); setFilterVal('all') }}
              className={selectCls} style={{ minWidth: '160px' }}
            >
              <option value="all">All Branches</option>
              {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {allBatches.length > 0 && (
            <select
              aria-label="Batch filter"
              value={batchFilter}
              onChange={e => { setBatchFilter(e.target.value); setFilterVal('all') }}
              className={selectCls} style={{ minWidth: '180px' }}
            >
              <option value="all">All Batches</option>
              {allBatches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select
            aria-label="Exam filter"
            value={filterVal}
            onChange={e => setFilterVal(e.target.value)}
            className={selectCls} style={{ minWidth: '220px' }}
          >
            <option value="all">All Exams</option>
            {[...batchFiltered].reverse().map(e => (
              <option key={e.id} value={e.id}>{e.name} · {e.date}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI strip */}
      <KpiStrip
        registered={validNames !== null}
        studentsCount={students.length}
        totalInExams={totalInExams}
        latestPct={latestPct}
        prevPct={prevPct}
        projectedAvg={projected.avg}
        projectedCount={projected.count}
        atRiskNow={atRisk.length}
        atRiskPrior={atRiskPrior}
      />

      {/* Performance over time */}
      <div className="mb-4 md:mb-5">
        <PerformanceTrend series={series} trend={classTrend} />
      </div>

      {/* Priority chapters + Batch comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 mb-4 md:mb-5">
        <PriorityChapters rows={priorityRows} subject={prioritySubject} />
        {batchRows.length > 1
          ? <BatchComparison rows={batchRows} />
          : (
            <Card>
              <CardTitle>Chapter Performance — Class Average</CardTitle>
              <div className="flex flex-col gap-1.5">
                {chapterRows.length === 0
                  ? <p className="text-[12px] text-ink-3">No chapter data for this filter.</p>
                  : chapterRows.map(ch => (
                    <HeatBar key={ch.name} pct={ch.pct} label={ch.name} count={`${ch.correct}/${ch.total}`} />
                  ))
                }
              </div>
            </Card>
          )}
      </div>

      {/* Chapter heatmap (when batch comparison took the slot above) + At-risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 mb-4 md:mb-5">
        {batchRows.length > 1 && (
          <Card>
            <CardTitle>Chapter Performance — Class Average</CardTitle>
            <div className="flex flex-col gap-1.5">
              {chapterRows.length === 0
                ? <p className="text-[12px] text-ink-3">No chapter data for this filter.</p>
                : chapterRows.map(ch => (
                  <HeatBar key={ch.name} pct={ch.pct} label={ch.name} count={`${ch.correct}/${ch.total}`} />
                ))
              }
            </div>
          </Card>
        )}

        <Card>
          <CardTitle>⚠️ At-Risk Students (Weak in 2+ Chapters)</CardTitle>
          {atRisk.length === 0 ? (
            <p className="text-[12px] text-ink-3 py-4">No at-risk students — great performance!</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {atRisk.slice(0, 12).map(s => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setActiveStudent(s.name)}
                  className="flex items-center justify-between py-2 text-left hover:bg-surface-2 rounded
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={`Open ${s.name} — weak in ${s.count} chapters`}
                >
                  <div>
                    <div className="text-[12px] font-semibold text-ink">{s.name}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.weakChapters.slice(0, 3).map(c => (
                        <span key={c} className="text-[10px] font-mono bg-red-50 text-danger px-2 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  </div>
                  <Badge variant="red">{s.count} weak</Badge>
                </button>
              ))}
              {atRisk.length > 12 && (
                <p className="text-[11px] text-ink-3 pt-2">+{atRisk.length - 12} more</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Hardest questions */}
      <Card className="mb-5">
        <CardTitle>🔴 Hardest Questions</CardTitle>
        {hardest.length === 0
          ? <p className="text-[12px] text-ink-3">No question data for this filter.</p>
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left border-b border-border">
                  {[
                    { label: 'Exam', cls: '' },
                    { label: 'Q#', cls: '' },
                    { label: 'Chapter', cls: '' },
                    { label: 'Subtopic', cls: 'hidden sm:table-cell' },
                    { label: 'Score', cls: '' },
                    { label: 'Difficulty', cls: 'hidden sm:table-cell' },
                  ].map(h => (
                    <th key={h.label} className={`text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-4 ${h.cls}`}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hardest.map((q, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                    <td className="py-2 pr-4 text-ink-3 text-[11px]">{q.examName}</td>
                    <td className="py-2 pr-4 font-mono">Q{q.q}</td>
                    <td className="py-2 pr-4 font-medium">{q.chapter}</td>
                    <td className="py-2 pr-4 text-ink-2 hidden sm:table-cell">{q.subtopic}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full"
                               style={{ width: `${(q.pct*100).toFixed(0)}%`,
                                        background: q.pct < 0.3 ? '#e03e3e' : q.pct < 0.6 ? '#d97706' : '#16a34a' }} />
                        </div>
                        <span className="font-mono text-[10px]">{(q.pct*100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2 hidden sm:table-cell">
                      <Badge variant={q.pct < 0.3 ? 'red' : q.pct < 0.6 ? 'yellow' : 'green'}>
                        {q.pct < 0.3 ? 'Hard' : q.pct < 0.6 ? 'Medium' : 'Easy'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
