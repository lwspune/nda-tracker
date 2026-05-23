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

function Chip({ label, expanded, onToggle, listTestId, items, tone }) {
  // tone: 'late' (yellow) | 'lecture' (red) | 'exam' (red darker)
  const tones = {
    late:    'bg-yellow-400/10 border-yellow-400/30 text-yellow-300 hover:bg-yellow-400/20',
    lecture: 'bg-red-400/10 border-red-400/30 text-red-300 hover:bg-red-400/20',
    exam:    'bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25',
  }
  const listColor = {
    late:    'text-yellow-200/90',
    lecture: 'text-red-200/90',
    exam:    'text-red-200/90',
  }
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={expanded}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono
                    border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                    min-h-[28px] ${tones[tone]}`}
      >
        <span>{label}</span>
        <span className="opacity-70">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div
          data-testid={listTestId}
          className={`text-[11px] font-mono ${listColor[tone]} max-w-[160px] text-center leading-tight`}
        >
          {items.join(' · ')}
        </div>
      )}
    </>
  )
}

function Ring({
  month, pct, label,
  lateCount, lateDates,
  lectureMissCount, lectureMisses,
  examMissCount, examMisses,
  expandedKind, onToggle,
}) {
  const filled = (pct / 100) * C
  const color  = pct < 75 ? '#f87171' : pct < 85 ? '#facc15' : '#4ade80'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={STROKE} />
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
        <Chip
          label={`Days late: ${lateCount}`}
          expanded={expandedKind === 'late'}
          onToggle={() => onToggle('late')}
          listTestId={`late-dates-list-${month}`}
          items={lateDates.map(fmtDayMonth)}
          tone="late"
        />
      )}

      {lectureMissCount > 0 && (
        <Chip
          label={`Missed Lectures: ${lectureMissCount}`}
          expanded={expandedKind === 'lecture'}
          onToggle={() => onToggle('lecture')}
          listTestId={`lecture-misses-list-${month}`}
          items={lectureMisses.map(r => `${fmtDayMonth(r.date)} ${r.subject}`)}
          tone="lecture"
        />
      )}

      {examMissCount > 0 && (
        <Chip
          label={`Missed Exams: ${examMissCount}`}
          expanded={expandedKind === 'exam'}
          onToggle={() => onToggle('exam')}
          listTestId={`exam-misses-list-${month}`}
          items={examMisses.map(r => `${fmtDayMonth(r.date)} ${r.examName}`)}
          tone="exam"
        />
      )}
    </div>
  )
}

// Enrich exam-absence rows with date + name. Admin/teacher: looks up via
// `exams[]`. Student portal: row already carries `exam_name` + `exam_date`
// from the server. Rows that can't be resolved either way are dropped.
function enrichExamAbsences(examAbsences, exams) {
  const byId = new Map((exams || []).map(e => [e.id, e]))
  const out = []
  for (const r of examAbsences || []) {
    const meta = byId.get(r.exam_id)
    const date = meta?.date ?? r.exam_date ?? ''
    const name = meta?.name ?? r.exam_name ?? ''
    if (!date || !name) continue
    out.push({ examId: r.exam_id, date, examName: name })
  }
  return out
}

function buildMonthStats(attendance, lectureAbsences, examMissesEnriched) {
  const months = {}
  const ensure = m => {
    if (!months[m]) months[m] = {
      p: 0, a: 0,
      lateDates: [],
      lectureMisses: [],
      examMisses: [],
    }
    return months[m]
  }

  for (const { date, status } of (attendance || [])) {
    const m = date.slice(0, 7)
    const bucket = ensure(m)
    if (status === 'P')      bucket.p++
    else if (status === 'A') bucket.a++
    else if (status === 'L') bucket.lateDates.push(date)
  }

  for (const r of (lectureAbsences || [])) {
    if (!r?.date) continue
    const m = r.date.slice(0, 7)
    ensure(m).lectureMisses.push({ date: r.date, subject: r.subject || '' })
  }

  for (const r of (examMissesEnriched || [])) {
    if (!r?.date) continue
    const m = r.date.slice(0, 7)
    ensure(m).examMisses.push(r)
  }

  return Object.entries(months)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, b]) => {
      const total = b.p + b.a
      const pct   = total > 0 ? Math.round((b.p / total) * 100) : 0
      const [year, mo] = month.split('-')
      const label = new Date(+year, +mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
      const lateDates     = [...b.lateDates].sort((x, y) => y.localeCompare(x))
      const lectureMisses = [...b.lectureMisses].sort((x, y) => y.date.localeCompare(x.date))
      const examMisses    = [...b.examMisses].sort((x, y) => y.date.localeCompare(x.date))
      return {
        month, pct, label,
        lateCount:        lateDates.length,
        lateDates,
        lectureMissCount: lectureMisses.length,
        lectureMisses,
        examMissCount:    examMisses.length,
        examMisses,
      }
    })
}

export default function AttendanceRings({
  attendance       = [],
  lectureAbsences  = [],
  examAbsences     = [],
  exams            = [],
}) {
  const examMissesEnriched = enrichExamAbsences(examAbsences, exams)
  const stats = buildMonthStats(attendance, lectureAbsences, examMissesEnriched)

  // Single-open across the whole component: clicking a chip in any month sets
  // (month, kind); a second click on the same chip (or any other chip in any
  // month) toggles or replaces. Matches the existing late-chip behaviour.
  const [expanded, setExpanded] = useState(null) // { month, kind } | null

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
              lectureMissCount={s.lectureMissCount}
              lectureMisses={s.lectureMisses}
              examMissCount={s.examMissCount}
              examMisses={s.examMisses}
              expandedKind={expanded?.month === s.month ? expanded.kind : null}
              onToggle={(kind) => setExpanded(prev =>
                prev?.month === s.month && prev?.kind === kind ? null : { month: s.month, kind }
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
