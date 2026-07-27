import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { buildFilingBoard } from '../../lib/teacherDay'

// Admin view of who has actually filed today's periods.
//
// Teachers file their own lectures at /school-attendance, which means silence
// is now ambiguous at rest: no lecture_absences rows reads identically for
// "everyone turned up" and "nobody filed". lecture_submissions carries the
// difference, and this panel is what turns it into an action — the outstanding
// list is the call list.
export default function FilingBoard({ date, batchName = null, refreshKey = 0 }) {
  const timetables = useStore(s => s.timetables)
  const mappings   = useStore(s => s.timetableMappings)
  const teachers   = useStore(s => s.timetableTeachers)
  const getSubmissionsForDate = useStore(s => s.getSubmissionsForDate)

  const [submissions, setSubmissions] = useState([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    getSubmissionsForDate(date).then(rows => { if (!cancelled) setSubmissions(rows ?? []) })
    return () => { cancelled = true }
  }, [date, getSubmissionsForDate, refreshKey])

  const { rows, filed, outstanding } = useMemo(
    () => buildFilingBoard({ timetables, mappings, teachers, submissions, date, batchName }),
    [timetables, mappings, teachers, submissions, date, batchName],
  )

  if (rows.length === 0) return null

  const pending = rows.filter(r => !r.filed)

  return (
    <div className="card px-5 py-4 mb-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[12px] font-mono uppercase tracking-widest text-ink-3">
          Filed {batchName ? `· ${batchName}` : '· all batches'}
        </span>
        <span className="text-[15px] font-extrabold text-ink">{filed}/{rows.length}</span>
        {outstanding > 0 ? (
          <span className="text-[12px] font-semibold text-yellow-400">
            {outstanding} period{outstanding !== 1 ? 's' : ''} outstanding
          </span>
        ) : (
          <span className="text-[12px] font-semibold text-success">✓ All periods accounted for</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          className="ml-auto text-[12px] underline text-ink-3 hover:text-accent min-h-[44px] px-2
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
        >
          {expanded ? 'Hide detail' : 'Show detail'}
        </button>
      </div>

      {/* Collapsed: name who to chase — that's the whole job */}
      {!expanded && outstanding > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {pending.map(r => (
            <span
              key={`${r.slotId}|${r.batchName}`}
              className="text-[11px] px-2 py-1 rounded-full border border-yellow-400/30
                         bg-yellow-400/10 text-yellow-400"
            >
              {r.teacherName ?? 'Unassigned'} · {r.subject} · {r.batchName}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-[10px] font-mono uppercase tracking-widest text-ink-3">
                <th className="text-left py-2 pr-3">Batch</th>
                <th className="text-left py-2 pr-3">Period</th>
                <th className="text-left py-2 pr-3">Teacher</th>
                <th className="text-right py-2 pr-3">Absent</th>
                <th className="text-left py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.slotId}|${r.batchName}`} className="border-b border-border">
                  <td className="py-2 pr-3 text-ink-2">{r.batchName}</td>
                  <td className="py-2 pr-3 text-ink">
                    {r.subject}
                    <span className="text-ink-3 font-mono ml-2">{r.startTime}</span>
                  </td>
                  <td className="py-2 pr-3 text-ink-2">
                    {r.teacherName ?? <span className="text-ink-3 italic">unassigned</span>}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-ink-2">
                    {r.filed ? r.absentCount : '—'}
                  </td>
                  <td className="py-2">
                    {r.filed
                      ? <span className="text-success font-semibold">Filed</span>
                      : <span className="text-yellow-400 font-semibold">Outstanding</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
