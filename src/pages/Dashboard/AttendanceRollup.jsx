import { useEffect, useMemo, useState } from 'react'
import { Card, CardTitle } from '../../components/ui'
import { buildAttendanceRollup } from '../../lib/analytics'

// Branch-wise attendance roll-up for one recorded day. One table per branch,
// side by side. Rows = batches; columns = Present / Absent / Total, each split
// Male/Female. Every numeric cell has a ▸ that drills down to the names behind
// the count (single-open across the whole widget — mirrors AttendanceRings).
//
// Absent = status 'A'; Present = everyone else (P / L / '-' / no record).
// Cohort is Active-only (enforced in buildAttendanceRollup). Class-wide — the
// roll-up deliberately ignores the Dashboard's subject/branch/batch filters.

const COLS = [
  { key: 'present', gender: 'male',   group: 'present' },
  { key: 'present', gender: 'female', group: 'present' },
  { key: 'absent',  gender: 'male',   group: 'absent'  },
  { key: 'absent',  gender: 'female', group: 'absent'  },
  { key: 'total',   gender: 'male',   group: 'total'   },
  { key: 'total',   gender: 'female', group: 'total'   },
]

// Names behind one cell. 'total' concatenates present + absent.
function cellNames(data, col) {
  const g = data[col.gender]
  if (col.key === 'present') return g.present
  if (col.key === 'absent')  return g.absent
  return [...g.present, ...g.absent]
}

// Sort batches by class/standard, lower → higher (9th < 10th < 11th < 12th).
// Programs with no class number (2Y / 6M / CDS) rank last, alphabetical among them.
function batchStdRank(name) {
  const m = String(name).match(/(\d+)\s*th/i)
  return m ? Number(m[1]) : 999
}

function emptyData() {
  return { male: { present: [], absent: [] }, female: { present: [], absent: [] } }
}

function BranchTable({ branch, batches, expanded, onToggle }) {
  const batchNames = Object.keys(batches).sort(
    (a, b) => batchStdRank(a) - batchStdRank(b) || a.localeCompare(b),
  )

  // Branch total = sum across batches (so total = Σ batch counts; a multi-batch
  // student counts once per batch, same as the per-batch cells).
  const totalData = emptyData()
  for (const b of batchNames) {
    for (const g of ['male', 'female']) {
      totalData[g].present.push(...batches[b][g].present)
      totalData[g].absent.push(...batches[b][g].absent)
    }
  }

  const rows = [
    ...batchNames.map(b => ({ label: b, idBatch: b, data: batches[b], isTotal: false })),
    { label: 'Total', idBatch: '__total__', data: totalData, isTotal: true },
  ]

  return (
    <div className="min-w-[320px] flex-1">
      <h3 className="text-[13px] font-bold text-ink mb-2">{branch}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-ink-3">
              <th rowSpan={2} className="text-left text-[10px] font-bold uppercase tracking-[1px] pb-1 pr-3 align-bottom">Batch</th>
              <th colSpan={2} className="text-center text-[10px] font-bold uppercase tracking-[1px] pb-1 text-success">Present</th>
              <th colSpan={2} className="text-center text-[10px] font-bold uppercase tracking-[1px] pb-1 text-danger">Absent</th>
              <th colSpan={2} className="text-center text-[10px] font-bold uppercase tracking-[1px] pb-1">Total</th>
            </tr>
            <tr className="text-ink-3 border-b border-border">
              {COLS.map(c => (
                <th key={`${c.key}-${c.gender}`} className="text-center text-[10px] font-mono pb-1 px-1">
                  {c.gender === 'male' ? 'M' : 'F'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <BatchRows
                key={r.idBatch}
                branch={branch}
                label={r.label}
                idBatch={r.idBatch}
                data={r.data}
                isTotal={r.isTotal}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BatchRows({ branch, label, idBatch, data, isTotal, expanded, onToggle }) {
  const openCol = expanded && expanded.branch === branch && expanded.batch === idBatch ? expanded : null
  const openNames = openCol ? cellNames(data, openCol) : []
  const rowCls = isTotal ? 'border-t-2 border-border' : 'border-b border-border/50'
  return (
    <>
      <tr className={rowCls}>
        <td className={`py-1.5 pr-3 text-ink ${isTotal ? 'font-bold' : 'font-medium'}`}>{label}</td>
        {COLS.map(col => {
          const count = cellNames(data, col).length
          const isOpen = !!openCol && openCol.key === col.key && openCol.gender === col.gender
          const id = `cell-${branch}-${idBatch}-${col.key}-${col.gender}`
          return (
            <td key={`${col.key}-${col.gender}`} data-testid={id} className="text-center px-1">
              <button
                type="button"
                onClick={() => onToggle({ branch, batch: idBatch, key: col.key, gender: col.gender })}
                aria-expanded={isOpen}
                aria-label={`${label} ${col.key} ${col.gender === 'male' ? 'male' : 'female'}: ${count} student${count === 1 ? '' : 's'}`}
                className={`inline-flex items-center gap-0.5 font-mono tabular-nums px-1 py-0.5 rounded
                           hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                           disabled:opacity-40 disabled:hover:bg-transparent ${isTotal ? 'font-bold' : ''}`}
                disabled={count === 0}
              >
                <span>{count}</span>
                {count > 0 && <span className="text-[9px] opacity-60">{isOpen ? '▾' : '▸'}</span>}
              </button>
            </td>
          )
        })}
      </tr>
      {openCol && (
        <tr>
          <td colSpan={7} className="pb-2 pt-0">
            <div
              data-testid={`names-${branch}-${idBatch}-${openCol.key}-${openCol.gender}`}
              className="text-[11px] font-mono text-ink-2 bg-surface-2 rounded px-2 py-1 leading-relaxed"
            >
              {openNames.length ? openNames.join(' · ') : '—'}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function AttendanceRollup({ studentProfiles, branches, syllabusBatchBranches, fetchDailyAttendance }) {
  const [date, setDate]       = useState(null)
  const [rows, setRows]       = useState([])
  const [loaded, setLoaded]   = useState(false)
  const [expanded, setExpanded] = useState(null)  // { branch, batch, key, gender } | null

  // Load latest recorded day on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetchDailyAttendance?.(null)
      if (cancelled || !res) return
      setDate(res.date)
      setRows(res.rows)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [fetchDailyAttendance])

  async function onDateChange(newDate) {
    setDate(newDate)
    setExpanded(null)
    const res = await fetchDailyAttendance?.(newDate)
    if (res) setRows(res.rows)
  }

  const rollup = useMemo(
    () => buildAttendanceRollup({ attendanceRows: rows, studentProfiles, syllabusBatchBranches }),
    [rows, studentProfiles, syllabusBatchBranches],
  )

  // Branch order: configured branches first, then any extras present in the data.
  const dataBranches = Object.keys(rollup)
  const ordered = [
    ...(branches || []).filter(b => dataBranches.includes(b)),
    ...dataBranches.filter(b => !(branches || []).includes(b)),
  ]

  function toggle(cell) {
    setExpanded(prev =>
      prev && prev.branch === cell.branch && prev.batch === cell.batch
          && prev.key === cell.key && prev.gender === cell.gender
        ? null
        : cell,
    )
  }

  return (
    <Card className="mb-4 md:mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <CardTitle>🗓️ Attendance by Branch</CardTitle>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <span>Date</span>
          <input
            type="date"
            aria-label="Attendance date"
            value={date || ''}
            onChange={e => onDateChange(e.target.value)}
            className="form-input w-auto text-[13px] py-1"
          />
        </label>
      </div>

      {!loaded ? (
        <p className="text-[12px] text-ink-3 py-3">Loading attendance…</p>
      ) : !date || ordered.length === 0 ? (
        <p className="text-[12px] text-ink-3 py-3">No attendance recorded{date ? ` for ${date}` : ''}.</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          {ordered.map(branch => (
            <BranchTable
              key={branch}
              branch={branch}
              batches={rollup[branch]}
              expanded={expanded}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
