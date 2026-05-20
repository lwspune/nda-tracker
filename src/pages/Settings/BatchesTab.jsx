import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

export default function BatchesTab() {
  const syllabusBatches       = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches = useStore(s => s.syllabusBatchBranches)
  const batchProgramAssignments = useStore(s => s.batchProgramAssignments)
  const timetables            = useStore(s => s.timetables)
  const branches              = useStore(s => s.branches)
  const addSyllabusBatch      = useStore(s => s.addSyllabusBatch)
  const renameBatch           = useStore(s => s.renameBatch)
  const deleteBatch           = useStore(s => s.deleteBatch)
  const batchInUseBy          = useStore(s => s.batchInUseBy)
  const setSyllabusBatchBranch = useStore(s => s.setSyllabusBatchBranch)

  const [newName, setNewName] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError]     = useState('')

  // Union of names from both stores — usually they match (post-unification),
  // but we union so drift is visible to the admin.
  const allBatches = useMemo(() => {
    return [...new Set([
      ...syllabusBatches,
      ...timetables.map(t => t.batchName).filter(Boolean),
    ])].sort()
  }, [syllabusBatches, timetables])

  function handleAdd() {
    const name = newName.trim()
    if (!name) return
    if (allBatches.includes(name)) { setError(`"${name}" already exists`); return }
    addSyllabusBatch(name)
    if (newBranch) setSyllabusBatchBranch(name, newBranch)
    setNewName('')
    setNewBranch('')
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
      window.alert(`Cannot delete "${name}" — still in use by ${parts.join(', ')}.\n\nDelete the timetable(s) and exam schedule(s) first.`)
    }
  }

  function rowMeta(name) {
    const inSyllabus = syllabusBatches.includes(name)
    const ttCount    = timetables.filter(t => t.batchName === name).length
    const branch     = syllabusBatchBranches[name] ?? null
    const programCount = (batchProgramAssignments[name] ?? []).length
    return { inSyllabus, ttCount, branch, programCount }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add batch</div>
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
            <option value="">No branch</option>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim()}
          >Add</button>
        </div>
        <p className="text-[11px] text-ink-3">Creates a syllabus entry. Add a timetable separately from the Timetable page when classes start.</p>
        {error && <div className="text-[12px] text-red-500 mt-2">{error}</div>}
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
              const isDriftEditing = !meta.inSyllabus  // exists only in timetables
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
                        <div className="text-[14px] font-medium flex items-center gap-2">
                          {b}
                          {meta.branch && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-2 text-ink-3">{meta.branch}</span>
                          )}
                          {isDriftEditing && (
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
          A batch name lives in two places — the syllabus tracker and the timetable. Renaming here updates both at once, so they can't drift.
          Deleting requires you to remove the timetable and any exam schedules first.
          The <code className="px-1 py-0.5 rounded bg-surface-2 text-ink-2">batches</code> field on student profiles is a separate list maintained from the Students page.
        </p>
      </Card>
    </div>
  )
}
