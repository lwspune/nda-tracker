import { useState } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

export default function BranchesTab() {
  const branches       = useStore(s => s.branches)
  const addBranch      = useStore(s => s.addBranch)
  const renameBranch   = useStore(s => s.renameBranch)
  const deleteBranch   = useStore(s => s.deleteBranch)
  const branchInUseBy  = useStore(s => s.branchInUseBy)

  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState(null)        // { oldName, draft }
  const [error, setError]     = useState('')

  function handleAdd() {
    const name = newName.trim()
    if (!name) return
    if (branches.includes(name)) { setError(`"${name}" already exists`); return }
    addBranch(name)
    setNewName('')
    setError('')
  }

  function handleSave() {
    const draft = editing.draft.trim()
    if (!draft || draft === editing.oldName) { setEditing(null); return }
    if (branches.includes(draft)) { setError(`"${draft}" already exists`); return }
    renameBranch(editing.oldName, draft)
    setEditing(null)
    setError('')
  }

  function handleDelete(name) {
    const result = deleteBranch(name)
    if (!result.ok) {
      const parts = []
      if (result.usage.timetables)        parts.push(`${result.usage.timetables} timetable${result.usage.timetables > 1 ? 's' : ''}`)
      if (result.usage.examSchedules)     parts.push(`${result.usage.examSchedules} exam schedule${result.usage.examSchedules > 1 ? 's' : ''}`)
      if (result.usage.syllabusBatches.length) parts.push(`${result.usage.syllabusBatches.length} syllabus batch${result.usage.syllabusBatches.length > 1 ? 'es' : ''}`)
      window.alert(`Cannot delete "${name}" — still in use by ${parts.join(', ')}.\n\nRemove or reassign those first.`)
      return
    }
    setError('')
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add branch</div>
        <div className="flex gap-2">
          <input
            className="input flex-1 text-[13px]"
            placeholder="e.g. LWS Mumbai"
            value={newName}
            onChange={e => { setNewName(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim()}
          >Add</button>
        </div>
        {error && <div className="text-[12px] text-red-500 mt-2">{error}</div>}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">
          Branches ({branches.length})
        </div>
        {branches.length === 0 ? (
          <p className="text-[13px] text-ink-3 italic">No branches yet — add one above.</p>
        ) : (
          <div className="divide-y divide-border">
            {branches.map(b => {
              const usage = branchInUseBy(b)
              const inUseCount = usage.timetables + usage.examSchedules + usage.syllabusBatches.length
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
                        <div className="text-[14px] font-medium">{b}</div>
                        <div className="text-[11px] text-ink-3">
                          {inUseCount === 0
                            ? 'unused'
                            : `${usage.timetables} timetable${usage.timetables !== 1 ? 's' : ''}, ${usage.examSchedules} exam schedule${usage.examSchedules !== 1 ? 's' : ''}, ${usage.syllabusBatches.length} syllabus batch${usage.syllabusBatches.length !== 1 ? 'es' : ''}`}
                        </div>
                      </div>
                      <button
                        className="text-[12px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-surface-2"
                        onClick={() => setEditing({ oldName: b, draft: b })}
                      >Rename</button>
                      <button
                        className="text-[12px] text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                        onClick={() => handleDelete(b)}
                        disabled={inUseCount > 0}
                        title={inUseCount > 0 ? 'In use — cannot delete' : 'Delete'}
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
          Branches appear in the timetable, exam schedule, and syllabus pages. Renaming a branch updates every reference automatically.
          Student-import branch values (e.g. <code className="px-1 py-0.5 rounded bg-surface-2 text-ink-2">LWS</code>, <code className="px-1 py-0.5 rounded bg-surface-2 text-ink-2">APJSCH</code>) come from the LWS HR roster and are managed via the Students page, not here.
        </p>
      </Card>
    </div>
  )
}
