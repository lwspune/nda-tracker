import { useState, useEffect, useRef } from 'react'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx-js-style'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { PageHeader, EmptyState } from '../../components/ui'
import TimetableGrid from './TimetableGrid'
import EditCellModal from './EditCellModal'
import ManageMappingsModal from './ManageMappingsModal'
import AddTimetableModal from './AddTimetableModal'
import AddSlotModal from './AddSlotModal'
import SendScheduleModal from './SendScheduleModal'
import ExamScheduleView from './ExamScheduleView'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Helpers ───────────────────────────────────────────────

function parseTimeToMinutes(str) {
  if (!str) return null
  const s = str.trim().toUpperCase()
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = parseInt(m12[2], 10)
    if (min >= 60 || h < 1 || h > 12) return null
    if (m12[3] === 'PM' && h !== 12) h += 12
    if (m12[3] === 'AM' && h === 12) h = 0
    return h * 60 + min
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10), min = parseInt(m24[2], 10)
    if (h > 23 || min >= 60) return null
    return h * 60 + min
  }
  return null
}

// Group raw entries into display rows sorted chronologically by start time
function groupScheduleRows(rows) {
  const map = new Map()
  for (const { timetable, slot, day, mapping } of rows) {
    const key = `${timetable.id}__${slot.id}__${mapping.id}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        branch:       timetable.branch,
        batchName:    timetable.batchName,
        startTime:    slot.startTime,
        endTime:      slot.endTime,
        startMinutes: parseTimeToMinutes(slot.startTime) ?? 0,
        endMinutes:   parseTimeToMinutes(slot.endTime)   ?? 0,
        subject:      mapping.label,
        days:         [],
        clashDays:    [],
      })
    }
    map.get(key).days.push(day)
  }
  return [...map.values()].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes
    return `${a.branch} ${a.batchName}`.localeCompare(`${b.branch} ${b.batchName}`)
  })
}

// Mutates rows[].clashDays; returns clash summary objects
function detectClashes(rows) {
  const summaries = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      // No overlap if one ends before the other starts
      if (a.startMinutes >= b.endMinutes || b.startMinutes >= a.endMinutes) continue
      const sharedDays = a.days.filter(d => b.days.includes(d))
      if (!sharedDays.length) continue
      for (const day of sharedDays) {
        if (!a.clashDays.includes(day)) a.clashDays.push(day)
        if (!b.clashDays.includes(day)) b.clashDays.push(day)
        summaries.push({
          day,
          labelA: `${a.branch} — ${a.batchName}: ${a.startTime}–${a.endTime} (${a.subject})`,
          labelB: `${b.branch} — ${b.batchName}: ${b.startTime}–${b.endTime} (${b.subject})`,
        })
      }
    }
  }
  return summaries
}

function downloadTimetableExcel(timetable, mappings) {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const FONT = 'Times New Roman'
  const BORDER = { style: 'thin', color: { rgb: '000000' } }
  const border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }

  const cell = (v, s) => ({ v, t: 's', s })

  const titleStyle = {
    font: { name: FONT, bold: true, sz: 13 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const headerStyle = {
    font: { name: FONT, bold: true, sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const timeStyle = {
    font: { name: FONT, bold: true, sz: 10 },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border,
  }
  const bodyStyle = {
    font: { name: FONT, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const spanLabelStyle = {
    font: { name: FONT, bold: true, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }

  const slots = [...timetable.timeSlots].sort(
    (a, b) => (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0)
  )
  const { grid } = timetable
  const rows = []
  const merges = []
  const rowHeights = []

  // Row 0: title
  rows.push([
    cell(`${timetable.branch} — ${timetable.batchName}`, titleStyle),
    ...Array(6).fill(cell('', titleStyle)),
  ])
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } })
  rowHeights.push({ hpt: 28 })

  // Row 1: headers
  rows.push(['Time', ...DAYS].map(h => cell(h, headerStyle)))
  rowHeights.push({ hpt: 20 })

  for (const slot of slots) {
    const timeLabel = `${slot.startTime} – ${slot.endTime}`
    const span = grid[slot.id]?.['__span']
    const r = rows.length

    if (span) {
      rows.push([
        cell(timeLabel, timeStyle),
        cell(span.label || 'Break', spanLabelStyle),
        ...Array(5).fill(cell('', spanLabelStyle)),
      ])
      merges.push({ s: { r, c: 1 }, e: { r, c: 6 } })
    } else {
      const row = [cell(timeLabel, timeStyle)]
      for (const day of DAYS) {
        const c = grid[slot.id]?.[day]
        if (!c) { row.push(cell('', bodyStyle)); continue }
        if (c.type === 'class') {
          const m = mappings.find(m => m.id === c.mappingId)
          row.push(cell(m ? m.label : '', bodyStyle))
        } else {
          row.push(cell(c.label || 'Break', bodyStyle))
        }
      }
      rows.push(row)
    }
    rowHeights.push({ hpt: 22 })
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!merges'] = merges
  ws['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }]
  ws['!rows'] = rowHeights

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Timetable')

  // Browser-native download (XLSX.writeFile uses Node's fs which Vite
  // externalises — calling it from the browser throws "Cannot access
  // .writeFileSync in client code").
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${timetable.branch}-${timetable.batchName}-timetable.xlsx`
    .replace(/[^a-z0-9.]+/gi, '-').toLowerCase()
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────

export default function TimetablePage() {
  const mode      = useMode()
  const isAdmin = mode === 'admin'

  const timetables = useStore(s => s.timetables)
  const teachers   = useStore(s => s.timetableTeachers)
  const mappings   = useStore(s => s.timetableMappings)

  const branches = [...new Set(timetables.map(t => t.branch))].sort()

  const [view, setView]                         = useState('grid')
  const [selectedBranch, setSelectedBranch]     = useState(null)
  const [selectedTTId, setSelectedTTId]         = useState(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState('')

  const gridRef = useRef(null)

  const [mappingsModalOpen, setMappingsModalOpen]   = useState(false)
  const [addTTModal, setAddTTModal]                 = useState(null)
  const [editCell, setEditCell]                     = useState(null)
  const [slotModal, setSlotModal]                   = useState(null)
  // sendSchedule: null | { teacherId: string|null }
  const [sendSchedule, setSendSchedule]             = useState(null)

  useEffect(() => {
    if (branches.length && (!selectedBranch || !branches.includes(selectedBranch))) {
      setSelectedBranch(branches[0])
    }
  }, [branches.join(',')])

  const branchTTs = timetables.filter(t => t.branch === selectedBranch)
  useEffect(() => {
    if (!branchTTs.find(t => t.id === selectedTTId)) {
      setSelectedTTId(branchTTs[0]?.id ?? null)
    }
  }, [selectedBranch, timetables.length])

  const activeTT = timetables.find(t => t.id === selectedTTId) ?? null

  function getTeacherSchedule(teacherId) {
    const results = []
    for (const tt of timetables) {
      for (const slot of tt.timeSlots) {
        const row = tt.grid[slot.id] ?? {}
        for (const [day, cell] of Object.entries(row)) {
          if (day === '__span') continue
          if (cell?.type !== 'class') continue
          const m = mappings.find(m => m.id === cell.mappingId)
          if (m?.teacherId === teacherId) results.push({ timetable: tt, slot, day, mapping: m })
        }
      }
    }
    return results
  }

  // Derived teacher schedule state (computed each render — fresh objects, safe to mutate)
  const rawRows      = selectedTeacherId ? getTeacherSchedule(selectedTeacherId) : []
  const groupedRows  = groupScheduleRows(rawRows)
  const clashes      = detectClashes(groupedRows)
  const totalClasses = groupedRows.reduce((sum, r) => sum + r.days.length, 0)
  const totalHours   = groupedRows.reduce((sum, r) => {
    const mins = r.endMinutes - r.startMinutes
    return sum + (mins > 0 ? mins / 60 * r.days.length : 0)
  }, 0)

  const [pngLoading, setPngLoading] = useState(false)

  async function handleDownloadPng() {
    if (!gridRef.current || !activeTT) return
    setPngLoading(true)

    // Clone just the <table> — avoids the overflow-x-auto scroll container
    // (which causes the scrollbar artifact and cuts off the last row).
    const table = gridRef.current.querySelector('table')
    if (!table) { setPngLoading(false); return }

    const clone = table.cloneNode(true)

    // Apply export-only visual overrides directly to cloned nodes.
    // html-to-image reads getComputedStyle, so inline styles take precedence.
    clone.querySelectorAll('thead th').forEach(th => {
      th.style.background    = '#312e81'  // indigo-900
      th.style.color         = '#e0e7ff'  // indigo-100
      th.style.borderColor   = '#4338ca'
      th.style.padding       = '10px 14px'
      th.style.fontSize      = '11px'
      th.style.letterSpacing = '0.08em'
    })
    clone.querySelectorAll('tbody td').forEach(td => {
      td.style.borderColor = '#e2e8f0'  // crisp light border
    })
    // Time column (first td per row): distinct slate background
    clone.querySelectorAll('tbody tr').forEach(tr => {
      const td = tr.querySelector('td')
      if (td) {
        td.style.background  = '#f1f5f9'  // slate-100
        td.style.color       = '#334155'  // slate-700
        td.style.borderColor = '#e2e8f0'
        td.style.fontWeight  = '600'
      }
    })

    // Outer wrapper: white background + padding + title header
    const wrapper = document.createElement('div')
    wrapper.style.cssText = [
      'position: fixed', 'top: -99999px', 'left: -99999px',
      'background: #ffffff', 'padding: 28px 32px',
      'display: inline-block', 'min-width: max-content',
      'font-family: system-ui, sans-serif',
    ].join('; ')

    const titleBar = document.createElement('div')
    titleBar.style.cssText = 'margin-bottom: 16px; padding-bottom: 14px; border-bottom: 2px solid #e0e7ff;'

    const titleEl = document.createElement('div')
    titleEl.style.cssText = 'font-size: 17px; font-weight: 700; color: #1e1b4b; letter-spacing: -0.4px;'
    titleEl.textContent = `${activeTT.branch} — ${activeTT.batchName}`

    const subEl = document.createElement('div')
    subEl.style.cssText = 'font-size: 11px; color: #9ca3af; margin-top: 3px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em;'
    subEl.textContent = 'Class Timetable'

    titleBar.appendChild(titleEl)
    titleBar.appendChild(subEl)
    wrapper.appendChild(titleBar)
    wrapper.appendChild(clone)
    document.body.appendChild(wrapper)

    try {
      // html2canvas walks the DOM and paints to canvas directly — no SVG
      // foreignObject, so the page's @import/font-face stylesheet rules can't
      // silently break the render (html-to-image's failure mode produced an
      // all-transparent PNG even with skipFonts).
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      })
      const dataUrl = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = `${activeTT.branch}-${activeTT.batchName}-timetable.png`
        .replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      link.href = dataUrl
      link.click()
    } catch (e) {
      console.error('[timetable] PNG export failed:', e)
    } finally {
      document.body.removeChild(wrapper)
      setPngLoading(false)
    }
  }

  function handleCellClick(slotId, day, currentCell) {
    if (!isAdmin || !activeTT) return
    setEditCell({ timetableId: activeTT.id, slotId, day, cell: currentCell ?? null })
  }

  return (
    <div>
      <PageHeader
        title="Timetable"
        sub={
          view === 'grid'    ? (selectedBranch ? `${selectedBranch} — ${activeTT?.batchName ?? 'Select a batch'}` : 'No timetables yet')
          : view === 'teacher' ? 'Teacher Schedule'
          : 'Exam Schedule'
        }
        actions={isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={() => setMappingsModalOpen(true)}>
              Mappings
            </button>
            <button className="btn btn-primary text-[12px] px-3 py-1.5" onClick={() => setAddTTModal('new')}>
              + Timetable
            </button>
          </div>
        )}
      />

      {/* View toggle */}
      <div className="flex gap-2 mb-5">
        {[
          { key: 'grid',    label: 'Student View' },
          { key: 'teacher', label: 'Teacher Schedule' },
          { key: 'exam',    label: 'Exam Schedule' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${
              view === key
                ? 'bg-accent text-white border-accent'
                : 'bg-surface border-border text-ink-2 hover:border-accent/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Grid view ────────────────────────────────────── */}
      {view === 'grid' && (
        <>
          {timetables.length === 0 ? (
            <EmptyState
              icon="🗓"
              title="No timetables yet"
              sub={isAdmin ? 'Click "+ Timetable" to create your first timetable.' : 'No timetables have been set up yet.'}
            />
          ) : (
            <>
              {/* Branch tabs */}
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                <span className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mr-1">Branch</span>
                {branches.map(b => (
                  <button
                    key={b}
                    onClick={() => setSelectedBranch(b)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                      b === selectedBranch
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                    }`}
                  >{b}</button>
                ))}
              </div>

              {/* Batch tabs */}
              {branchTTs.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-5 border-b border-border pb-0">
                  {branchTTs.map(tt => (
                    <div key={tt.id} className="flex items-center">
                      <button
                        onClick={() => setSelectedTTId(tt.id)}
                        className={`px-4 py-2.5 text-[13px] font-semibold rounded-t-lg border-b-2 transition-colors ${
                          tt.id === selectedTTId
                            ? 'border-accent text-accent'
                            : 'border-transparent text-ink-3 hover:text-ink'
                        }`}
                      >{tt.batchName}</button>
                      {isAdmin && tt.id === selectedTTId && (
                        <button
                          className="ml-0.5 mb-0.5 p-1 rounded text-ink-3 hover:text-ink hover:bg-surface-2 text-[12px] transition-colors"
                          onClick={() => setAddTTModal(tt)}
                          title="Edit timetable"
                        >⚙</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {activeTT && (
                <>
                  <div ref={gridRef} className="inline-block min-w-full">
                    <TimetableGrid
                      timetable={activeTT}
                      mappings={mappings}
                      onCellClick={isAdmin ? handleCellClick : undefined}
                      readOnly={!isAdmin}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 items-center">
                    {isAdmin && (
                      <>
                        <button
                          className="btn text-[12px] px-3 py-1.5 border border-dashed border-border text-ink-3 hover:border-accent/50 hover:text-ink transition-colors"
                          onClick={() => setSlotModal({ timetableId: activeTT.id })}
                        >+ Add time slot</button>
                        {activeTT.timeSlots.length > 0 && (
                          <span className="text-[11px] text-ink-3">Click a cell to assign a subject/teacher.</span>
                        )}
                      </>
                    )}
                    {activeTT.timeSlots.length > 0 && (
                      <div className="flex gap-2 ml-auto">
                        <button
                          className="btn text-[12px] px-3 py-1.5 border border-border text-ink-2 hover:border-accent/50 hover:text-ink transition-colors disabled:opacity-40"
                          onClick={handleDownloadPng}
                          disabled={pngLoading}
                        >
                          {pngLoading ? 'Exporting…' : '⬇ PNG'}
                        </button>
                        <button
                          className="btn text-[12px] px-3 py-1.5 border border-border text-ink-2 hover:border-accent/50 hover:text-ink transition-colors"
                          onClick={() => downloadTimetableExcel(activeTT, mappings)}
                        >
                          ⬇ Excel
                        </button>
                      </div>
                    )}
                  </div>

                  {isAdmin && activeTT.timeSlots.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {activeTT.timeSlots.map(slot => (
                        <button
                          key={slot.id}
                          className="text-[10px] px-2 py-0.5 rounded border border-border text-ink-3 hover:border-accent/50 hover:text-ink transition-colors"
                          onClick={() => setSlotModal({ timetableId: activeTT.id, slot })}
                        >
                          Edit {slot.startTime}–{slot.endTime}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ── Teacher view ─────────────────────────────────── */}
      {view === 'teacher' && (
        <div className="space-y-4">
          {/* Teacher selector + send all */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <label className="text-[11px] font-bold text-ink-3 uppercase tracking-wide">
                Select Teacher
              </label>
              {isAdmin && teachers.length > 0 && (
                <button
                  className="ml-auto btn text-[11px] px-3 py-1 border border-border text-ink-2 hover:border-accent/50 hover:text-ink transition-colors"
                  onClick={() => setSendSchedule({ teacherId: null })}
                >
                  ✉ Send all schedules
                </button>
              )}
            </div>
            {teachers.length === 0 ? (
              <p className="text-[13px] text-ink-3 italic">
                No teachers yet.{isAdmin && ' Add teachers via the Teachers button.'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {teachers.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTeacherId(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                      t.id === selectedTeacherId
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                    }`}
                  >{t.name}</button>
                ))}
              </div>
            )}
          </div>

          {selectedTeacherId && (
            groupedRows.length === 0 ? (
              <div className="card text-center py-10">
                <div className="text-2xl mb-2 opacity-30">📅</div>
                <div className="text-[14px] font-bold mb-1">No assignments</div>
                <div className="text-[12px] text-ink-3">
                  {teachers.find(t => t.id === selectedTeacherId)?.name} has no classes assigned yet.
                </div>
              </div>
            ) : (
              <div className="space-y-3">

                {/* Summary bar — faculty only */}
                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-6 px-5 py-3 rounded-lg bg-surface-2 border border-border">
                    <div>
                      <div className="text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Classes / Week</div>
                      <div className="text-[24px] font-bold text-ink leading-none">{totalClasses}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Hours / Week</div>
                      <div className="text-[24px] font-bold text-ink leading-none">{totalHours.toFixed(1)}</div>
                    </div>
                    {clashes.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-1">Clashes</div>
                        <div className="text-[24px] font-bold text-red-400 leading-none">{clashes.length}</div>
                      </div>
                    )}
                    <button
                      className="ml-auto btn text-[11px] px-3 py-1.5 border border-border text-ink-2 hover:border-accent/50 hover:text-ink transition-colors"
                      onClick={() => setSendSchedule({ teacherId: selectedTeacherId })}
                    >
                      ✉ Send schedule
                    </button>
                  </div>
                )}

                {/* Clash banner — visible to all modes */}
                {clashes.length > 0 && (
                  <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-400/25">
                    <div className="text-[12px] font-bold text-red-400 mb-2">
                      ⚠ {clashes.length} scheduling clash{clashes.length !== 1 ? 'es' : ''} detected
                    </div>
                    <ul className="space-y-1.5">
                      {clashes.map((c, i) => (
                        <li key={i} className="text-[11px] text-red-400/80 leading-snug">
                          <span className="font-semibold">{c.day}:</span> {c.labelA} ↔ {c.labelB}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Schedule table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px] min-w-[520px]">
                    <thead>
                      <tr>
                        <th className="border border-border bg-surface-2 px-3 py-2.5 text-left font-bold text-ink-2 text-[11px] uppercase tracking-wide">Batch</th>
                        <th className="border border-border bg-surface-2 px-3 py-2.5 text-left font-bold text-ink-2 text-[11px] uppercase tracking-wide">Time</th>
                        <th className="border border-border bg-surface-2 px-3 py-2.5 text-left font-bold text-ink-2 text-[11px] uppercase tracking-wide">Subject</th>
                        {DAYS.map(d => (
                          <th key={d} className="border border-border bg-surface-2 px-2 py-2.5 font-bold text-ink-2 text-[11px] uppercase tracking-wide text-center w-8">
                            {d.slice(0, 2)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupedRows.map(row => (
                        <tr
                          key={row.key}
                          className={row.clashDays.length > 0 ? 'border-l-[3px] border-l-red-400' : ''}
                        >
                          <td className="border border-border px-3 py-2.5">
                            <div className="font-semibold text-ink">{row.batchName}</div>
                            <div className="text-[10px] text-ink-3 mt-0.5">{row.branch}</div>
                          </td>
                          <td className="border border-border px-3 py-2.5 whitespace-nowrap">
                            <div className="font-medium text-ink">{row.startTime}</div>
                            <div className="text-[10px] text-ink-3">to {row.endTime}</div>
                          </td>
                          <td className="border border-border px-3 py-2.5 font-semibold text-accent">{row.subject}</td>
                          {DAYS.map(d => {
                            const active   = row.days.includes(d)
                            const clashing = active && row.clashDays.includes(d)
                            return (
                              <td key={d} className={`border border-border px-2 py-2.5 text-center text-[12px] font-bold ${
                                clashing ? 'bg-red-500/15 text-red-400'
                                  : active ? 'bg-accent-soft text-accent'
                                  : ''
                              }`}>
                                {clashing ? '⚠' : active ? '✓' : ''}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── Exam Schedule view ───────────────────────────── */}
      {view === 'exam' && <ExamScheduleView />}

      {/* ── Modals ───────────────────────────────────────── */}
      {mappingsModalOpen && <ManageMappingsModal onClose={() => setMappingsModalOpen(false)} />}
      {addTTModal && (
        <AddTimetableModal
          timetable={addTTModal === 'new' ? null : addTTModal}
          onClose={() => setAddTTModal(null)}
        />
      )}
      {editCell && (
        <EditCellModal
          timetableId={editCell.timetableId}
          slotId={editCell.slotId}
          day={editCell.day}
          currentCell={editCell.cell}
          onClose={() => setEditCell(null)}
        />
      )}
      {slotModal && (
        <AddSlotModal
          timetableId={slotModal.timetableId}
          slot={slotModal.slot ?? null}
          onClose={() => setSlotModal(null)}
        />
      )}
      {sendSchedule && (
        <SendScheduleModal
          teacherId={sendSchedule.teacherId}
          onClose={() => setSendSchedule(null)}
        />
      )}
    </div>
  )
}
