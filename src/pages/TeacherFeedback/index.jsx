import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { FEEDBACK_DIMENSIONS, aggregateFeedback, feedbackTrend } from '../../lib/teacherFeedback'
import { PageHeader, EmptyState, Spinner, Card, CardTitle } from '../../components/ui'
import ImportFeedbackModal from './ImportFeedbackModal'

function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
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
// sourced from the RLS-gated teacher_feedback table.
export default function TeacherFeedbackPage() {
  const isSuperadmin        = useStore(s => s.isSuperadmin)
  const loadTeacherFeedback = useStore(s => s.loadTeacherFeedback)

  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [cycle, setCycle]       = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    // Non-superadmins never reach the data view (render returns Restricted), so
    // there's nothing to load or toggle for them.
    if (!isSuperadmin) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    loadTeacherFeedback().then(r => { if (!cancelled) { setRows(r); setLoading(false) } })
    return () => { cancelled = true }
  }, [isSuperadmin, loadTeacherFeedback, refreshKey])

  const cycles = useMemo(
    () => [...new Set(rows.map(r => r.cycle).filter(Boolean))].sort().reverse(),
    [rows]
  )
  const filtered = useMemo(
    () => cycle === 'all' ? rows : rows.filter(r => r.cycle === cycle),
    [rows, cycle]
  )
  // Worst-first — surfaces who needs attention.
  const aggregates = useMemo(
    () => aggregateFeedback(filtered).sort((a, b) => (a.overall ?? 99) - (b.overall ?? 99)),
    [filtered]
  )
  const trendByTeacher = useMemo(() => {
    const map = {}
    for (const t of feedbackTrend(rows)) map[t.teacher] = t.cycles
    return map
  }, [rows])

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

      {/* Cycle filter */}
      {cycles.length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-widest text-ink-3">Cycle</span>
          <button
            type="button"
            onClick={() => setCycle('all')}
            className={`text-[12px] px-3 py-1.5 rounded-full border ${cycle === 'all' ? 'border-accent text-accent bg-accent-soft/30' : 'border-border text-ink-3'}`}
          >
            All
          </button>
          {cycles.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={`text-[12px] px-3 py-1.5 rounded-full border ${cycle === c ? 'border-accent text-accent bg-accent-soft/30' : 'border-border text-ink-3'}`}
            >
              {c}
            </button>
          ))}
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
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <CardTitle>{t.teacher}</CardTitle>
                  <div className="text-right">
                    <span className={`text-[22px] font-extrabold ${scoreColor(t.overall)}`}>{t.overall ?? '—'}</span>
                    <span className="text-[11px] text-ink-3 font-mono ml-1">/5 · n={t.n}</span>
                  </div>
                </div>

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

                {/* Trend across cycles */}
                {cyc.length > 1 && (
                  <div className="text-[11px] text-ink-3 font-mono mb-3">
                    Trend: {cyc.map(c => `${c.cycle} ${c.overall ?? '—'}`).join(' → ')}
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
