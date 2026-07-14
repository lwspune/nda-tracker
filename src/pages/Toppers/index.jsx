import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { EmptyState, StatCard } from '../../components/ui'
import {
  getToppers, getValidStudentNames,
  getStudentExams, filterValidExams,
  computeProjectedScore, getBatchOptions, getExamsForBatch, getBatchMemberNames
} from '../../lib/analytics'
import { getFreqForSubject } from '../../lib/ndaFreq'
import { useMode } from '../../context/ModeContext'
import TopperCard, { ToppersPageHeader } from './TopperCard'
import { getPrimarySubject, SORT_OPTIONS } from './toppersHelpers'

export default function ToppersPage() {
  const exams              = useStore(s => s.exams)
  const ndaFreqBySubject   = useStore(s => s.ndaFreqBySubject)
  const ndaMarksBySubject  = useStore(s => s.ndaMarksBySubject)
  const studentProfiles    = useStore(s => s.studentProfiles)
  const setActiveStudent = useStore(s => s.setActiveStudent)

  const [threshold, setThreshold]     = useState(60)  // minimum projected marks
  const [batchFilter, setBatchFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('Maths')  // Maths is the main NDA paper; projection is per-subject
  const [sortBy, setSortBy]           = useState('projected')

  const mode = useMode()

  // ── All computations and hooks BEFORE early returns (Rules of Hooks) ──────────
  // When exams=[], these produce empty arrays/null — safe to compute unconditionally.

  // Batch filter — derived from profile.batches[] (primary)
  const allBatches = getBatchOptions(exams, studentProfiles)
  const batchFiltered = batchFilter === 'all'
    ? exams
    : getExamsForBatch(exams, studentProfiles, batchFilter)

  // Subject filter — derived from exams actually present.
  // Default is 'Maths'; if the selected scope has no Maths exams, snap to 'all'
  // so the dropdown value matches the rendered set (mirrors StudentView's
  // effectiveFilter — avoids a select showing 'All' while state stays 'Maths').
  const allSubjects = [...new Set(batchFiltered.map(e => e.subject || 'Maths'))].sort()
  const effectiveSubject = subjectFilter === 'all' || allSubjects.includes(subjectFilter)
    ? subjectFilter
    : 'all'
  const filteredExams = effectiveSubject === 'all'
    ? batchFiltered
    : batchFiltered.filter(e => (e.subject || 'Maths') === effectiveSubject)

  // Resolve freq for the active subject.
  // When 'all', use the most common subject so projected scores are meaningful.
  const activeSubject = effectiveSubject === 'all'
    ? getPrimarySubject(filteredExams)
    : effectiveSubject
  const ndaFreq    = getFreqForSubject(ndaFreqBySubject, activeSubject)
  const hasFreqData = ndaFreq.length > 0
  const subjectMaxScore = ndaMarksBySubject?.[activeSubject] ?? 300
  // Gate threshold is projected MARKS; clamp to the active subject's ceiling so a
  // stale value from a larger-max subject can't silently empty the list.
  const marksThreshold = Math.min(threshold, subjectMaxScore)

  // Valid students: those whose matched profile has a regDate, AND — when a batch
  // is selected — who are CURRENT members of that batch (not just co-attendees of
  // its exams). This makes the batch filter student-centric / move-robust: a
  // student who moved into the batch shows up with their full history; a
  // cross-cohort co-attendee of a combined exam is excluded.
  // null when no profiles imported AND no batch filter — no filtering applied.
  const validNames = useMemo(() => {
    const hasProfiles = Object.keys(studentProfiles).length > 0
    let base = hasProfiles ? getValidStudentNames(filteredExams, studentProfiles) : null
    if (batchFilter !== 'all') {
      const members = getBatchMemberNames(studentProfiles, batchFilter)
      base = base === null ? members : new Set([...base].filter(n => members.has(n)))
    }
    return base
  }, [filteredExams, studentProfiles, batchFilter])

  // Build case-insensitive name → profile map for regDate lookups in enrichment
  const profileMap = useMemo(() => {
    const map = {}
    Object.values(studentProfiles).forEach(p => {
      if (p.name) map[p.name.toLowerCase()] = p
      ;(p.nameVariants || []).forEach(v => { if (v) map[v.toLowerCase()] = p })
    })
    return map
  }, [studentProfiles])

  // Get toppers above threshold — scoped to valid students, per-student regDate filtering inside
  const rawToppers = useMemo(
    () => getToppers(filteredExams, ndaFreq, marksThreshold, subjectMaxScore,
      { validNames, studentProfiles }),
    [filteredExams, ndaFreq, marksThreshold, subjectMaxScore, validNames, studentProfiles]
  )

  // Enrich each topper with batch + biggest opportunity.
  // computeProjectedScore is re-run here for the breakdown; we scope it to the same
  // post-registration exams that getToppers used so the numbers are consistent.
  const toppers = useMemo(() => rawToppers.map(t => {
    const profile = studentProfiles[t.name] || profileMap[t.name.toLowerCase()]
    const batch = profile?.batches?.[0] || null

    // Scope to post-registration exams for this student (mirrors getToppers logic)
    const allStudentExams = getStudentExams(t.name, filteredExams)
    const validStudentExams = profile?.regDate
      ? filterValidExams(allStudentExams, profile.regDate)
      : allStudentExams
    const validIds    = new Set(validStudentExams.map(({ exam }) => exam.id))
    const scopedExams = filteredExams.filter(e => validIds.has(e.id))

    // Biggest opportunity = chapter with largest gap (marks at stake - projected)
    const projected = computeProjectedScore(t.name, scopedExams, ndaFreq, subjectMaxScore)
    const biggestOpp = projected.breakdown
      .filter(ch => ch.accuracy !== null)
      .sort((a, b) => b.gap - a.gap)[0] || null

    return { ...t, batch, biggestOpp, projectedBreakdown: projected.breakdown }
  }), [rawToppers, studentProfiles, profileMap, filteredExams, ndaFreq, subjectMaxScore])

  // ── Early returns AFTER all hooks ─────────────────────────────────────────────
  // Students can't see Toppers
  if (mode === 'student') return null

  if (!exams.length) {
    return (
      <div>
        <ToppersPageHeader subject="Maths" />
        <EmptyState icon="🏆" title="No data yet" sub="Add exams to see toppers" />
      </div>
    )
  }

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
      <ToppersPageHeader subject={activeSubject} />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Threshold */}
        <div className="flex items-center gap-2">
          <label className="text-[12px] font-semibold text-ink-2 whitespace-nowrap">
            Min projected:
          </label>
          <input
            type="number"
            min="0" max={subjectMaxScore} step="5"
            value={threshold}
            onChange={e => setThreshold(Math.min(subjectMaxScore, Math.max(0, parseInt(e.target.value) || 0)))}
            className="w-16 text-center form-input text-[13px] font-mono font-bold"
          />
          <span className="text-[12px] text-ink-3">/ {subjectMaxScore} marks</span>
        </div>

        {/* Subject filter */}
        {allSubjects.length > 1 && (
          <select
            value={effectiveSubject}
            onChange={e => setSubjectFilter(e.target.value)}
            className="form-input w-auto text-[13px] cursor-pointer"
          >
            <option value="all">All Subjects</option>
            {allSubjects.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

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
          <span className="font-bold text-ink">{toppers.length}</span> student{toppers.length !== 1 ? 's' : ''} projected ≥ {marksThreshold}
        </div>
      </div>

      {/* Summary stats */}
      {toppers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Toppers"       value={toppers.length}         color="text-accent" />
          {hasFreqData ? (
            <StatCard
              label={`Avg Projected (${activeSubject})`}
              value={`${avgProjected}/${subjectMaxScore}`}
              color={avgProjected >= subjectMaxScore * 0.67 ? 'text-success' : avgProjected >= subjectMaxScore * 0.5 ? 'text-warning' : 'text-danger'}
            />
          ) : (
            <StatCard label="Projected Score" value="—" color="text-ink-3" />
          )}
          <StatCard label="Avg Quality"   value={avgAQ !== null ? `${(avgAQ * 100).toFixed(0)}%` : '—'} color="text-indigo-400" />
          <StatCard label="Threshold"     value={`${marksThreshold}/${subjectMaxScore}`} color="text-ink-2" />
        </div>
      )}

      {/* Topper cards */}
      {sorted.length === 0 ? (
        <EmptyState
          icon="🎯"
          title={`No students projected ≥ ${marksThreshold}`}
          sub="Try lowering the threshold"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((topper, i) => (
            <TopperCard
              key={topper.name}
              rank={i + 1}
              topper={topper}
              hasFreqData={hasFreqData}
              subjectMaxScore={subjectMaxScore}
              onOpen={() => setActiveStudent(topper.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
