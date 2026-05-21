import { useState } from 'react'

// SVG donut ring: circumference of r=40 circle = 2π×40 ≈ 251.3
const R = 40
const C = 2 * Math.PI * R
const SIZE = 100
const CX = SIZE / 2
const CY = SIZE / 2
const STROKE = 9

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDayMonth(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}`
}

function Ring({ month, pct, label, lateCount, lateDates, expanded, onToggle }) {
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

      {lateCount > 0 && (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Days late: ${lateCount}`}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono
                       bg-yellow-400/10 border border-yellow-400/30 text-yellow-300
                       hover:bg-yellow-400/20 focus:outline-none focus-visible:ring-2
                       focus-visible:ring-accent/40 min-h-[28px]"
          >
            <span>Days late: {lateCount}</span>
            <span className="opacity-70">{expanded ? '▴' : '▾'}</span>
          </button>
          {expanded && (
            <div
              data-testid={`late-dates-list-${month}`}
              className="text-[11px] font-mono text-yellow-200/90 max-w-[140px] text-center leading-tight"
            >
              {lateDates.map(fmtDayMonth).join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function buildMonthStats(attendance) {
  const months = {}
  for (const { date, status } of attendance) {
    const month = date.slice(0, 7) // YYYY-MM
    if (!months[month]) months[month] = { p: 0, a: 0, lateDates: [] }
    if (status === 'P') months[month].p++
    else if (status === 'A') months[month].a++
    else if (status === 'L') months[month].lateDates.push(date)
  }
  return Object.entries(months)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, { p, a, lateDates }]) => {
      const total = p + a
      const pct   = total > 0 ? Math.round((p / total) * 100) : 0
      const [year, mo] = month.split('-')
      const label = new Date(+year, +mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
      // Latest-first date order inside each month
      const sortedDates = [...lateDates].sort((x, y) => y.localeCompare(x))
      return { month, pct, label, lateCount: sortedDates.length, lateDates: sortedDates }
    })
}

export default function AttendanceRings({ attendance = [] }) {
  const stats = buildMonthStats(attendance)
  const [expandedMonth, setExpandedMonth] = useState(null)

  if (!stats.length) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3 opacity-25">📋</div>
        <div className="text-[14px] font-bold text-ink-2">No attendance data</div>
        <div className="text-[12px] text-ink-3 mt-1">Records will appear here once imported.</div>
      </div>
    )
  }

  return (
    <div className="py-4">
      <div className="text-[13px] font-semibold text-ink-3 mb-6">My Attendance</div>
      <div className="flex flex-wrap gap-8 justify-start">
        {stats.map(s => (
          <div key={s.month} className="relative flex flex-col items-center">
            <Ring
              month={s.month}
              pct={s.pct}
              label={s.label}
              lateCount={s.lateCount}
              lateDates={s.lateDates}
              expanded={expandedMonth === s.month}
              onToggle={() => setExpandedMonth(prev => prev === s.month ? null : s.month)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
