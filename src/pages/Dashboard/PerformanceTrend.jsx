import { Card, CardTitle, Badge } from '../../components/ui'
import { scoreBg } from '../../lib/analytics'

// Hand-rolled SVG line chart of class average %-of-max over time (no chart lib —
// consistent with AttendanceRings/HeatBar). `series` is from getPerformanceSeries:
// [{ examId, name, date, avgPct, n }] already sorted oldest → newest.
// `trend` is an optional label from computeTrend ('improving' | 'declining' | …).

const W = 640, H = 230
const PAD = { top: 16, right: 16, bottom: 46, left: 34 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

const TREND_BADGE = {
  improving: { variant: 'green',  text: '▲ Improving' },
  declining: { variant: 'red',    text: '▼ Declining' },
  volatile:  { variant: 'yellow', text: '↕ Volatile' },
  stable:    { variant: 'gray',   text: '→ Stable' },
}

export default function PerformanceTrend({ series, trend }) {
  if (!series || series.length === 0) {
    return (
      <Card>
        <CardTitle>📈 Class Performance Over Time</CardTitle>
        <p className="text-[12px] text-ink-3 py-4">No scored exams for this filter.</p>
      </Card>
    )
  }

  const x = i => PAD.left + (series.length === 1 ? PLOT_W / 2 : (i / (series.length - 1)) * PLOT_W)
  const y = pct => PAD.top + (1 - pct) * PLOT_H
  const pts = series.map((p, i) => ({ ...p, cx: x(i), cy: y(p.avgPct) }))
  const line = pts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ')

  // Show every Nth x-label so they don't overlap on long series.
  const labelEvery = Math.ceil(series.length / 8)
  const badge = trend && TREND_BADGE[trend]

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <CardTitle>📈 Class Performance Over Time</CardTitle>
        {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
      </div>
      <p className="text-[11px] text-ink-3 mb-2">
        Average % of max marks per exam · normalised so papers of different sizes are comparable
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label="Class average percent of max marks per exam over time">
        {/* y gridlines + labels at 0/25/50/75/100% */}
        {[0, 0.25, 0.5, 0.75, 1].map(g => (
          <g key={g}>
            <line x1={PAD.left} y1={y(g)} x2={W - PAD.right} y2={y(g)}
                  stroke="currentColor" className="text-border" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(g) + 3} textAnchor="end"
                  className="fill-ink-3 text-[9px] font-mono">{(g * 100).toFixed(0)}</text>
          </g>
        ))}

        {/* connecting line */}
        {pts.length > 1 && (
          <polyline points={line} fill="none" stroke="#4f46e5" strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* points */}
        {pts.map((p, i) => (
          <g key={p.examId}>
            <circle cx={p.cx} cy={p.cy} r="4" fill={scoreBg(p.avgPct)} stroke="white" strokeWidth="1.5">
              <title>{`${p.name} (${p.date}) — ${(p.avgPct * 100).toFixed(0)}%, n=${p.n}`}</title>
            </circle>
            {(i % labelEvery === 0 || i === pts.length - 1) && (
              <text x={p.cx} y={H - PAD.bottom + 16} textAnchor="middle"
                    className="fill-ink-3 text-[8.5px]"
                    transform={series.length > 5 ? `rotate(30 ${p.cx} ${H - PAD.bottom + 16})` : undefined}>
                {p.date?.slice(5) /* MM-DD */}
              </text>
            )}
          </g>
        ))}
      </svg>
    </Card>
  )
}
