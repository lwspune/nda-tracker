import { useState } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

const PRESET_BRANCHES = ['APJ', 'LWS Pune']

export default function AddTimetableModal({ timetable, onClose }) {
  const timetables          = useStore(s => s.timetables)
  const addTimetable        = useStore(s => s.addTimetable)
  const updateTimetable     = useStore(s => s.updateTimetable)
  const renameTimetableBatch = useStore(s => s.renameTimetableBatch)
  const deleteTimetable     = useStore(s => s.deleteTimetable)

  // Collect branches already in use
  const existingBranches = [...new Set(timetables.map(t => t.branch))]
  const branchOptions = [...new Set([...PRESET_BRANCHES, ...existingBranches])]

  const isEdit = !!timetable

  const [branch, setBranch]       = useState(timetable?.branch ?? PRESET_BRANCHES[0])
  const [customBranch, setCustomBranch] = useState(
    timetable?.branch && !PRESET_BRANCHES.includes(timetable.branch) ? timetable.branch : ''
  )
  const [batchName, setBatchName] = useState(timetable?.batchName ?? '')
  const [useCustom, setUseCustom] = useState(
    !!(timetable?.branch && !PRESET_BRANCHES.includes(timetable.branch))
  )

  const effectiveBranch = useCustom ? customBranch.trim() : branch

  function handleSave() {
    const trimmedBatch = batchName.trim()
    if (!effectiveBranch || !trimmedBatch) return
    if (isEdit) {
      if (effectiveBranch !== timetable.branch) {
        updateTimetable(timetable.id, { branch: effectiveBranch })
      }
      if (trimmedBatch !== timetable.batchName) {
        renameTimetableBatch(timetable.batchName, trimmedBatch)
      }
    } else {
      addTimetable(effectiveBranch, trimmedBatch)
    }
    onClose()
  }

  function handleDelete() {
    if (!window.confirm(`Delete timetable "${timetable.branch} — ${timetable.batchName}"? This cannot be undone.`)) return
    deleteTimetable(timetable.id)
    onClose()
  }

  return (
    <ModalShell title={isEdit ? 'Edit Timetable' : 'New Timetable'} onClose={onClose}>
      <div className="space-y-4">
        {/* Branch */}
        <div>
          <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-2">Branch</label>
          {!useCustom ? (
            <div className="flex flex-wrap gap-2 items-center">
              {branchOptions.map(b => (
                <button
                  key={b}
                  onClick={() => setBranch(b)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                    branch === b
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                  }`}
                >{b}</button>
              ))}
              <button
                className="text-[11px] text-ink-3 hover:text-ink px-2 py-1 rounded border border-dashed border-border"
                onClick={() => setUseCustom(true)}
              >+ Custom</button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                className="input flex-1 text-[13px]"
                placeholder="Branch name"
                value={customBranch}
                onChange={e => setCustomBranch(e.target.value)}
              />
              <button
                className="text-[11px] text-ink-3 hover:text-ink px-2 py-1 rounded border border-border"
                onClick={() => { setUseCustom(false); setCustomBranch('') }}
              >Use preset</button>
            </div>
          )}
        </div>

        {/* Batch name */}
        <div>
          <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-2">Batch / Class name</label>
          <input
            className="input w-full text-[13px]"
            placeholder="e.g. 9th and 10th Std"
            value={batchName}
            onChange={e => setBatchName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-border">
          {isEdit ? (
            <button
              className="text-[12px] text-red-500 hover:text-red-700 font-semibold"
              onClick={handleDelete}
            >Delete timetable</button>
          ) : <div />}
          <div className="flex gap-2">
            <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary text-[12px] px-3 py-1.5 disabled:opacity-40"
              onClick={handleSave}
              disabled={!effectiveBranch || !batchName.trim()}
            >{isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
