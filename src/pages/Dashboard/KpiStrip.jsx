import { StatCard } from '../../components/ui'

// Fixed KPI row. All values are store-derived (no fetch). The headline score is
// avg %-of-max on the latest exam (a comparable unit) with a delta vs the previous
// exam — replacing the old raw-totalMarks "Avg Score" which mixed paper sizes.
export default function KpiStrip({
  studentsCount, totalInExams, registered,
  latestPct, prevPct,
  projectedAvg, projectedCount,
  atRiskNow, atRiskPrior,
}) {
  // Latest-exam avg % with delta vs previous exam
  const hasPctDelta = latestPct != null && prevPct != null
  const pctDelta = hasPctDelta ? (latestPct - prevPct) * 100 : null

  // At-risk change vs the class state before the most recent exam (fewer = good)
  const hasRiskDelta = atRiskPrior != null
  const riskDelta = hasRiskDelta ? atRiskNow - atRiskPrior : null

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-6">
      <StatCard
        label={registered ? 'Registered' : 'Students'}
        value={studentsCount}
        color="text-accent"
        delta={totalInExams != null && totalInExams !== studentsCount ? `of ${totalInExams} in exams` : null}
        deltaUp={null}
      />

      <StatCard
        label="Latest Exam Avg"
        value={latestPct != null ? `${(latestPct * 100).toFixed(0)}%` : '—'}
        color="text-success"
        delta={pctDelta != null && Math.abs(pctDelta) >= 0.5 ? `${Math.abs(pctDelta).toFixed(0)} pts vs prev` : null}
        deltaUp={pctDelta != null ? pctDelta >= 0 : null}
      />

      <StatCard
        label="Avg Projected NDA"
        value={projectedCount > 0 ? projectedAvg : '—'}
        color="text-indigo-400"
        delta={projectedCount > 0 ? `${projectedCount} students` : null}
        deltaUp={null}
      />

      <StatCard
        label="At-Risk"
        value={atRiskNow}
        color="text-danger"
        // fewer at-risk than before the last exam is an improvement (green)
        delta={riskDelta != null && riskDelta !== 0 ? `${Math.abs(riskDelta)} ${riskDelta < 0 ? 'fewer' : 'more'} vs last exam` : null}
        deltaUp={riskDelta != null ? riskDelta < 0 : null}
      />
    </div>
  )
}
