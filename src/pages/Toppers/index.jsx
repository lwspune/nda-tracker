import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { Card, CardTitle, Badge, EmptyState, StatCard } from '../../components/ui'
import {
  getToppers, computeProjectedScore, computeAttemptQuality,
  computeConsistency, scoreBg
} from '../../lib/analytics'
import { getAllBatches } from '../../lib/matchStudents'
import { IS_READ_ONLY } from '../../config'

const SORT_OPTIONS = [
  { value: 'projected',      label: 'Projected Score' },
  { value: 'avgPct',         label: 'Average %' },
  { value: 'attemptQuality', label: 'Attempt Quality' },
]

const CONSISTENCY_COLOR = {
  success: 'text-success',
  warning: 'text-warning',
  danger:  'text-danger',
}

export default function ToppersPage() {
  const exams           = useStore(s => s.exams)
  const ndaFreq         = useStore(s => s.ndaFreq)
  const studentProfiles = useStore(s => s.studentProfiles)
  const setActiveStudent = useStore(s => s.setActiveStudent)

  const [threshold, setThreshold]   = useState(50)
  const [batchFilter, setBatchFilter] = useState('all')
  const [sortBy, setSortBy]         = useState('projected')

  // Faculty-only guard
  if (IS_READ_ONLY) return null

  if (!exams.length) {
    return (
      <div>
        <PageHeader />
        <EmptyState icon="🏆" title="No data yet" sub="Add exams to see toppers" />
      </div>
    )
  }

  // Batch filter — use batches from exam tags
  const allBatches = [...new Set(exams.map(e => e.batch).filter(Boolean))]
  const filteredExams = batchFilter === 'all'
    ? exams
    : exams.filter(e => e.batch === batchFilter)

  // Get toppers above threshold
  const rawToppers = useMemo(
    () => getToppers(filteredExams, ndaFreq, threshold / 100),
    [filteredExams, ndaFreq, threshold]
  )

  // Enrich each topper with batch + biggest opportunity
  const toppers = useMemo(() => rawToppers.map(t => {
    const profile = studentProfiles[t.name] ||
      Object.values(studentProfiles).find(p => p.name?.toLowerCase() === t.name.toLowerCase())
    const batch = profile?.batches?.[0] || null

    // Biggest opportunity = chapter with largest gap (marks at stake - projected)
    const projected = computeProjectedScore(t.name, filteredExams, ndaFreq)
    const biggestOpp = projected.breakdown
      .filter(ch => ch.accuracy !== null)
      .sort((a, b) => b.gap - a.gap)[0] || null

    return { ...t, batch, biggestOpp, projectedBreakdown: projected.breakdown }
  }), [rawToppers, studentProfiles, filteredExams, ndaFreq])

  // Sort
  const sorted = [...toppers].sort((a, b) => {
    if (sortBy === 'projected')      return b.projected - a.projected
    if (sortBy === 'avgPct')         return b.avgPct - a.avgPct
    if (sortBy === 'attemptQuality') return (b.attemptQuality || 0) - (a.attemptQuality || 0)
    return 0
  })

  // Summary stats
  const avgProjected = toppers.length
    ? Math.round(toppers.reduce((s, t) => s + t.projected, 0) / toppers.length)
    : 0
  const avgAQ = toppers.filter(t => t.attemptQuality !== null).length
    ? toppers.filter(t => t.attemptQuality !== null)
        .reduce((s, t) => s + t.attemptQuality, 0) /
      toppers.filter(t => t.attemptQuality !== null).length
    : null

  return (
    <div>
      <PageHeader />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Threshold */}
        <div className="flex items-center gap-2">
          <label className="text-[12px] font-semibold text-ink-2 whitespace-nowrap">
            Threshold:
          </label>
          <input
            type="number"
            min="1" max="100" step="5"
            value={threshold}
            onChange={e => setThreshold(Math.min(100, Math.max(1, parseInt(e.target.value) || 50)))}
            className="w-16 text-center form-input text-[13px] font-mono font-bold"
          />
          <span className="text-[12px] text-ink-3">% avg score</span>
        </div>

        {/* Batch filter */}
        {allBatches.length > 0 && (
          <select
            value={batchFilter}
            onChange={e => setBatchFilter(e.target.value)}
            className="form-input w-auto text-[13px] cursor-pointer"
          >
            <option value="all">All Batches</option>
            {allBatches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="form-input w-auto text-[13px] cursor-pointer"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>Sort: {o.label}</option>
          ))}
        </select>

        <div className="ml-auto text-[12px] text-ink-3 font-mono">
          <span className="font-bold text-ink">{toppers.length}</span> student{toppers.length !== 1 ? 's' : ''} above {threshold}%
        </div>
      </div>

      {/* Summary stats */}
      {toppers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Toppers"         value={toppers.length}           color="text-accent" />
          <StatCard label="Avg Projected"   value={`${avgProjected}/300`}    color={avgProjected >= 200 ? 'text-success' : avgProjected >= 150 ? 'text-warning' : 'text-danger'} />
          <StatCard label="Avg Quality"     value={avgAQ !== null ? `${(avgAQ * 100).toFixed(0)}%` : '—'} color="text-indigo-400" />
          <StatCard label="Threshold"       value={`${threshold}%`}          color="text-ink-2" />
        </div>
      )}

      {/* Topper cards */}
      {sorted.length === 0 ? (
        <EmptyState
          icon="🎯"
          title={`No students above ${threshold}%`}
          sub="Try lowering the threshold"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((topper, i) => (
            <TopperCard
              key={topper.name}
              rank={i + 1}
              topper={topper}
              onOpen={() => setActiveStudent(topper.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Topper Card ───────────────────────────────────────────────
function TopperCard({ rank, topper, onOpen }) {
  const { name, avgPct, projected, attemptQuality, consistency, batch, biggestOpp } = topper

  const projColor = projected >= 200 ? '#16a34a' : projected >= 150 ? '#d97706' : projected >= 100 ? '#f59e0b' : '#e03e3e'
  const rankColor = rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-amber-600' : 'text-ink-3'
  const rankBg    = rank === 1 ? 'bg-yellow-50 border-yellow-200' : rank === 2 ? 'bg-slate-50 border-slate-200' : rank === 3 ? 'bg-amber-50 border-amber-200' : 'bg-surface-2 border-border'

  return (
    <div
      className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm
                 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-center gap-4 px-5 py-4 flex-wrap">

        {/* Rank */}
        <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center
                         flex-shrink-0 font-extrabold text-[15px] ${rankColor} ${rankBg}`}>
          {rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}
        </div>

        {/* Name + batch */}
        <div className="flex-1 min-w-[140px]">
          <div className="font-bold text-[14px] text-ink leading-tight">{name}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {batch && (
              <span className="text-[10px] font-mono text-accent bg-accent-soft
                               px-2 py-0.5 rounded-full border border-accent/20">
                {batch}
              </span>
            )}
            <span className="text-[11px] font-mono text-ink-3">
              avg {(avgPct * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Projected score */}
        <div className="flex flex-col items-center flex-shrink-0 min-w-[80px]">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1">
            Projected
          </div>
          <div className="text-[28px] font-extrabold leading-none" style={{ color: projColor }}>
            {projected}
          </div>
          <div className="text-[10px] text-ink-3 font-mono">/ 300</div>
        </div>

        {/* Mini score bar */}
        <div className="flex-1 min-w-[100px] max-w-[180px]">
          <div className="bg-surface-2 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min((projected / 300) * 100, 100)}%`, background: projColor }}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-ink-3 mt-0.5">
            <span>0</span>
            <span>100</span>
            <span>150</span>
            <span>200</span>
            <span>300</span>
          </div>
        </div>

        {/* AQS + Consistency */}
        <div className="flex flex-col gap-1.5 flex-shrink-0 min-w-[90px]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-3 w-16">Quality</span>
            <span className={`text-[12px] font-bold font-mono ${
              attemptQuality === null ? 'text-ink-3' :
              attemptQuality >= 0.8 ? 'text-success' :
              attemptQuality >= 0.6 ? 'text-warning' : 'text-danger'
            }`}>
              {attemptQuality !== null ? `${(attemptQuality * 100).toFixed(0)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-3 w-16">Consistency</span>
            <span className={`text-[11px] font-semibold ${
              consistency ? CONSISTENCY_COLOR[consistency.color] : 'text-ink-3'
            }`}>
              {consistency ? consistency.label : '—'}
            </span>
          </div>
        </div>

        {/* Biggest opportunity */}
        {biggestOpp && (
          <div className="flex-shrink-0 min-w-[120px] max-w-[160px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
              Biggest Opportunity
            </div>
            <div className="text-[11px] font-semibold text-ink truncate">{biggestOpp.chapter}</div>
            <div className="text-[10px] font-mono text-ink-3">
              +{biggestOpp.gap.toFixed(1)} marks available
            </div>
          </div>
        )}

        {/* Arrow */}
        <div className="text-ink-3 text-[16px] flex-shrink-0 ml-auto">→</div>
      </div>
    </div>
  )
}

// ── Page header ───────────────────────────────────────────────
function PageHeader() {
  return (
    <div className="mb-6">
      <h1 className="text-[24px] font-extrabold text-ink tracking-tight leading-tight">
        🏆 Topper Dashboard
      </h1>
      <p className="text-[13px] text-ink-2 mt-1">
        Students above threshold — ranked by projected NDA score
      </p>
    </div>
  )
}
