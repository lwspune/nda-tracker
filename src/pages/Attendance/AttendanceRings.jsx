import { useId, useState } from 'react'

// SVG donut ring: circumference of r=40 circle = 2π×40 ≈ 251.3. Drawn in a
// 100×100 viewBox and sized by CSS, so it shrinks on a phone.
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

// One entry per chip, in display order. `short` is what fits under a phone-sized
// ring; `full` stays the chip's accessible name and heads its opened list.
// Tones are light-mode tuned — earlier dark-mode greys made these unreadable.
const KINDS = [
  { kind: 'late', short: 'Late', full: 'Days late', listId: 'late-dates-list',
    count: s => s.lateCount, items: s => s.lateDates.map(fmtDayMonth),
    chip: 'bg-yellow-50 border-yellow-200 text-warning hover:bg-yellow-100',
    panel: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
  { kind: 'lecture', short: 'Lec', full: 'Missed Lectures', listId: 'lecture-misses-list',
    count: s => s.lectureMissCount, items: s => s.lectureMisses.map(r => `${fmtDayMonth(r.date)} ${r.subject}`),
    chip: 'bg-red-50 border-red-200 text-danger hover:bg-red-100',
    panel: 'bg-red-50 border-red-200 text-red-800' },
  { kind: 'exam', short: 'Exam', full: 'Missed Exams', listId: 'exam-misses-list',
    count: s => s.examMissCount, items: s => s.examMisses.map(r => `${fmtDayMonth(r.date)} ${r.examName}`),
    chip: 'bg-red-100 border-red-300 text-red-900 hover:bg-red-200',
    panel: 'bg-red-50 border-red-300 text-red-900' },
  { kind: 'homework', short: 'HW', full: 'Homework', listId: 'homework-list',
    count: s => s.homeworkCount,
    items: s => s.homeworkItems.map(r => `${fmtDayMonth(r.date)} ${r.subject}${r.chapter ? ' · ' + r.chapter : ''}`),
    chip: 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100',
    panel: 'bg-orange-50 border-orange-200 text-orange-800' },
]

function Ring({ stat, expandedKind, onToggle, panelId }) {
  const { month, pct, label } = stat
  // pct === null: no register was taken that month (only incidents), so there
  // is no percentage to show. Rendering 0% read as "missed the whole month".
  const noRegister = pct === null
  const filled = noRegister ? 0 : (pct / 100) * C
  const color  = noRegister ? '#9ca3af' : pct < 75 ? '#f87171' : pct < 85 ? '#facc15' : '#4ade80'

  return (
    <div data-testid={`ring-${month}`} className="flex flex-col items-center gap-1.5 min-w-0">
      <div className="relative w-16 h-16 md:w-[100px] md:h-[100px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90 w-full h-full">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={STROKE} />
          {!noRegister && <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${C}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />}
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center text-[12px] md:text-[14px] font-extrabold"
          style={{ color: noRegister ? undefined : color }}
        >
          {noRegister ? <span aria-hidden="true" className="text-ink-3">—</span> : `${pct}%`}
        </div>
      </div>
      <span data-testid="ring-month-label" className="text-[11px] font-mono text-ink-3 tracking-wide">
        {label}
      </span>
      {noRegister && (
        <span className="-mt-1 text-[10px] font-mono text-ink-3 whitespace-nowrap">no register</span>
      )}

      {KINDS.filter(k => k.count(stat) > 0).map(k => {
        const open = expandedKind === k.kind
        return (
          <button
            key={k.kind}
            type="button"
            onClick={() => onToggle(k.kind)}
            aria-label={`${k.full}: ${k.count(stat)}`}
            aria-expanded={open}
            aria-controls={panelId(k, month)}
            className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-mono whitespace-nowrap
                        border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                        min-h-[28px] ${k.chip}`}
          >
            <span>{k.short} {k.count(stat)}</span>
            <span aria-hidden="true" className="opacity-70">{open ? '▴' : '▾'}</span>
          </button>
        )
      })}
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

function buildMonthStats(attendance, lectureAbsences, examMissesEnriched, homework) {
  const months = {}
  const ensure = m => {
    if (!months[m]) months[m] = {
      p: 0, a: 0,
      lateDates: [],
      lectureMisses: [],
      examMisses: [],
      homeworkItems: [],
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

  // All homework / notes flagged that month (resolved or not — a factual record,
  // like the lecture/exam miss chips).
  for (const r of (homework || [])) {
    if (!r?.date) continue
    const m = r.date.slice(0, 7)
    ensure(m).homeworkItems.push({ date: r.date, subject: r.subject || '', chapter: r.chapter || '', type: r.type || '' })
  }

  return Object.entries(months)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, b]) => {
      const total = b.p + b.a
      const pct   = total > 0 ? Math.round((b.p / total) * 100) : null
      const [year, mo] = month.split('-')
      const label = new Date(+year, +mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
      const lateDates     = [...b.lateDates].sort((x, y) => y.localeCompare(x))
      const lectureMisses = [...b.lectureMisses].sort((x, y) => y.date.localeCompare(x.date))
      const examMisses    = [...b.examMisses].sort((x, y) => y.date.localeCompare(x.date))
      const homeworkItems = [...b.homeworkItems].sort((x, y) => y.date.localeCompare(x.date))
      return {
        month, pct, label,
        lateCount:        lateDates.length,
        lateDates,
        lectureMissCount: lectureMisses.length,
        lectureMisses,
        examMissCount:    examMisses.length,
        examMisses,
        homeworkCount:    homeworkItems.length,
        homeworkItems,
      }
    })
}

export default function AttendanceRings({
  attendance       = [],
  lectureAbsences  = [],
  examAbsences     = [],
  exams            = [],
  homework         = [],
}) {
  const examMissesEnriched = enrichExamAbsences(examAbsences, exams)
  const stats = buildMonthStats(attendance, lectureAbsences, examMissesEnriched, homework)
  const baseId = useId()
  const panelId = (k, month) => `${baseId}-${k.listId}-${month}`

  // Single-open across the whole component: clicking a chip in any month sets
  // (month, kind); a second click on the same chip toggles it closed, and any
  // other chip replaces it. The list renders once, below the grid, at full
  // width — inside a phone-sized ring column it had ~75px to wrap into.
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

  const openStat = expanded && stats.find(s => s.month === expanded.month)
  const openKind = openStat && KINDS.find(k => k.kind === expanded.kind)

  return (
    <div className="pt-1">
      <div className="grid grid-cols-4 gap-x-2 gap-y-4 md:flex md:flex-wrap md:gap-8">
        {stats.map(s => (
          <Ring
            key={s.month}
            stat={s}
            panelId={panelId}
            expandedKind={expanded?.month === s.month ? expanded.kind : null}
            onToggle={(kind) => setExpanded(prev =>
              prev?.month === s.month && prev?.kind === kind ? null : { month: s.month, kind }
            )}
          />
        ))}
      </div>

      {openKind && (
        <div
          id={panelId(openKind, openStat.month)}
          data-testid={`${openKind.listId}-${openStat.month}`}
          className={`mt-4 rounded-lg border px-3 py-2 ${openKind.panel}`}
        >
          <div className="text-[11px] font-bold mb-1">{openKind.full} · {openStat.label}</div>
          <div className="text-[12px] font-mono leading-relaxed">{openKind.items(openStat).join(' · ')}</div>
        </div>
      )}
    </div>
  )
}
