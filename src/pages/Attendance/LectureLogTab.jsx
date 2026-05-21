import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { getTodaysLectures } from '../../lib/timetable'
import MarkAbsenteesModal from './MarkAbsenteesModal'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Lecture log: per-period cards for one (date, batch). Faculty clicks a card,
// picks the students who missed that lecture, saves. Cards re-render with the
// new count. Send button hands per-student subject lists to the parent for the
// notification preview modal.
export default function LectureLogTab({ initialDate, initialBatch, onSend }) {
  const studentProfiles    = useStore(s => s.studentProfiles)
  const timetables         = useStore(s => s.timetables)
  const mappings           = useStore(s => s.timetableMappings)
  const setForPeriod       = useStore(s => s.setLectureAbsenteesForPeriod)
  const getAbsencesForDate = useStore(s => s.getLectureAbsencesForDate)

  const [date, setDate]           = useState(initialDate ?? todayIso())
  const [batchName, setBatchName] = useState(initialBatch ?? '')
  const [absencesBySubject, setAbsencesBySubject] = useState({}) // { subject: [lwsId] }
  const [modalSubject, setModalSubject] = useState(null)

  // Available batches: union of all timetable batch names
  const availableBatches = useMemo(() => {
    const names = new Set(timetables.map(t => t.batchName))
    return [...names].sort()
  }, [timetables])

  // Selected timetable
  const timetable = useMemo(
    () => timetables.find(t => t.batchName === batchName) ?? null,
    [timetables, batchName]
  )

  // Today's periods from the timetable
  const lectures = useMemo(
    () => getTodaysLectures(timetable, date, mappings),
    [timetable, date, mappings]
  )

  // Students in the selected batch (deduped, sorted by name)
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

  const batchIdSet = useMemo(
    () => new Set(studentsInBatch.map(s => s.lwsId)),
    [studentsInBatch]
  )

  // Load existing absences for the date, filter to this batch
  useEffect(() => {
    if (!date || !batchName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAbsencesBySubject({})
      return
    }
    let cancelled = false
    getAbsencesForDate(date).then(rows => {
      if (cancelled) return
      const grouped = {}
      for (const r of rows) {
        if (!batchIdSet.has(r.lws_id)) continue
        if (!grouped[r.subject]) grouped[r.subject] = []
        grouped[r.subject].push(r.lws_id)
      }
      setAbsencesBySubject(grouped)
    })
    return () => { cancelled = true }
  }, [date, batchName, getAbsencesForDate, batchIdSet])

  async function handleSavePeriod(lwsIds) {
    if (!modalSubject) return
    const ok = await setForPeriod(date, modalSubject, lwsIds)
    if (ok) {
      setAbsencesBySubject(prev => ({ ...prev, [modalSubject]: lwsIds }))
    }
  }

  // Per-student subject list for the Send button
  const absencesByLwsId = useMemo(() => {
    const out = {}
    for (const [subject, ids] of Object.entries(absencesBySubject)) {
      for (const id of ids) {
        if (!out[id]) out[id] = []
        if (!out[id].includes(subject)) out[id].push(subject)
      }
    }
    return out
  }, [absencesBySubject])

  const totalAbsences = Object.values(absencesBySubject).reduce((acc, ids) => acc + ids.length, 0)

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
            onClick={() => onSend?.(absencesByLwsId, date)}
            disabled={totalAbsences === 0}
            className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send Lecture-Miss Notifications"
          >
            Send Lecture-Miss Notifications
            {totalAbsences > 0 && <span className="ml-2 opacity-80">({Object.keys(absencesByLwsId).length})</span>}
          </button>
        </div>
      </div>

      {/* Period cards */}
      {!batchName ? (
        <div className="text-[13px] text-ink-3 italic py-10 text-center">Select a batch to view today's lectures.</div>
      ) : !timetable ? (
        <div className="text-[13px] text-ink-3 italic py-10 text-center">
          No timetable for this batch — set one up first.
        </div>
      ) : lectures.length === 0 ? (
        <div className="text-[13px] text-ink-3 italic py-10 text-center">
          No lectures scheduled for this day.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lectures.map(lec => {
            const count = (absencesBySubject[lec.subject] || []).length
            return (
              <div
                key={lec.slotId}
                className="card px-4 py-3"
              >
                <div className="text-[13px] font-semibold text-ink mb-1">{lec.subject}</div>
                <div className="text-[11px] font-mono text-ink-3 mb-2">
                  {lec.startTime} – {lec.endTime}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[12px] font-mono ${count > 0 ? 'text-red-400' : 'text-ink-3'}`}
                  >
                    {count} absent
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalSubject(lec.subject)}
                    className="btn text-[12px] min-h-[36px] px-3"
                    aria-label={`Mark absentees for ${lec.subject}`}
                  >
                    Mark absentees
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <MarkAbsenteesModal
        open={modalSubject !== null}
        date={date}
        subject={modalSubject ?? ''}
        studentsInBatch={studentsInBatch}
        initialAbsentees={modalSubject ? (absencesBySubject[modalSubject] || []) : []}
        onSave={handleSavePeriod}
        onClose={() => setModalSubject(null)}
      />
    </div>
  )
}
