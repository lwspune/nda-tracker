import { useState } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

export default function TeachersTab() {
  const teachers               = useStore(s => s.timetableTeachers)
  const addTimetableTeacher    = useStore(s => s.addTimetableTeacher)
  const updateTimetableTeacher = useStore(s => s.updateTimetableTeacher)
  const deleteTimetableTeacher = useStore(s => s.deleteTimetableTeacher)
  const timetableMappings      = useStore(s => s.timetableMappings)
  const examSchedules          = useStore(s => s.examSchedules)

  const [newName,  setNewName]  = useState('')
  const [newEmail, setNewEmail] = useState('')

  const [editingId,    setEditingId]    = useState(null)
  const [editingName,  setEditingName]  = useState('')
  const [editingEmail, setEditingEmail] = useState('')

  function handleAdd() {
    if (!newName.trim()) return
    addTimetableTeacher(newName, newEmail)
    setNewName('')
    setNewEmail('')
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditingName(t.name)
    setEditingEmail(t.email ?? '')
  }

  function handleSaveEdit(id) {
    updateTimetableTeacher(id, { name: editingName, email: editingEmail })
    setEditingId(null)
  }

  function usageFor(id) {
    const mappingCount = timetableMappings.filter(m => m.teacherId === id).length
    const examCount    = examSchedules.filter(e => e.teacherId === id).length
    return { mappingCount, examCount }
  }

  function handleDelete(t) {
    const usage = usageFor(t.id)
    const refs = []
    if (usage.mappingCount) refs.push(`${usage.mappingCount} timetable mapping${usage.mappingCount > 1 ? 's' : ''}`)
    if (usage.examCount)    refs.push(`${usage.examCount} exam schedule${usage.examCount > 1 ? 's' : ''}`)
    const refSummary = refs.length ? ` ${refs.join(' and ')} will be unlinked (teacher cleared).` : ''
    if (window.confirm(`Delete "${t.name}"?${refSummary}`)) deleteTimetableTeacher(t.id)
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add teacher</div>
        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1 text-[13px]"
            placeholder="Name  e.g. Navneet Sir"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim()}
          >Add</button>
        </div>
        <input
          className="input w-full text-[13px]"
          placeholder="Email address (used for schedule emails)"
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">
          Teachers ({teachers.length})
        </div>
        {teachers.length === 0 ? (
          <p className="text-[13px] text-ink-3 italic">No teachers yet — add one above.</p>
        ) : (
          <div className="divide-y divide-border">
            {teachers.map(t => {
              const usage = usageFor(t.id)
              return (
                <div key={t.id} className="py-2.5 flex items-center gap-3 group">
                  {editingId === t.id ? (
                    <div className="flex-1 space-y-1.5">
                      <input
                        autoFocus
                        className="input w-full text-[13px] py-1"
                        placeholder="Name"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  handleSaveEdit(t.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <input
                        className="input w-full text-[13px] py-1"
                        placeholder="Email address"
                        type="email"
                        value={editingEmail}
                        onChange={e => setEditingEmail(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  handleSaveEdit(t.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <div className="flex gap-2">
                        <button className="text-[11px] px-2 py-1 rounded bg-accent text-white" onClick={() => handleSaveEdit(t.id)}>✓ Save</button>
                        <button className="text-[11px] px-2 py-1 rounded border border-border text-ink-3" onClick={() => setEditingId(null)}>✕ Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium">{t.name}</div>
                        {t.email
                          ? <div className="text-[11px] text-ink-3 truncate">{t.email}</div>
                          : <div className="text-[11px] text-amber-500 italic">No email — won't receive schedule emails</div>}
                        <div className="text-[11px] text-ink-3 mt-0.5">
                          {usage.mappingCount} mapping{usage.mappingCount !== 1 ? 's' : ''} · {usage.examCount} exam schedule{usage.examCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <button
                        className="text-[12px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-surface-2"
                        onClick={() => startEdit(t)}
                      >Edit</button>
                      <button
                        className="text-[12px] text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-red-50"
                        onClick={() => handleDelete(t)}
                      >Delete</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
