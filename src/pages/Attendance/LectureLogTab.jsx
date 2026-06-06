import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { getTodaysLectures } from '../../lib/timetable'
import MarkAbsenteesModal from './MarkAbsenteesModal'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Impromptu (ad-hoc) lectures have no timetable slot, so we mint a synthetic
// slot_id. The `adhoc_` prefix is what distinguishes them from timetable slots
// (`slot_*`) on reconstruction. Module-level counter keeps ids unique within a
// session; once marked, the id is persisted on the lecture_absences rows.
let _adhocSeq = 0
const mintAdhocId = () => `adhoc_${Date.now().toString(36)}_${(++_adhocSeq).toString(36)}`

// Lecture log: per-period cards for one (date, batch). Faculty clicks a card,
// picks the students who missed that lecture, saves. Cards re-render with the
// new count. Send button hands per-student subject lists to the parent for the
// notification preview modal.
//
// Keying by slot_id (not subject) so two same-subject periods on the same day
// stay independent — see lecture_absences UNIQUE (lws_id, date, slot_id).
export default function LectureLogTab({ initialDate, initialBatch, onSend }) {
  const studentProfiles    = useStore(s => s.studentProfiles)
  const timetables         = useStore(s => s.timetables)
  const mappings           = useStore(s => s.timetableMappings)
  const setForPeriod       = useStore(s => s.setLectureAbsenteesForPeriod)
  const getAbsencesForDate = useStore(s => s.getLectureAbsencesForDate)
  // Per-(date, batch) send history — keyed by `${date}|${batchName}` so two
  // batches sent on the same day stay independent. Read here to render the
  // contextual send-button label; AttendancePage writes it after each send.
  const lectureMissSendHistory = useStore(s => s.lectureMissSendHistory)

  const [date, setDate]           = useState(initialDate ?? todayIso())
  const [batchName, setBatchName] = useState(initialBatch ?? '')
  const [absencesBySlot, setAbsencesBySlot] = useState({}) // { slotId: [lwsId] }
  // Open-modal context. null = closed. Otherwise { slotId, subject, adhoc?,
  // startTime?, endTime? } so the save handler can key by slot_id, persist the
  // subject for display, and (for ad-hoc) persist the entered time.
  const [modalSlot, setModalSlot] = useState(null)
  // Impromptu lectures created/reconstructed for this (date, batch).
  // Shape: { slotId, subject, startTime, endTime }.
  const [adhocLectures, setAdhocLectures] = useState([])
  const [adhocForm, setAdhocForm] = useState(null) // null = hidden; else { subject, start, end }

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

  // slot_id → lecture for quick lookups (subject + time). Combines timetabled
  // periods AND impromptu lectures so absencesByLwsId (the send payload) picks
  // up ad-hoc absences too — without this merge they'd be silently dropped.
  const lecturesBySlotId = useMemo(() => {
    const map = {}
    for (const lec of lectures) map[lec.slotId] = lec
    for (const a of adhocLectures) {
      map[a.slotId] = { slotId: a.slotId, subject: a.subject, startTime: a.startTime, endTime: a.endTime }
    }
    return map
  }, [lectures, adhocLectures])

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

  // Load existing absences for the date, filter to this batch's students,
  // and group by slot_id so each card reads its own count.
  useEffect(() => {
    if (!date || !batchName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAbsencesBySlot({})
      setAdhocLectures([])
      return
    }
    let cancelled = false
    getAbsencesForDate(date).then(rows => {
      if (cancelled) return
      const grouped = {}
      const adhocMeta = {} // slotId → { slotId, subject, startTime, endTime } reconstructed from rows
      for (const r of rows) {
        if (!batchIdSet.has(r.lws_id)) continue
        if (!r.slot_id) continue // legacy/orphan rows without slot_id are skipped
        if (!grouped[r.slot_id]) grouped[r.slot_id] = []
        grouped[r.slot_id].push(r.lws_id)
        if (r.slot_id.startsWith('adhoc_') && !adhocMeta[r.slot_id]) {
          adhocMeta[r.slot_id] = {
            slotId: r.slot_id, subject: r.subject,
            startTime: r.start_time ?? null, endTime: r.end_time ?? null,
          }
        }
      }
      setAbsencesBySlot(grouped)
      // Reset ad-hoc cards to those reconstructed from persisted rows. Cards
      // created in-session but never marked (no rows) intentionally don't
      // survive a date/batch switch.
      setAdhocLectures(Object.values(adhocMeta))
    })
    return () => { cancelled = true }
  }, [date, batchName, getAbsencesForDate, batchIdSet])

  async function handleSavePeriod(lwsIds) {
    if (!modalSlot?.slotId) return
    // Timetabled cards call the 4-arg form (time re-derived from the timetable
    // at send-time); ad-hoc cards pass the entered time so it persists.
    const ok = modalSlot.adhoc
      ? await setForPeriod(date, modalSlot.slotId, modalSlot.subject, lwsIds,
          { startTime: modalSlot.startTime ?? null, endTime: modalSlot.endTime ?? null })
      : await setForPeriod(date, modalSlot.slotId, modalSlot.subject, lwsIds)
    if (ok) {
      setAbsencesBySlot(prev => ({ ...prev, [modalSlot.slotId]: lwsIds }))
    }
  }

  function addAdhocLecture() {
    const subject = (adhocForm?.subject || '').trim()
    if (!subject) return
    setAdhocLectures(prev => [...prev, {
      slotId: mintAdhocId(), subject,
      startTime: (adhocForm.start || '').trim() || null,
      endTime:   (adhocForm.end || '').trim() || null,
    }])
    setAdhocForm(null)
  }

  async function removeAdhocLecture(lec) {
    await setForPeriod(date, lec.slotId, lec.subject, []) // clears any persisted rows
    setAdhocLectures(prev => prev.filter(a => a.slotId !== lec.slotId))
    setAbsencesBySlot(prev => {
      const next = { ...prev }
      delete next[lec.slotId]
      return next
    })
  }

  // Per-student missed-subject list with time info, derived by looking up the
  // slot in today's lectures. Shape: { lwsId: [{ subject, startTime?, endTime? }] }
  const absencesByLwsId = useMemo(() => {
    const out = {}
    for (const [slotId, ids] of Object.entries(absencesBySlot)) {
      const lec = lecturesBySlotId[slotId]
      if (!lec) continue // slot no longer in today's timetable — skip (drift)
      for (const id of ids) {
        if (!out[id]) out[id] = []
        out[id].push({
          subject:   lec.subject,
          startTime: lec.startTime,
          endTime:   lec.endTime,
        })
      }
    }
    return out
  }, [absencesBySlot, lecturesBySlotId])

  const totalAbsences = Object.values(absencesBySlot).reduce((acc, ids) => acc + ids.length, 0)

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
          {(() => {
            const history = batchName ? lectureMissSendHistory?.[`${date}|${batchName}`] : null
            const disabled = totalAbsences === 0
            const notifiedSet = new Set(history?.notifiedLwsIds || [])
            const absentIds = Object.keys(absencesByLwsId)
            const pendingCount = absentIds.filter(id => !notifiedSet.has(id)).length
            // No send yet → first-send button.
            if (!history) {
              return (
                <button
                  type="button"
                  onClick={() => onSend?.(absencesByLwsId, date, batchName)}
                  disabled={disabled}
                  className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send Lecture-Miss Notifications"
                >
                  Send Lecture-Miss Notifications
                  {totalAbsences > 0 && <span className="ml-2 opacity-80">({absentIds.length})</span>}
                </button>
              )
            }
            // Some absentees not yet notified (added after send, or failed leg).
            if (pendingCount > 0) {
              return (
                <button
                  type="button"
                  onClick={() => onSend?.(absencesByLwsId, date, batchName)}
                  disabled={disabled}
                  className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`Notify ${pendingCount} pending`}
                >
                  Notify {pendingCount} pending
                </button>
              )
            }
            // Everyone with a logged absence has been notified.
            return (
              <button
                type="button"
                onClick={() => onSend?.(absencesByLwsId, date, batchName)}
                disabled={disabled}
                className="btn text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="All notified · Resend all"
              >
                ✓ All {absentIds.length} notified · Resend all
              </button>
            )
          })()}
        </div>
      </div>

      {/* Period cards */}
      {!batchName ? (
        <div className="text-[13px] text-ink-3 italic py-10 text-center">Select a batch to view today's lectures.</div>
      ) : (
        <>
          {/* Add impromptu lecture — available even when nothing is timetabled (e.g. Sunday) */}
          <div className="mb-4">
            {adhocForm === null ? (
              <button
                type="button"
                onClick={() => setAdhocForm({ subject: '', start: '', end: '' })}
                className="btn text-[12px] min-h-[40px] px-3"
                aria-label="Add impromptu lecture"
              >
                + Add impromptu lecture
              </button>
            ) : (
              <div className="card px-4 py-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Subject</span>
                  <input
                    type="text"
                    value={adhocForm.subject}
                    onChange={e => setAdhocForm(f => ({ ...f, subject: e.target.value }))}
                    aria-label="Impromptu lecture subject"
                    placeholder="e.g. Extra Maths Doubt"
                    className="form-input text-[13px] min-h-[40px] px-3"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Start (optional)</span>
                  <input
                    type="text" value={adhocForm.start}
                    onChange={e => setAdhocForm(f => ({ ...f, start: e.target.value }))}
                    aria-label="Impromptu start time" placeholder="3:00 PM"
                    className="form-input text-[13px] min-h-[40px] px-3 w-28"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">End (optional)</span>
                  <input
                    type="text" value={adhocForm.end}
                    onChange={e => setAdhocForm(f => ({ ...f, end: e.target.value }))}
                    aria-label="Impromptu end time" placeholder="4:00 PM"
                    className="form-input text-[13px] min-h-[40px] px-3 w-28"
                  />
                </label>
                <button
                  type="button" onClick={addAdhocLecture}
                  disabled={!adhocForm.subject.trim()}
                  className="btn btn-primary text-[12px] min-h-[40px] px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Add lecture"
                >
                  Add lecture
                </button>
                <button
                  type="button" onClick={() => setAdhocForm(null)}
                  className="btn text-[12px] min-h-[40px] px-3"
                  aria-label="Cancel impromptu lecture"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Hint when no timetabled lectures (impromptu still available above) */}
          {!timetable ? (
            <div className="text-[13px] text-ink-3 italic mb-3">No timetable for this batch — add an impromptu lecture above.</div>
          ) : lectures.length === 0 ? (
            <div className="text-[13px] text-ink-3 italic mb-3">No lectures scheduled for this day — add an impromptu lecture above.</div>
          ) : null}

          {(lectures.length > 0 || adhocLectures.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {lectures.map(lec => {
                const count = (absencesBySlot[lec.slotId] || []).length
                return (
                  <div key={lec.slotId} className="card px-4 py-3">
                    <div className="text-[13px] font-semibold text-ink mb-1">{lec.subject}</div>
                    <div className="text-[11px] font-mono text-ink-3 mb-2">{lec.startTime} – {lec.endTime}</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[12px] font-mono ${count > 0 ? 'text-red-400' : 'text-ink-3'}`}>{count} absent</span>
                      <button
                        type="button"
                        onClick={() => setModalSlot({ slotId: lec.slotId, subject: lec.subject })}
                        className="btn text-[12px] min-h-[36px] px-3"
                        aria-label={`Mark absentees for ${lec.subject} ${lec.startTime}`}
                      >
                        Mark absentees
                      </button>
                    </div>
                  </div>
                )
              })}
              {adhocLectures.map(lec => {
                const count = (absencesBySlot[lec.slotId] || []).length
                return (
                  <div key={lec.slotId} className="card px-4 py-3 border-dashed">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-[13px] font-semibold text-ink">{lec.subject}</div>
                      <button
                        type="button"
                        onClick={() => removeAdhocLecture(lec)}
                        className="text-ink-3 hover:text-red-400 text-[16px] leading-none px-1"
                        aria-label={`Remove impromptu lecture ${lec.subject}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className="text-[11px] font-mono text-ink-3 mb-2">
                      {lec.startTime && lec.endTime ? `${lec.startTime} – ${lec.endTime}` : 'Impromptu'}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[12px] font-mono ${count > 0 ? 'text-red-400' : 'text-ink-3'}`}>{count} absent</span>
                      <button
                        type="button"
                        onClick={() => setModalSlot({ slotId: lec.slotId, subject: lec.subject, adhoc: true, startTime: lec.startTime, endTime: lec.endTime })}
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
        </>
      )}

      <MarkAbsenteesModal
        open={modalSlot !== null}
        date={date}
        subject={modalSlot?.subject ?? ''}
        studentsInBatch={studentsInBatch}
        initialAbsentees={modalSlot ? (absencesBySlot[modalSlot.slotId] || []) : []}
        onSave={handleSavePeriod}
        onClose={() => setModalSlot(null)}
      />
    </div>
  )
}
