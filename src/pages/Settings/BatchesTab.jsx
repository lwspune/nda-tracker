import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

const REASON_LABELS = {
  name_required:   'Name is required.',
  branch_required: 'Branch is required.',
  unknown_branch:  'Branch is not in the central branch list.',
  duplicate_name:  'A batch with this name already exists.',
  comma_in_name:   'Batch names cannot contain commas (reserved as exam-batch separator).',
}

export default function BatchesTab() {
  const syllabusBatches       = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches = useStore(s => s.syllabusBatchBranches)
  const batchProgramAssignments = useStore(s => s.batchProgramAssignments)
  const timetables            = useStore(s => s.timetables)
  const branches              = useStore(s => s.branches)
  const addBatch              = useStore(s => s.addBatch)
  const renameBatch           = useStore(s => s.renameBatch)
  const deleteBatch           = useStore(s => s.deleteBatch)
  const batchInUseBy          = useStore(s => s.batchInUseBy)
  const setSyllabusBatchBranch = useStore(s => s.setSyllabusBatchBranch)

  const [newName, setNewName] = useState('')
  const [newBranch, setNewBranch] = useState(branches[0] ?? '')
  const [editing, setEditing] = useState(null)
  const [error, setError]     = useState('')

  // Union of names from both stores so drift is visible to the admin.
  const allBatches = useMemo(() => {
    return [...new Set([
      ...syllabusBatches,
      ...timetables.map(t => t.batchName).filter(Boolean),
    ])].sort()
  }, [syllabusBatches, timetables])

  function handleAdd() {
    const result = addBatch(newName, newBranch)
    if (!result.ok) {
      setError(REASON_LABELS[result.reason] ?? 'Could not add batch.')
      return
    }
    setNewName('')
    setError('')
  }

  function handleSave() {
    const draft = editing.draft.trim()
    if (!draft || draft === editing.oldName) { setEditing(null); return }
    if (allBatches.includes(draft)) { setError(`"${draft}" already exists`); return }
    renameBatch(editing.oldName, draft)
    setEditing(null)
    setError('')
  }

  function handleDelete(name) {
    const result = deleteBatch(name)
    if (!result.ok) {
      const parts = []
      if (result.usage.timetableCount)    parts.push(`${result.usage.timetableCount} timetable${result.usage.timetableCount > 1 ? 's' : ''}`)
      if (result.usage.examScheduleCount) parts.push(`${result.usage.examScheduleCount} exam schedule${result.usage.examScheduleCount > 1 ? 's' : ''}`)
      window.alert(`Cannot delete "${name}" — still in use by ${parts.join(' and ')}.\n\nDelete the timetable(s) and exam schedule(s) first.`)
    }
  }

  function handleSetBranch(name, branch) {
    setSyllabusBatchBranch(name, branch || null)
  }

  function rowMeta(name) {
    const inSyllabus   = syllabusBatches.includes(name)
    const ttCount      = timetables.filter(t => t.batchName === name).length
    const branch       = syllabusBatchBranches[name] ?? null
    const programCount = (batchProgramAssignments[name] ?? []).length
    return { inSyllabus, ttCount, branch, programCount }
  }

  const branchesEmpty = branches.length === 0

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add batch</div>
        {branchesEmpty ? (
          <p className="text-[13px] text-amber-600 italic">Add at least one branch first (Branches tab).</p>
        ) : (
          <>
            <div className="flex gap-2 mb-2">
              <input
                className="input flex-1 text-[13px]"
                placeholder="e.g. LWS_NDA_2Y_(26-28)_C"
                value={newName}
                onChange={e => { setNewName(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <select
                className="input text-[13px] min-w-[140px]"
                value={newBranch}
                onChange={e => setNewBranch(e.target.value)}
              >
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <button
                className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
                onClick={handleAdd}
                disabled={!newName.trim() || !newBranch}
              >Add</button>
            </div>
            <p className="text-[11px] text-ink-3">Every batch must have a branch. Creates the syllabus entry; add a timetable later from the Timetable page when classes start.</p>
            {error && <div className="text-[12px] text-red-500 mt-2">{error}</div>}
          </>
        )}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">
          Batches ({allBatches.length})
        </div>
        {allBatches.length === 0 ? (
          <p className="text-[13px] text-ink-3 italic">No batches yet — add one above.</p>
        ) : (
          <div className="divide-y divide-border">
            {allBatches.map(b => {
              const meta = rowMeta(b)
              const usage = batchInUseBy(b)
              const branchMissing = meta.inSyllabus && !meta.branch
              return (
                <div key={b} className="py-2.5 flex items-center gap-3 group">
                  {editing?.oldName === b ? (
                    <>
                      <input
                        autoFocus
                        className="input flex-1 text-[13px] py-1"
                        value={editing.draft}
                        onChange={e => setEditing({ ...editing, draft: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  handleSave()
                          if (e.key === 'Escape') { setEditing(null); setError('') }
                        }}
                      />
                      <button className="text-[11px] px-2 py-1 rounded bg-accent text-white" onClick={handleSave}>✓ Save</button>
                      <button className="text-[11px] px-2 py-1 rounded border border-border text-ink-3" onClick={() => { setEditing(null); setError('') }}>✕ Cancel</button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium flex items-center gap-2 flex-wrap">
                          <span>{b}</span>
                          {branchMissing && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 text-red-700">no branch</span>
                          )}
                          {!meta.inSyllabus && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="Exists only in timetables — no syllabus entry">timetable-only</span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-3">
                          {meta.ttCount > 0 ? `${meta.ttCount} timetable${meta.ttCount !== 1 ? 's' : ''}` : 'no timetable'}
                          {' · '}
                          {usage.examScheduleCount > 0 ? `${usage.examScheduleCount} exam schedule${usage.examScheduleCount !== 1 ? 's' : ''}` : 'no exam schedules'}
                          {' · '}
                          {meta.programCount} program{meta.programCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {meta.inSyllabus && (
                        <select
                          className="input text-[12px] py-1 min-w-[120px]"
                          value={meta.branch ?? ''}
                          onChange={e => handleSetBranch(b, e.target.value)}
                          aria-label={`Branch for ${b}`}
                        >
                          {!meta.branch && <option value="">— pick branch —</option>}
                          {branches.map(br => <option key={br} value={br}>{br}</option>)}
                        </select>
                      )}
                      <button
                        className="text-[12px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-surface-2"
                        onClick={() => setEditing({ oldName: b, draft: b })}
                      >Rename</button>
                      <button
                        className="text-[12px] text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                        onClick={() => handleDelete(b)}
                        disabled={meta.ttCount > 0 || usage.examScheduleCount > 0}
                        title={meta.ttCount + usage.examScheduleCount > 0 ? 'Delete the timetable / exam schedules first' : 'Delete'}
                      >Delete</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">About</div>
        <p className="text-[12px] text-ink-3 leading-relaxed">
          Every batch must belong to a branch. Renaming here updates the syllabus and timetable in one step so they can't drift.
          Deleting requires you to remove the timetable and any exam schedules first.
          The <code className="px-1 py-0.5 rounded bg-surface-2 text-ink-2">batches</code> field on student profiles is a separate list maintained from the Students page.
        </p>
      </Card>
    </div>
  )
}
