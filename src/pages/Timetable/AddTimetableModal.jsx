import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

// CRUD for branches and batches lives in Settings. This modal SELECTS from
// those central lists when creating or editing a timetable shell. Free-text
// inputs are gone so a timetable can't introduce a new branch / batch that
// the syllabus side doesn't know about.

export default function AddTimetableModal({ timetable, onClose }) {
  const branches              = useStore(s => s.branches)
  const syllabusBatches       = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches = useStore(s => s.syllabusBatchBranches)
  const timetables            = useStore(s => s.timetables)
  const addTimetable          = useStore(s => s.addTimetable)
  const updateTimetable       = useStore(s => s.updateTimetable)
  const renameTimetableBatch  = useStore(s => s.renameTimetableBatch)
  const deleteTimetable       = useStore(s => s.deleteTimetable)

  const isEdit = !!timetable

  // Defensive: include the current timetable's branch even if it's not in
  // branches[] (drift case from before the unification). Editing remains
  // possible without forcing the user to first add a branch via Settings.
  const branchOptions = useMemo(() => {
    if (timetable?.branch && !branches.includes(timetable.branch)) {
      return [timetable.branch, ...branches]
    }
    return branches
  }, [branches, timetable?.branch])

  const [branch, setBranch]       = useState(timetable?.branch ?? branchOptions[0] ?? '')
  const [batchName, setBatchName] = useState(timetable?.batchName ?? '')

  // Batch options filtered to the selected branch. A timetable's branch and
  // its batch's branch must agree. Defensive: if the current batch is on a
  // different branch (legacy data), include it so editing can finish.
  const batchOptions = useMemo(() => {
    const matching = syllabusBatches.filter(b => syllabusBatchBranches[b] === branch)
    if (timetable?.batchName && !matching.includes(timetable.batchName)) {
      return [timetable.batchName, ...matching]
    }
    return matching
  }, [syllabusBatches, syllabusBatchBranches, branch, timetable?.batchName])

  // If branch changed and current batch no longer matches it, blank out the batch.
  function handleBranchChange(next) {
    setBranch(next)
    if (batchName && syllabusBatchBranches[batchName] !== next && batchName !== timetable?.batchName) {
      setBatchName('')
    }
  }

  const canSave = !!(branch && batchName)
  const duplicateTimetable = !isEdit && timetables.some(t => t.branch === branch && t.batchName === batchName)

  function handleSave() {
    if (!canSave) return
    if (isEdit) {
      if (branch !== timetable.branch) updateTimetable(timetable.id, { branch })
      if (batchName !== timetable.batchName) renameTimetableBatch(timetable.batchName, batchName)
    } else {
      if (duplicateTimetable) return
      addTimetable(branch, batchName)
    }
    onClose()
  }

  function handleDelete() {
    if (!window.confirm(`Delete timetable "${timetable.branch} — ${timetable.batchName}"? This cannot be undone.`)) return
    deleteTimetable(timetable.id)
    onClose()
  }

  const noBranches = branches.length === 0
  const noBatches  = batchOptions.length === 0

  return (
    <ModalShell title={isEdit ? 'Edit Timetable' : 'New Timetable'} onClose={onClose}>
      <div className="space-y-4">
        {/* Branch */}
        <div>
          <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-2">Branch</label>
          {noBranches ? (
            <p className="text-[12px] text-amber-600 italic">No branches yet — add one in <strong>Settings → Branches</strong>.</p>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              {branchOptions.map(b => (
                <button
                  key={b}
                  onClick={() => handleBranchChange(b)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                    branch === b
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                  }`}
                >{b}</button>
              ))}
            </div>
          )}
        </div>

        {/* Batch */}
        <div>
          <label className="block text-[11px] text-ink-3 uppercase tracking-wide mb-2">Batch</label>
          {!branch ? (
            <p className="text-[12px] text-ink-3 italic">Pick a branch first.</p>
          ) : noBatches ? (
            <p className="text-[12px] text-amber-600 italic">No batches on this branch — add one in <strong>Settings → Batches</strong>.</p>
          ) : (
            <select
              className="input w-full text-[13px]"
              value={batchName}
              onChange={e => setBatchName(e.target.value)}
            >
              <option value="">— pick a batch —</option>
              {batchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {!isEdit && duplicateTimetable && (
            <p className="text-[12px] text-red-500 mt-2">A timetable for {branch} — {batchName} already exists.</p>
          )}
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
              disabled={!canSave || duplicateTimetable}
            >{isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
