import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { FEEDBACK_DIMENSIONS, aggregateFeedback, feedbackTrend } from '../../lib/teacherFeedback'
import { PageHeader, EmptyState, Spinner, Card, CardTitle } from '../../components/ui'
import ImportFeedbackModal from './ImportFeedbackModal'

function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// "2026-04-30…" → "Apr 2026"
function monthLabel(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

// Min/max submitted_at as a compact "Apr–May 2026" (or single month) range.
function dateRange(isos) {
  const valid = isos.filter(Boolean).sort()
  if (valid.length === 0) return ''
  const lo = monthLabel(valid[0]), hi = monthLabel(valid[valid.length - 1])
  return lo === hi ? lo : `${lo} – ${hi}`
}

function scoreColor(v) {
  if (v == null) return 'text-ink-3'
  if (v < 3.5) return 'text-red-500'
  if (v < 4)   return 'text-yellow-600'
  return 'text-green-600'
}
function barColor(v) {
  if (v == null) return 'bg-ink-3/30'
  if (v < 3.5) return 'bg-red-400'
  if (v < 4)   return 'bg-yellow-400'
  return 'bg-green-400'
}

// Superadmin-only. Per-teacher feedback aggregates + trend + raw comments,
// sourced from the RLS-gated teacher_feedback table. Filterable by cycle and teacher.
export default function TeacherFeedbackPage() {
  const isSuperadmin        = useStore(s => s.isSuperadmin)
  const loadTeacherFeedback = useStore(s => s.loadTeacherFeedback)

  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [cycle, setCycle]       = useState('all')
  const [teacher, setTeacher]   = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!isSuperadmin) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    loadTeacherFeedback().then(r => { if (!cancelled) { setRows(r); setLoading(false) } })
    return () => { cancelled = true }
  }, [isSuperadmin, loadTeacherFeedback, refreshKey])

  // Cycles with a derived month label + response count (latest first).
  const cycleInfo = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (!r.cycle) continue
      if (!map.has(r.cycle)) map.set(r.cycle, { cycle: r.cycle, dates: [], count: 0 })
      const e = map.get(r.cycle)
      e.dates.push(r.submitted_at); e.count += 1
    }
    return [...map.values()]
      .map(e => ({ cycle: e.cycle, label: monthLabel(e.dates.filter(Boolean).sort()[0]), count: e.count }))
      .sort((a, b) => b.cycle.localeCompare(a.cycle))
  }, [rows])

  const teachers = useMemo(
    () => [...new Set(rows.map(r => r.teacher_name).filter(Boolean))].sort(),
    [rows]
  )

  const filtered = useMemo(
    () => rows.filter(r =>
      (cycle === 'all' || r.cycle === cycle) &&
      (teacher === 'all' || r.teacher_name === teacher)
    ),
    [rows, cycle, teacher]
  )

  // Worst-first — surfaces who needs attention.
  const aggregates = useMemo(
    () => aggregateFeedback(filtered).sort((a, b) => (a.overall ?? 99) - (b.overall ?? 99)),
    [filtered]
  )

  // Per-teacher feedback date range (within the active filter).
  const dateRangeByTeacher = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      if (!map[r.teacher_name]) map[r.teacher_name] = []
      map[r.teacher_name].push(r.submitted_at)
    }
    return Object.fromEntries(Object.entries(map).map(([t, ds]) => [t, dateRange(ds)]))
  }, [filtered])

  // Trend is always computed over ALL rows (so it shows the full history even
  // when a single cycle is selected), labelled with each cycle's month.
  const trendByTeacher = useMemo(() => {
    const cycToLabel = Object.fromEntries(cycleInfo.map(c => [c.cycle, c.label]))
    const map = {}
    for (const t of feedbackTrend(rows)) {
      map[t.teacher] = t.cycles.map(c => ({ ...c, label: cycToLabel[c.cycle] || c.cycle }))
    }
    return map
  }, [rows, cycleInfo])

  if (!isSuperadmin) {
    return <EmptyState icon="🔒" title="Restricted" sub="Teacher feedback is visible to the superadmin only." />
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <PageHeader title="Teacher Feedback" sub="Student feedback by teacher — superadmin only" />
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="btn btn-primary text-[13px] min-h-[44px] px-4"
        >
          + Import responses
        </button>
      </div>

      {/* Filters */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-3 mb-5">
          {/* Cycle filter — pills with month label + count */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono uppercase tracking-widest text-ink-3 w-16">Cycle</span>
            <button
              type="button"
              onClick={() => setCycle('all')}
              className={`text-[12px] px-3 py-1.5 rounded-full border ${cycle === 'all' ? 'border-accent text-accent bg-accent-soft/30' : 'border-border text-ink-3'}`}
            >
              All
            </button>
            {cycleInfo.map(c => (
              <button
                key={c.cycle}
                type="button"
                onClick={() => setCycle(c.cycle)}
                className={`text-[12px] px-3 py-1.5 rounded-full border ${cycle === c.cycle ? 'border-accent text-accent bg-accent-soft/30' : 'border-border text-ink-3'}`}
              >
                {c.cycle}{c.label ? ` · ${c.label}` : ''} <span className="opacity-60">({c.count})</span>
              </button>
            ))}
          </div>

          {/* Teacher filter — dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-ink-3 w-16">Teacher</span>
            <select
              value={teacher}
              onChange={e => setTeacher(e.target.value)}
              aria-label="Filter by teacher"
              className="form-input text-[13px] min-h-[40px] px-3 max-w-[260px]"
            >
              <option value="all">All teachers ({teachers.length})</option>
              {teachers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {teacher !== 'all' && (
              <button type="button" onClick={() => setTeacher('all')} className="text-[12px] text-ink-3 hover:text-ink underline">
                clear
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 py-16 justify-center text-ink-3"><Spinner /> Loading feedback…</div>
      ) : aggregates.length === 0 ? (
        <EmptyState icon="🗣" title="No feedback yet" sub="Import a Google Form responses export to get started." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {aggregates.map(t => {
            const cyc = trendByTeacher[t.teacher] || []
            return (
              <Card key={t.teacher}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <CardTitle>{t.teacher}</CardTitle>
                  <div className="text-right">
                    <span className={`text-[22px] font-extrabold ${scoreColor(t.overall)}`}>{t.overall ?? '—'}</span>
                    <span className="text-[11px] text-ink-3 font-mono ml-1">/5 · n={t.n}</span>
                  </div>
                </div>
                {/* Feedback date range */}
                {dateRangeByTeacher[t.teacher] && (
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-3">
                    {dateRangeByTeacher[t.teacher]}
                  </div>
                )}

                {/* Dimension bars */}
                <div className="space-y-1.5 mb-3">
                  {FEEDBACK_DIMENSIONS.map(d => {
                    const v = t.dims[d.key]
                    return (
                      <div key={d.key} className="flex items-center gap-2">
                        <span className="text-[11px] text-ink-2 w-24 shrink-0">{d.label}</span>
                        <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                          <div className={`h-full ${barColor(v)}`} style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
                        </div>
                        <span className={`text-[11px] font-mono w-8 text-right ${scoreColor(v)}`}>{v ?? '—'}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Trend across cycles (labelled by month) */}
                {cyc.length > 1 && (
                  <div className="text-[11px] text-ink-3 font-mono mb-3">
                    Trend: {cyc.map(c => `${c.label} ${c.overall ?? '—'}`).join(' → ')}
                  </div>
                )}

                {/* Comments */}
                {t.comments.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[12px] font-semibold text-ink-2 cursor-pointer">
                      {t.comments.length} comment{t.comments.length !== 1 ? 's' : ''}
                    </summary>
                    <ul className="mt-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
                      {t.comments.map((c, i) => (
                        <li key={i} className="text-[12px] text-ink-2 border-l-2 border-border pl-2.5">
                          {c.comment}
                          <span className="text-ink-3 font-mono text-[10px] ml-1.5">· {fmtDate(c.submitted_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {importOpen && (
        <ImportFeedbackModal
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); setRefreshKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
