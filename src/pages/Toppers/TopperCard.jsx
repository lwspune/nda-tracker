import { CONSISTENCY_COLOR } from './toppersHelpers'

// ── Topper Card ───────────────────────────────────────────────
export default function TopperCard({ rank, topper, hasFreqData, subjectMaxScore, onOpen }) {
  const { name, avgPct, projected, attemptQuality, consistency, batch, biggestOpp } = topper

  const projRatio  = subjectMaxScore > 0 ? projected / subjectMaxScore : 0
  const projColor  = projRatio >= 0.67 ? '#16a34a' : projRatio >= 0.5 ? '#d97706' : projRatio >= 0.33 ? '#f59e0b' : '#e03e3e'
  const rankColor  = rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-amber-600' : 'text-ink-3'
  const rankBg     = rank === 1 ? 'bg-yellow-50 border-yellow-200' : rank === 2 ? 'bg-slate-50 border-slate-200' : rank === 3 ? 'bg-amber-50 border-amber-200' : 'bg-surface-2 border-border'

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

        {/* Projected score — only when freq data is configured */}
        {hasFreqData && (
          <>
            <div className="hidden md:flex flex-col items-center flex-shrink-0 min-w-[80px]">
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                Projected
              </div>
              <div className="text-[28px] font-extrabold leading-none" style={{ color: projColor }}>
                {projected}
              </div>
              <div className="text-[10px] text-ink-3 font-mono">/ {subjectMaxScore}</div>
            </div>

            <div className="hidden md:block flex-1 min-w-[100px] max-w-[180px]">
              <div className="bg-surface-2 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(projRatio * 100, 100)}%`, background: projColor }}
                />
              </div>
              <div className="flex justify-between text-[7px] md:text-[9px] font-mono text-ink-3 mt-0.5">
                <span>0</span>
                <span>{Math.round(subjectMaxScore * 0.33)}</span>
                <span>{Math.round(subjectMaxScore * 0.5)}</span>
                <span>{Math.round(subjectMaxScore * 0.67)}</span>
                <span>{subjectMaxScore}</span>
              </div>
            </div>
          </>
        )}

        {/* AQS + Consistency */}
        <div className="hidden md:flex flex-col gap-1.5 flex-shrink-0 min-w-[90px]">
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
          <div className="hidden md:block flex-shrink-0 min-w-[120px] max-w-[160px]">
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
export function ToppersPageHeader({ subject }) {
  return (
    <div className="mb-6">
      <h1 className="text-[24px] font-extrabold text-ink tracking-tight leading-tight">
        🏆 Topper Dashboard
      </h1>
      <p className="text-[13px] text-ink-2 mt-1">
        Students above threshold — ranked by projected NDA {subject} score
      </p>
    </div>
  )
}
