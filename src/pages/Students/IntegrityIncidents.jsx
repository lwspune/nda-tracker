import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { Card, CardTitle, Badge } from '../../components/ui'

// Academic-integrity incidents for one student (confirmed copying the student
// admitted to, logged from the Exam Integrity panel). Hide-when-empty, same
// pattern as MissedExams.
//   - admin / teacher: fetched via `getIntegrityIncidentsForStudent(lwsId)`
//   - student portal:  supplied via `integrityIncidentsProp` (no Supabase session)
// Delete is admin-only (a teacher can log but only an admin can void a record).
function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function IntegrityIncidents({ lwsId, integrityIncidentsProp = null }) {
  const getIntegrityIncidentsForStudent = useStore(s => s.getIntegrityIncidentsForStudent)
  const deleteIntegrityIncident         = useStore(s => s.deleteIntegrityIncident)
  const mode = useMode()

  const [rows, setRows] = useState(integrityIncidentsProp ?? [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (integrityIncidentsProp !== null) { setRows(integrityIncidentsProp); return }
    if (!lwsId || typeof getIntegrityIncidentsForStudent !== 'function') return
    let cancelled = false
    getIntegrityIncidentsForStudent(lwsId).then(data => {
      if (!cancelled) setRows(data || [])
    })
    return () => { cancelled = true }
  }, [lwsId, integrityIncidentsProp, getIntegrityIncidentsForStudent])

  async function handleDelete(id) {
    if (!window.confirm('Remove this integrity incident from the student’s record? This cannot be undone.')) return
    const ok = await deleteIntegrityIncident(id)
    if (ok) setRows(prev => prev.filter(r => r.id !== id))
  }

  if (!rows.length) return null

  const canDelete = mode === 'admin'

  return (
    <Card className="!p-0 overflow-hidden border-red-200">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <CardTitle>
          <span className="text-danger">⚠ Academic Integrity</span>
          <span className="ml-2 text-[9px] normal-case tracking-normal text-ink-3 font-normal">
            — {rows.length} confirmed incident{rows.length === 1 ? '' : 's'}
          </span>
        </CardTitle>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-border">
              {['Exam', 'Date', 'With', 'Evidence', 'Recorded', canDelete ? '' : null]
                .filter(h => h !== null)
                .map((h, i) => (
                  <th key={i} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-3 pl-4 first:pl-4">{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-red-50/40 align-top">
                <td className="py-2 pr-3 pl-4 font-medium">
                  {r.exam_name || '—'}
                  <Badge variant="red" className="ml-2">{r.status || 'admitted'}</Badge>
                  {r.note && <div className="text-[11px] text-ink-3 font-normal mt-0.5">{r.note}</div>}
                </td>
                <td className="py-2 pr-3 font-mono text-ink-3 whitespace-nowrap">{r.exam_date || '—'}</td>
                <td className="py-2 pr-3 text-ink-2">{r.counterpart_name || '—'}</td>
                <td className="py-2 pr-3 text-ink-3 whitespace-nowrap">
                  {r.shared_wrong != null
                    ? `${r.shared_wrong} shared wrong${r.diff != null ? ` · ${r.diff} diff` : ''}`
                    : '—'}
                </td>
                <td className="py-2 pr-3 text-ink-3 whitespace-nowrap">
                  {fmtDateTime(r.created_at)}
                  {r.created_by && <div className="text-[10px]">{r.created_by}</div>}
                </td>
                {canDelete && (
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => handleDelete(r.id)}
                      title="Remove incident"
                      className="text-ink-3 hover:text-danger text-[16px] transition-colors"
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
