import { useState, useEffect } from 'react'
import { Card, CardTitle, Badge } from '../../components/ui'
import { buildIntegrityLeaders } from '../../lib/analytics'

// Dashboard "Integrity Incidents" rollup — students with logged academic-integrity
// incidents, ranked by incident count so repeat offenders (multiple exams) sit on
// top. Class-wide; hide-when-empty (no card until at least one incident exists).
// Fetch-on-demand via the slice; not stored.
export default function IntegrityLeaders({ studentProfiles, getAllIntegrityIncidents, setActiveStudent }) {
  const [rows, setRows] = useState([])
  const [openLws, setOpenLws] = useState(null)

  useEffect(() => {
    if (typeof getAllIntegrityIncidents !== 'function') return
    let cancelled = false
    getAllIntegrityIncidents().then(r => { if (!cancelled) setRows(r || []) })
    return () => { cancelled = true }
  }, [getAllIntegrityIncidents])

  const leaders = buildIntegrityLeaders(rows, studentProfiles)
  if (leaders.length === 0) return null

  const repeatCount = leaders.filter(s => s.incidentCount >= 2).length

  return (
    <div className="mb-4 md:mb-5">
      <Card className="border-red-200">
        <CardTitle>
          <span className="text-danger">⚠ Integrity Incidents</span>
          <span className="ml-2 text-[9px] normal-case tracking-normal text-ink-3 font-normal">
            — {leaders.length} student{leaders.length === 1 ? '' : 's'}
            {repeatCount > 0 && ` · ${repeatCount} repeat`}
          </span>
        </CardTitle>

        <div className="flex flex-col divide-y divide-border mt-1">
          {leaders.map(s => {
            const isOpen = openLws === s.lwsId
            const repeat = s.incidentCount >= 2
            return (
              <div key={s.lwsId} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveStudent?.(s.name)}
                    className="flex items-center gap-2 min-w-0 text-left hover:underline
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
                    aria-label={`Open ${s.name}`}
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-ink truncate">{s.name}</div>
                      {s.branch && <div className="text-[10px] font-mono text-ink-3">{s.branch}</div>}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={repeat ? 'red' : 'yellow'}>
                      {s.incidentCount} incident{s.incidentCount === 1 ? '' : 's'}
                      {s.examCount > 1 ? ` · ${s.examCount} exams` : ''}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setOpenLws(isOpen ? null : s.lwsId)}
                      className="text-[11px] font-semibold text-ink-2 hover:text-accent px-2 py-1 rounded
                                 border border-border hover:border-accent/30 transition-colors"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? 'Hide ▲' : 'Details ▼'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 ml-1 space-y-1">
                    {s.exams.map((e, i) => (
                      <div key={`${e.examId}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                        <span className="font-medium text-ink">{e.examName}</span>
                        <span className="font-mono text-ink-3">{e.examDate}</span>
                        {e.counterpartName && <span className="text-ink-3">· with {e.counterpartName}</span>}
                        <span className="text-[9px] font-bold uppercase tracking-wide text-danger">{e.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
