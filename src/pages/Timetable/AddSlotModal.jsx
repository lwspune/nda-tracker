import { useState } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

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

export default function AddSlotModal({ timetableId, slot, onClose }) {
  const addTimetableSlot    = useStore(s => s.addTimetableSlot)
  const updateTimetableSlot = useStore(s => s.updateTimetableSlot)
  const deleteTimetableSlot = useStore(s => s.deleteTimetableSlot)

  const isEdit = !!slot

  const [startTime, setStartTime] = useState(slot?.startTime ?? '')
  const [endTime, setEndTime]     = useState(slot?.endTime ?? '')

  function getError() {
    if (!startTime.trim() || !endTime.trim()) return null
    const s = parseTimeToMinutes(startTime)
    const e = parseTimeToMinutes(endTime)
    if (s === null) return 'Invalid start time — use e.g. 9:00 AM or 14:30'
    if (e === null) return 'Invalid end time — use e.g. 10:30 AM or 15:00'
    if (s >= e) return 'Start time must be before end time'
    return null
  }

  const error   = getError()
  const canSave = !!startTime.trim() && !!endTime.trim() && !error

  function handleSave() {
    if (!canSave) return
    if (isEdit) {
      updateTimetableSlot(timetableId, slot.id, { startTime: startTime.trim(), endTime: endTime.trim() })
    } else {
      addTimetableSlot(timetableId, startTime.trim(), endTime.trim())
    }
    onClose()
  }

  return (
    <ModalShell title={isEdit ? 'Edit Time Slot' : 'Add Time Slot'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-1.5">Start Time</label>
            <input
              autoFocus
              className={`input w-full text-[13px] ${error?.includes('start') ? 'border-red-400 focus:border-red-400' : ''}`}
              placeholder="e.g. 9:00 AM"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-1.5">End Time</label>
            <input
              className={`input w-full text-[13px] ${error?.includes('end') || error?.includes('before') ? 'border-red-400 focus:border-red-400' : ''}`}
              placeholder="e.g. 10:30 AM"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
        </div>

        {error ? (
          <p className="text-[12px] text-red-400 font-medium -mt-1">{error}</p>
        ) : (
          <p className="text-[10px] text-ink-3 -mt-1">
            Formats: <span className="font-mono">9:00 AM</span>, <span className="font-mono">10:30 PM</span>, <span className="font-mono">14:30</span>
          </p>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-border">
          {isEdit ? (
            <button
              className="text-[12px] text-red-500 hover:text-red-700 font-semibold"
              onClick={() => {
                if (window.confirm('Delete this time slot? All assignments in this row will be lost.')) {
                  deleteTimetableSlot(timetableId, slot.id)
                  onClose()
                }
              }}
            >Delete slot</button>
          ) : <div />}
          <div className="flex gap-2">
            <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary text-[12px] px-3 py-1.5 disabled:opacity-40"
              onClick={handleSave}
              disabled={!canSave}
            >{isEdit ? 'Save' : 'Add'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
