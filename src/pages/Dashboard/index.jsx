import { useState } from 'react'
import useStore from '../../store/useStore'
import { PageHeader, EmptyState, StatCard, Card, CardTitle, HeatBar, Badge } from '../../components/ui'
import { computeChapterStats, getAtRisk, getHardestQuestions, getAllStudents } from '../../lib/analytics'
import { NDA_FREQ_DEFAULT } from '../../lib/ndaFreq'
import { getAllBatches } from '../../lib/matchStudents'

export default function DashboardPage() {
  const exams        = useStore(s => s.exams)
  const ndaFreq      = useStore(s => s.ndaFreq)
  const setNdaFreq   = useStore(s => s.setNdaFreq)
  const resetNdaFreq = useStore(s => s.resetNdaFreq)
  const studentProfiles = useStore(s => s.studentProfiles)

  const [batchFilter, setBatchFilter] = useState('all')
  const [filterVal, setFilterVal]     = useState('all')
  const [freqOpen, setFreqOpen]       = useState(false)
  const [localFreq, setLocalFreq]     = useState(null)

  if (!exams.length) {
    return (
      <div>
        <PageHeader title="Dashboard" sub="Overview of class performance across all exams" />
        <EmptyState icon="📊" title="No data yet" sub="Add your first exam to see the dashboard" />
      </div>
    )
  }

  // All unique batches across all exams
  const allBatches = [...new Set(exams.map(e => e.batch).filter(Boolean))]

  // Filter by batch first, then by specific exam
  const batchFiltered = batchFilter === 'all'
    ? exams
    : exams.filter(e => e.batch === batchFilter)

  const filtered = filterVal === 'all'
    ? batchFiltered
    : batchFiltered.filter(e => e.id === filterVal)

  const students  = getAllStudents(filtered)
  const chapterStats = computeChapterStats(filtered)
  const atRisk    = getAtRisk(filtered)
  const hardest   = getHardestQuestions(filtered)

  const avgScore  = filtered.length
    ? filtered.reduce((s, e) =>
        s + (e.students.length
          ? e.students.reduce((ss, st) => ss + st.totalMarks, 0) / e.students.length
          : 0), 0
      ) / filtered.length
    : 0

  const chapterRows = Object.entries(chapterStats).map(([ch, subs]) => {
    let correct = 0, total = 0
    Object.values(subs).forEach(s => { correct += s.correct; total += s.total })
    return { name: ch, pct: total > 0 ? correct / total : 0, correct, total }
  }).sort((a, b) => a.pct - b.pct)

  // Working freq rows — local edits before save
  const workingFreq = localFreq || ndaFreq
  const freqTotal   = workingFreq.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
  const freqValid   = Math.abs(freqTotal - 100) < 0.15

  function updateFreqRow(i, val) {
    const next = workingFreq.map((r, ri) =>
      ri === i ? { ...r, pct: parseFloat(val) || 0 } : r
    )
    setLocalFreq(next)
  }

  function saveFreq() {
    if (!freqValid) return
    setNdaFreq(workingFreq)
    setLocalFreq(null)
  }

  function handleReset() {
    if (!confirm('Reset to default NDA PYQ 2018–2024 weights?')) return
    resetNdaFreq()
    setLocalFreq(null)
  }

  const hasUnsaved = localFreq !== null

  return (
    <div>
      {/* Header + filters */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 md:mb-7">
        <div>
          <h1 className="text-[24px] font-extrabold text-ink tracking-tight leading-tight">Dashboard</h1>
          <p className="text-[13px] text-ink-2 mt-1">Class performance overview</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Batch filter */}
          {allBatches.length > 0 && (
            <select
              value={batchFilter}
              onChange={e => { setBatchFilter(e.target.value); setFilterVal('all') }}
              className="form-input w-auto text-[13px] pr-8 cursor-pointer"
              style={{ minWidth: '180px' }}
            >
              <option value="all">All Batches</option>
              {allBatches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          {/* Exam filter */}
          <select
            value={filterVal}
            onChange={e => setFilterVal(e.target.value)}
            className="form-input w-auto text-[13px] pr-8 cursor-pointer"
            style={{ minWidth: '220px' }}
          >
            <option value="all">All Exams</option>
            {[...batchFiltered].reverse().map(e => (
              <option key={e.id} value={e.id}>{e.name} · {e.date}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-6">
        <StatCard label="Students"  value={students.length}      color="text-accent" />
        <StatCard label="Exams"     value={filtered.length}      color="text-indigo-400" />
        <StatCard label="Avg Score" value={avgScore.toFixed(1)}  color="text-success" />
        <StatCard label="At-Risk"   value={atRisk.length}        color="text-danger" />
      </div>

      {/* Heatmap + At-risk */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mb-4 md:mb-5">
        <Card>
          <CardTitle>Chapter Performance — Class Average</CardTitle>
          <div className="flex flex-col gap-1.5">
            {chapterRows.length === 0
              ? <p className="text-[12px] text-ink-3">No chapter data for this filter.</p>
              : chapterRows.map(ch => (
                <HeatBar key={ch.name} pct={ch.pct} label={ch.name} count={`${ch.correct}/${ch.total}`} />
              ))
            }
          </div>
        </Card>

        <Card>
          <CardTitle>⚠️ At-Risk Students (Weak in 2+ Chapters)</CardTitle>
          {atRisk.length === 0 ? (
            <p className="text-[12px] text-ink-3 py-4">No at-risk students — great performance!</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {atRisk.slice(0, 12).map(s => (
                <div key={s.name} className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-[12px] font-semibold text-ink">{s.name}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.weakChapters.slice(0, 3).map(c => (
                        <span key={c} className="text-[10px] font-mono bg-red-50 text-danger px-2 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  </div>
                  <Badge variant="red">{s.count} weak</Badge>
                </div>
              ))}
              {atRisk.length > 12 && (
                <p className="text-[11px] text-ink-3 pt-2">+{atRisk.length - 12} more</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Hardest questions */}
      <Card className="mb-5">
        <CardTitle>🔴 Hardest Questions</CardTitle>
        {hardest.length === 0
          ? <p className="text-[12px] text-ink-3">No question data for this filter.</p>
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Exam', 'Q#', 'Chapter', 'Subtopic', 'Score', 'Difficulty'].map(h => (
                    <th key={h} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hardest.map((q, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                    <td className="py-2 pr-4 text-ink-3 text-[11px]">{q.examName}</td>
                    <td className="py-2 pr-4 font-mono">Q{q.q}</td>
                    <td className="py-2 pr-4 font-medium">{q.chapter}</td>
                    <td className="py-2 pr-4 text-ink-2">{q.subtopic}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full"
                               style={{ width: `${(q.pct*100).toFixed(0)}%`,
                                        background: q.pct < 0.3 ? '#e03e3e' : q.pct < 0.6 ? '#d97706' : '#16a34a' }} />
                        </div>
                        <span className="font-mono text-[10px]">{(q.pct*100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2">
                      <Badge variant={q.pct < 0.3 ? 'red' : q.pct < 0.6 ? 'yellow' : 'green'}>
                        {q.pct < 0.3 ? 'Hard' : q.pct < 0.6 ? 'Medium' : 'Easy'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── NDA Chapter Frequency Table ─────────────────── */}
      <Card>
        {/* Collapsible header */}
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setFreqOpen(o => !o)}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-ink-3">
              📊 NDA Chapter Frequency Table
              {hasUnsaved && <span className="ml-2 text-warning font-bold">· Unsaved changes</span>}
            </div>
            <div className="text-[11px] text-ink-3 font-normal mt-1 normal-case tracking-normal">
              Weights used for projected NDA score · based on PYQ 2018–2024 · click to edit
            </div>
          </div>
          <span
            className="text-[13px] text-ink-3 transition-transform duration-200 flex-shrink-0 ml-4"
            style={{ transform: freqOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >▶</span>
        </div>

        {/* Collapsible body */}
        {freqOpen && (
          <div className="mt-5">
            {/* Column headers */}
            <div className="grid gap-2 px-2 mb-2"
                 style={{ gridTemplateColumns: '1fr 90px 90px' }}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Chapter</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 text-center">Weight %</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 text-center">NDA Marks</div>
            </div>

            {/* Rows */}
            <div className="space-y-0.5 mb-4">
              {workingFreq.map((row, i) => (
                <div
                  key={row.chapter}
                  className={`grid gap-2 px-2 py-1.5 rounded-lg items-center
                              ${i % 2 === 0 ? 'bg-surface-2' : 'bg-surface'}`}
                  style={{ gridTemplateColumns: '1fr 90px 90px' }}
                >
                  <div className="text-[12px] font-medium text-ink">{row.chapter}</div>
                  <div className="text-center">
                    <input
                      type="number"
                      step="0.1" min="0" max="100"
                      value={row.pct}
                      onChange={e => updateFreqRow(i, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-16 text-center text-[12px] font-mono border border-border
                                 rounded-md px-2 py-1 outline-none bg-surface
                                 focus:border-accent focus:bg-white transition-colors"
                    />
                  </div>
                  <div className="text-center text-[12px] font-mono text-ink-2">
                    {(parseFloat(row.pct) * 3).toFixed(1)}
                  </div>
                </div>
              ))}
            </div>

            {/* Total row */}
            <div className="grid gap-2 px-2 py-2 border-t border-border mb-4"
                 style={{ gridTemplateColumns: '1fr 90px 90px' }}>
              <div className="text-[12px] font-bold text-ink">Total</div>
              <div className="text-center">
                <span className={`text-[13px] font-extrabold font-mono
                  ${freqValid ? 'text-success' : 'text-danger'}`}>
                  {freqTotal.toFixed(1)}%
                </span>
                {!freqValid && (
                  <div className="text-[10px] text-danger mt-0.5">Must equal 100%</div>
                )}
              </div>
              <div className="text-center text-[12px] font-mono font-bold text-ink">
                {(freqTotal * 3).toFixed(1)}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveFreq}
                disabled={!freqValid || !hasUnsaved}
                className={`btn btn-primary btn-sm
                  ${(!freqValid || !hasUnsaved) ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                💾 Save Weights
              </button>
              <button
                onClick={handleReset}
                className="btn btn-secondary btn-sm"
              >
                ↺ Reset to Defaults
              </button>
              {!freqValid && (
                <span className="text-[11px] text-danger font-semibold">
                  ⚠️ Total must equal 100% before saving
                </span>
              )}
              {freqValid && hasUnsaved && (
                <span className="text-[11px] text-warning font-semibold">
                  Unsaved — click Save Weights to apply
                </span>
              )}
              {freqValid && !hasUnsaved && (
                <span className="text-[11px] text-success">
                  ✅ Saved — projected scores are up to date
                </span>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
