import { useState, useEffect, useRef, useMemo } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { supabase } from '../../lib/supabase'
import { parseAttendanceExcel } from '../../lib/excel'
import { EmptyState, PageHeader, Spinner, Alert } from '../../components/ui'

// ── helpers ──────────────────────────────────────────────────

function pctColor(pct) {
  if (pct < 75)  return 'text-red-400'
  if (pct < 85)  return 'text-yellow-400'
  return 'text-green-400'
}

function pctBg(pct) {
  if (pct < 75)  return 'bg-red-400/10 border-red-400/20'
  if (pct < 85)  return 'bg-yellow-400/10 border-yellow-400/20'
  return 'bg-green-400/10 border-green-400/20'
}

function buildStudentStats(records, lwsIdToName) {
  const byLwsId = {}
  for (const r of records) {
    if (!byLwsId[r.lws_id]) byLwsId[r.lws_id] = { p: 0, a: 0 }
    if (r.status === 'P') byLwsId[r.lws_id].p++
    else if (r.status === 'A') byLwsId[r.lws_id].a++
  }
  return Object.entries(byLwsId)
    .map(([lwsId, { p, a }]) => {
      const total = p + a
      return {
        lwsId,
        name: lwsIdToName[lwsId] || lwsId,
        p, a,
        pct: total > 0 ? Math.round((p / total) * 100) : 0,
        total,
      }
    })
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name))
}

// ── page ─────────────────────────────────────────────────────

export default function AttendancePage() {
  const studentProfiles  = useStore(s => s.studentProfiles)
  const importAttendance = useStore(s => s.importAttendance)
  const mode = useMode()

  const [batchFilter,    setBatchFilter]  = useState('all')
  const [records,        setRecords]      = useState([])
  const [loading,        setLoading]      = useState(false)
  const [refreshKey,     setRefreshKey]   = useState(0)
  const [importing,      setImporting]    = useState(false)
  const [importResult,   setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  // All hooks before early returns
  const allBatches = useMemo(() => {
    const seen = new Set()
    const batches = new Set()
    for (const p of Object.values(studentProfiles)) {
      if (!p.lwsId || seen.has(p.lwsId)) continue
      seen.add(p.lwsId)
      ;(p.batches || []).forEach(b => batches.add(b))
    }
    return [...batches].sort()
  }, [studentProfiles])

  // lws_id → canonical name
  const lwsIdToName = useMemo(() => {
    const map = {}
    for (const p of Object.values(studentProfiles)) {
      if (p.lwsId && !map[p.lwsId]) map[p.lwsId] = p.name
    }
    return map
  }, [studentProfiles])

  // lws_ids for selected batch
  const batchLwsIds = useMemo(() => {
    const seen = new Set()
    const ids  = []
    for (const p of Object.values(studentProfiles)) {
      if (!p.lwsId || seen.has(p.lwsId)) continue
      seen.add(p.lwsId)
      if (batchFilter === 'all' || (p.batches || []).includes(batchFilter)) ids.push(p.lwsId)
    }
    return ids
  }, [studentProfiles, batchFilter])

  // Fetch attendance from Supabase
  useEffect(() => {
    if (!supabase || !batchLwsIds.length) { setRecords([]); return }
    let cancelled = false
    setLoading(true)
    supabase.from('student_attendance')
      .select('lws_id, date, status')
      .in('lws_id', batchLwsIds)
      .then(({ data, error }) => {
        if (cancelled) return
        if (!error) setRecords(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [batchLwsIds, refreshKey])

  const studentStats = useMemo(
    () => buildStudentStats(records, lwsIdToName),
    [records, lwsIdToName]
  )

  const classAvg = studentStats.length
    ? Math.round(studentStats.reduce((s, r) => s + r.pct, 0) / studentStats.length)
    : null

  const atRisk = studentStats.filter(r => r.pct < 75).length

  const allDates  = [...new Set(records.map(r => r.date))].sort()
  const dateRange = allDates.length
    ? `${allDates[0]} – ${allDates[allDates.length - 1]}`
    : null

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const parsed = await parseAttendanceExcel(file)
      const result = await importAttendance(parsed)
      setImportResult(result)
      setRefreshKey(k => k + 1)
    } catch (err) {
      setImportResult({ error: err.message })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl">
      <PageHeader
        title="Attendance"
        sub={dateRange ? `Data: ${dateRange}` : 'No attendance data imported yet'}
        actions={
          mode === 'faculty' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={handleImport}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="btn btn-primary flex items-center gap-2 min-h-[44px] px-4"
              >
                {importing ? <Spinner size="sm" /> : '📥'}
                {importing ? 'Importing…' : 'Import XLS'}
              </button>
            </>
          )
        }
      />

      {/* Import result banner */}
      {importResult && (
        <div className="mb-5">
          {importResult.error
            ? <Alert type="error">❌ {importResult.error}</Alert>
            : (
              <Alert type="success">
                ✓ Matched {importResult.matched} students
                ({importResult.upserted} records saved)
                {importResult.unmatched > 0 && ` · ${importResult.unmatched} not found in profiles`}
              </Alert>
            )
          }
        </div>
      )}

      {/* Batch filter */}
      {allBatches.length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">Batch</span>
          <button
            onClick={() => setBatchFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all min-h-[36px]
              ${batchFilter === 'all' ? 'bg-indigo-300/20 text-indigo-300' : 'text-ink-3 hover:text-ink-2'}`}
          >
            All
          </button>
          {allBatches.map(b => (
            <button
              key={b}
              onClick={() => setBatchFilter(b)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all min-h-[36px] truncate max-w-[200px]
                ${batchFilter === b ? 'bg-indigo-300/20 text-indigo-300' : 'text-ink-3 hover:text-ink-2'}`}
            >
              {b}
            </button>
          ))}
        </div>
      )}

      {/* Summary bar */}
      {studentStats.length > 0 && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">Class avg</span>
            <span className={`text-[22px] font-extrabold ${pctColor(classAvg)}`}>{classAvg}%</span>
          </div>
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">At risk</span>
            <span className="text-[22px] font-extrabold text-red-400">{atRisk}</span>
            <span className="text-[11px] text-ink-3">below 75%</span>
          </div>
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">Students</span>
            <span className="text-[22px] font-extrabold text-ink-2">{studentStats.length}</span>
          </div>
        </div>
      )}

      {/* Table */}
      {loading
        ? (
          <div className="flex items-center gap-3 py-16 justify-center text-ink-3">
            <Spinner /> Loading attendance…
          </div>
        )
        : studentStats.length === 0
          ? (
            <EmptyState
              icon="📋"
              title="No attendance data"
              sub={mode === 'faculty'
                ? 'Import an attendance XLS file to get started.'
                : 'No attendance records available for this batch.'}
            />
          )
          : (
            <div className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[10.5px] font-mono uppercase tracking-widest text-ink-3">
                    <th className="text-left px-4 py-3">Student</th>
                    <th className="text-right px-4 py-3">Present</th>
                    <th className="text-right px-4 py-3">Absent</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-right px-4 py-3 pr-5">Avg %</th>
                  </tr>
                </thead>
                <tbody>
                  {studentStats.map((s, i) => (
                    <tr
                      key={s.lwsId}
                      className={`border-b border-border hover:bg-accent-soft/30 transition-colors
                        ${i % 2 === 0 ? '' : 'bg-surface-2/40'}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                      <td className="px-4 py-2.5 text-right text-green-500 font-mono">{s.p}</td>
                      <td className="px-4 py-2.5 text-right text-red-400 font-mono">{s.a}</td>
                      <td className="px-4 py-2.5 text-right text-ink-3 font-mono">{s.total}</td>
                      <td className="px-4 py-2.5 text-right pr-5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono border
                          ${pctBg(s.pct)} ${pctColor(s.pct)}`}>
                          {s.pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      }
    </div>
  )
}
