// SVG donut ring: circumference of r=40 circle = 2π×40 ≈ 251.3
const R = 40
const C = 2 * Math.PI * R
const SIZE = 100
const CX = SIZE / 2
const CY = SIZE / 2
const STROKE = 9

function Ring({ pct, label }) {
  const filled = (pct / 100) * C
  const color  = pct < 75 ? '#f87171' : pct < 85 ? '#facc15' : '#4ade80'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          {/* Track */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={STROKE}
          />
          {/* Progress */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${C}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        {/* Percentage centred inside the ring */}
        <div
          className="absolute inset-0 flex items-center justify-center text-[14px] font-extrabold"
          style={{ color }}
        >
          {pct}%
        </div>
      </div>
      <span data-testid="ring-month-label" className="text-[11px] font-mono text-ink-3 tracking-wide">
        {label}
      </span>
    </div>
  )
}

function buildMonthStats(attendance) {
  const months = {}
  for (const { date, status } of attendance) {
    if (status !== 'P' && status !== 'A') continue
    const month = date.slice(0, 7) // YYYY-MM
    if (!months[month]) months[month] = { p: 0, a: 0 }
    if (status === 'P') months[month].p++
    else months[month].a++
  }
  return Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { p, a }]) => {
      const total = p + a
      const pct   = total > 0 ? Math.round((p / total) * 100) : 0
      const [year, mo] = month.split('-')
      const label = new Date(+year, +mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
      return { month, pct, label }
    })
}

export default function AttendanceRings({ attendance = [] }) {
  const stats = buildMonthStats(attendance)

  if (!stats.length) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3 opacity-25">📋</div>
        <div className="text-[14px] font-bold text-white/60">No attendance data</div>
        <div className="text-[12px] text-white/30 mt-1">Records will appear here once imported.</div>
      </div>
    )
  }

  return (
    <div className="py-4">
      <div className="text-[13px] font-semibold text-ink-3 mb-6">My Attendance</div>
      <div className="flex flex-wrap gap-8 justify-start">
        {stats.map(({ month, pct, label }) => (
          <div key={month} className="relative flex flex-col items-center">
            <Ring pct={pct} label={label} />
          </div>
        ))}
      </div>
    </div>
  )
}
