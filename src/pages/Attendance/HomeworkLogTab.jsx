import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { formatHomeworkItem, homeworkTypeLabel, homeworkItemKey } from '../../lib/homework'
import MarkDefaultersModal from './MarkDefaultersModal'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function deriveType(hw, notes) {
  if (hw && notes) return 'both'
  if (notes) return 'notes'
  if (hw) return 'homework'
  return null
}

// Homework / Notes log: faculty adds a pending item (subject + chapter + type),
// marks which students haven't completed it, and sends a parent alert. Items are
// permanent event-log rows (homework_pending); a per-item Resolve stamp closes
// one once the student submits — the row stays in the log.
export default function HomeworkLogTab({ initialDate, initialBatch, onSend }) {
  const studentProfiles  = useStore(s => s.studentProfiles)
  const mappings         = useStore(s => s.timetableMappings)
  const setDefaulters    = useStore(s => s.setHomeworkDefaultersForItem)
  const getForDate       = useStore(s => s.getHomeworkForDate)
  const getOpenForBatch  = useStore(s => s.getOpenHomeworkForBatch)
  const resolveItem      = useStore(s => s.resolveHomeworkItem)
  const homeworkSendHistory = useStore(s => s.homeworkSendHistory)

  const [date, setDate]           = useState(initialDate ?? todayIso())
  const [batchName, setBatchName] = useState(initialBatch ?? '')
  const [rows, setRows]           = useState([])      // persisted homework_pending rows for `date`
  const [openRows, setOpenRows]   = useState([])      // unresolved rows across dates (resolve list)
  const [drafts, setDrafts]       = useState([])      // locally-added items with 0 defaulters yet
  const [refreshKey, setRefreshKey] = useState(0)
  const [modalItem, setModalItem] = useState(null)    // { subject, chapter, type }

  // Add-item form state
  const [fSubject, setFSubject] = useState('')
  const [fChapter, setFChapter] = useState('')
  const [fHw, setFHw]           = useState(true)
  const [fNotes, setFNotes]     = useState(false)

  // Batch list — union of profile batches
  const availableBatches = useMemo(() => {
    const names = new Set()
    for (const p of Object.values(studentProfiles)) {
      for (const b of (p?.batches || [])) names.add(b)
    }
    return [...names].sort()
  }, [studentProfiles])

  // Subject suggestions from timetable mappings (free text still allowed)
  const subjectOptions = useMemo(
    () => [...new Set(mappings.map(m => m.subject).filter(Boolean))].sort(),
    [mappings]
  )

  const studentsInBatch = useMemo(() => {
    if (!batchName) return []
    const seen = new Set()
    const out = []
    for (const p of Object.values(studentProfiles)) {
      if (!p?.lwsId || seen.has(p.lwsId)) continue
      if (!Array.isArray(p.batches) || !p.batches.includes(batchName)) continue
      seen.add(p.lwsId)
      out.push({ lwsId: p.lwsId, name: p.name })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [studentProfiles, batchName])

  const batchIdSet = useMemo(() => new Set(studentsInBatch.map(s => s.lwsId)), [studentsInBatch])
  const nameByLwsId = useMemo(() => {
    const m = {}
    for (const s of studentsInBatch) m[s.lwsId] = s.name
    return m
  }, [studentsInBatch])

  // Load persisted rows for the date + open items for the batch
  useEffect(() => {
    if (!date || !batchName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]); setOpenRows([])
      return
    }
    let cancelled = false
    const ids = [...batchIdSet]
    Promise.all([getForDate(date), getOpenForBatch(ids)]).then(([dateRows, openR]) => {
      if (cancelled) return
      setRows(dateRows.filter(r => batchIdSet.has(r.lws_id)))
      setOpenRows(openR.filter(r => batchIdSet.has(r.lws_id)))
    })
    return () => { cancelled = true }
  }, [date, batchName, batchIdSet, getForDate, getOpenForBatch, refreshKey])

  // Group persisted rows into per-item cards, merge with un-persisted drafts
  const items = useMemo(() => {
    const byKey = new Map()
    for (const r of rows) {
      const key = homeworkItemKey(r.subject, r.chapter, r.type)
      if (!byKey.has(key)) byKey.set(key, { key, subject: r.subject, chapter: r.chapter, type: r.type, rows: [] })
      byKey.get(key).rows.push(r)
    }
    // Add drafts that have no persisted rows yet
    for (const d of drafts) {
      if (!byKey.has(d.key)) byKey.set(d.key, { key: d.key, subject: d.subject, chapter: d.chapter, type: d.type, rows: [] })
    }
    return [...byKey.values()]
  }, [rows, drafts])

  // Unresolved items per student → wire payload for the preview modal
  const itemsByLwsId = useMemo(() => {
    const out = {}
    for (const r of rows) {
      if (r.resolved_at) continue
      if (!out[r.lws_id]) out[r.lws_id] = []
      out[r.lws_id].push({ subject: r.subject, chapter: r.chapter, type: r.type })
    }
    return out
  }, [rows])

  const totalUnresolved = Object.values(itemsByLwsId).reduce((a, v) => a + v.length, 0)

  function handleAddItem(e) {
    e?.preventDefault?.()
    const subject = fSubject.trim()
    const chapter = fChapter.trim()
    const type = deriveType(fHw, fNotes)
    if (!subject || !chapter || !type) return
    const key = homeworkItemKey(subject, chapter, type)
    setDrafts(prev => prev.some(d => d.key === key) ? prev : [...prev, { key, subject, chapter, type }])
    setFChapter('')
  }

  async function handleSaveDefaulters(lwsIds) {
    if (!modalItem) return
    const ok = await setDefaulters(date, modalItem.subject, modalItem.chapter, modalItem.type, lwsIds)
    if (ok) {
      // Drop the draft (now persisted, or cleared) and re-fetch
      setDrafts(prev => prev.filter(d => d.key !== homeworkItemKey(modalItem.subject, modalItem.chapter, modalItem.type)))
      setRefreshKey(k => k + 1)
    }
  }

  async function handleResolve(id) {
    const ok = await resolveItem(id)
    if (ok) setRefreshKey(k => k + 1)
  }

  const sendKey = batchName ? `${date}|${batchName}` : null
  const history = sendKey ? homeworkSendHistory?.[sendKey] : null
  const hasFailures = (history?.failedNames?.length ?? 0) > 0
  const sendDisabled = totalUnresolved === 0
  const recipientCount = Object.keys(itemsByLwsId).length

  return (
    <div>
      {/* Pickers */}
      <div className="flex flex-wrap gap-3 items-end mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-mono uppercase tracking-widest text-ink-3">Date</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            aria-label="Date"
            className="form-input text-[13px] min-h-[44px] px-3"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-mono uppercase tracking-widest text-ink-3">Batch</span>
          <select
            value={batchName}
            onChange={e => setBatchName(e.target.value)}
            aria-label="Batch"
            className="form-input text-[13px] min-h-[44px] px-3"
          >
            <option value="">— Select batch —</option>
            {availableBatches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => onSend?.(itemsByLwsId, date, batchName)}
            disabled={sendDisabled}
            className={`btn ${history && !hasFailures ? '' : 'btn-primary'} text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed`}
            aria-label="Send homework notifications"
          >
            {history && hasFailures
              ? `Sent ✓${history.sent} · Failed ✗${history.skipped} · Resend`
              : history
                ? '✓ Sent today · Resend all'
                : 'Send Homework / Notes Alerts'}
            {!history && recipientCount > 0 && <span className="ml-2 opacity-80">({recipientCount})</span>}
          </button>
        </div>
      </div>

      {!batchName ? (
        <div className="text-[13px] text-ink-3 italic py-10 text-center">Select a batch to log pending work.</div>
      ) : (
        <>
          {/* Add-item form */}
          <form onSubmit={handleAddItem} className="card px-4 py-3 mb-5 flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Subject</span>
              <input
                list="homework-subjects"
                value={fSubject}
                onChange={e => setFSubject(e.target.value)}
                placeholder="e.g. Maths"
                aria-label="Subject"
                className="form-input text-[13px] min-h-[44px] px-3 w-40"
              />
              <datalist id="homework-subjects">
                {subjectOptions.map(s => <option key={s} value={s} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Chapter</span>
              <input
                value={fChapter}
                onChange={e => setFChapter(e.target.value)}
                placeholder="e.g. Trigonometry"
                aria-label="Chapter"
                className="form-input text-[13px] min-h-[44px] px-3 w-48"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Type</span>
              <div className="flex items-center gap-3 min-h-[44px]">
                <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                  <input type="checkbox" checked={fHw} onChange={e => setFHw(e.target.checked)} className="w-4 h-4" />
                  Homework
                </label>
                <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                  <input type="checkbox" checked={fNotes} onChange={e => setFNotes(e.target.checked)} className="w-4 h-4" />
                  Notes
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={!fSubject.trim() || !fChapter.trim() || (!fHw && !fNotes)}
              className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add item
            </button>
          </form>

          {/* Item cards */}
          {items.length === 0 ? (
            <div className="text-[13px] text-ink-3 italic py-6 text-center">
              No homework items logged for this day. Add one above.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
              {items.map(item => {
                const unresolved = item.rows.filter(r => !r.resolved_at)
                const resolved   = item.rows.filter(r => r.resolved_at)
                const currentIds = item.rows.map(r => r.lws_id)
                return (
                  <div key={item.key} className="card px-4 py-3">
                    <div className="text-[13px] font-semibold text-ink mb-0.5">{item.subject}</div>
                    <div className="text-[12px] text-ink-2 mb-1">{item.chapter}</div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-2">
                      {homeworkTypeLabel(item.type)}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[12px] font-mono ${unresolved.length > 0 ? 'text-red-400' : 'text-ink-3'}`}>
                        {unresolved.length} pending{resolved.length > 0 ? ` · ${resolved.length} done` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => setModalItem({ subject: item.subject, chapter: item.chapter, type: item.type, initial: currentIds })}
                        className="btn text-[12px] min-h-[36px] px-3"
                        aria-label={`Mark pending for ${item.subject} ${item.chapter}`}
                      >
                        Mark pending
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Open items — resolve list (across all dates for this batch) */}
          {openRows.length > 0 && (
            <div className="card px-4 py-3">
              <div className="text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">
                Open items · {openRows.length}
              </div>
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {openRows.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-[12px] py-1">
                    <span className="font-semibold text-ink min-w-[120px]">{nameByLwsId[r.lws_id] || r.lws_id}</span>
                    <span className="text-ink-2">{formatHomeworkItem(r)}</span>
                    <span className="text-ink-3 font-mono ml-auto">{fmtDate(r.date)}</span>
                    <button
                      type="button"
                      onClick={() => handleResolve(r.id)}
                      className="btn text-[11px] min-h-[32px] px-2.5"
                      aria-label={`Resolve ${r.subject} ${r.chapter} for ${nameByLwsId[r.lws_id] || r.lws_id}`}
                    >
                      ✓ Resolved
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <MarkDefaultersModal
        open={modalItem !== null}
        subject={modalItem?.subject ?? ''}
        chapter={modalItem?.chapter ?? ''}
        studentsInBatch={studentsInBatch}
        initialDefaulters={modalItem?.initial ?? []}
        onSave={handleSaveDefaulters}
        onClose={() => setModalItem(null)}
      />
    </div>
  )
}
