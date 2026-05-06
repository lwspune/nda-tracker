import { useState } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

export default function ManageTeachersModal({ onClose }) {
  const teachers               = useStore(s => s.timetableTeachers)
  const addTimetableTeacher    = useStore(s => s.addTimetableTeacher)
  const updateTimetableTeacher = useStore(s => s.updateTimetableTeacher)
  const deleteTimetableTeacher = useStore(s => s.deleteTimetableTeacher)

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

  function handleSaveEdit(id) {
    updateTimetableTeacher(id, { name: editingName, email: editingEmail })
    setEditingId(null)
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditingName(t.name)
    setEditingEmail(t.email ?? '')
  }

  return (
    <ModalShell title="Manage Teachers" onClose={onClose}>
      {/* Add */}
      <div>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add Teacher</div>
        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1 text-[13px]"
            placeholder="Name  e.g. Navneet Sir"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="btn btn-primary px-3 text-[12px] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim()}
          >Add</button>
        </div>
        <input
          className="input w-full text-[13px]"
          placeholder="Email address (for schedule emails)"
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
      </div>

      {/* List */}
      <div>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">
          Teachers ({teachers.length})
        </div>
        {teachers.length === 0 ? (
          <p className="text-[12px] text-ink-3 italic">No teachers yet.</p>
        ) : (
          <div className="space-y-1.5">
            {teachers.map(t => (
              <div key={t.id} className="group">
                {editingId === t.id ? (
                  <div className="space-y-1.5">
                    <input
                      autoFocus
                      className="input w-full text-[13px] py-1"
                      placeholder="Name"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveEdit(t.id)
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
                        if (e.key === 'Enter') handleSaveEdit(t.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        className="text-[11px] px-2 py-1 rounded bg-accent text-white"
                        onClick={() => handleSaveEdit(t.id)}
                      >✓ Save</button>
                      <button
                        className="text-[11px] px-2 py-1 rounded border border-border text-ink-3"
                        onClick={() => setEditingId(null)}
                      >✕ Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{t.name}</div>
                      {t.email ? (
                        <div className="text-[11px] text-ink-3 truncate">{t.email}</div>
                      ) : (
                        <div className="text-[11px] text-amber-500 italic">No email — won't receive schedule emails</div>
                      )}
                    </div>
                    <button
                      className="text-[11px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded hover:bg-surface-2 shrink-0"
                      onClick={() => startEdit(t)}
                    >Edit</button>
                    <button
                      className="text-[11px] text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded hover:bg-red-50 shrink-0"
                      onClick={() => {
                        if (window.confirm(`Delete "${t.name}"? Their assignments will be unlinked.`)) {
                          deleteTimetableTeacher(t.id)
                        }
                      }}
                    >Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  )
}
