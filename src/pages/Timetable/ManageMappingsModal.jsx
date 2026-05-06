import { useState } from 'react'
import useStore from '../../store/useStore'
import ModalShell from './ModalShell'

export default function ManageMappingsModal({ onClose }) {
  const teachers               = useStore(s => s.timetableTeachers)
  const mappings               = useStore(s => s.timetableMappings)
  const addTimetableMapping    = useStore(s => s.addTimetableMapping)
  const updateTimetableMapping = useStore(s => s.updateTimetableMapping)
  const deleteTimetableMapping = useStore(s => s.deleteTimetableMapping)

  const [label, setLabel]       = useState('')
  const [subject, setSubject]   = useState('')
  const [teacherId, setTeacherId] = useState('')

  const [editingId, setEditingId]     = useState(null)
  const [editLabel, setEditLabel]     = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [editTeacherId, setEditTeacherId] = useState('')

  function handleAdd() {
    if (!label.trim()) return
    addTimetableMapping(label, subject || null, teacherId || null)
    setLabel('')
    setSubject('')
    setTeacherId('')
  }

  function startEdit(m) {
    setEditingId(m.id)
    setEditLabel(m.label)
    setEditSubject(m.subject ?? '')
    setEditTeacherId(m.teacherId ?? '')
  }

  function handleSaveEdit() {
    updateTimetableMapping(editingId, {
      label: editLabel.trim(),
      subject: editSubject || null,
      teacherId: editTeacherId || null,
    })
    setEditingId(null)
  }

  function teacherName(tid) {
    return teachers.find(t => t.id === tid)?.name ?? '—'
  }

  return (
    <ModalShell title="Manage Subject Mappings" onClose={onClose} wide>
      {/* Add new */}
      <div className="bg-surface-2 rounded-xl p-4 space-y-3">
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide">Add Mapping</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] text-ink-3 mb-1">Label *</label>
            <input
              className="input w-full text-[12px]"
              placeholder="e.g. Maths (Vilas Sir)"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div>
            <label className="block text-[10px] text-ink-3 mb-1">Subject</label>
            <input
              className="input w-full text-[12px]"
              placeholder="e.g. Maths"
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] text-ink-3 mb-1">Teacher</label>
            <select
              className="input w-full text-[12px]"
              value={teacherId}
              onChange={e => setTeacherId(e.target.value)}
            >
              <option value="">— None —</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn btn-primary text-[12px] px-3 py-1.5 disabled:opacity-40"
          onClick={handleAdd}
          disabled={!label.trim()}
        >Add Mapping</button>
      </div>

      {/* List */}
      <div>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">
          Mappings ({mappings.length})
        </div>
        {mappings.length === 0 ? (
          <p className="text-[12px] text-ink-3 italic">No mappings yet.</p>
        ) : (
          <div className="space-y-1.5">
            {mappings.map(m => (
              <div key={m.id} className="group">
                {editingId === m.id ? (
                  <div className="bg-surface-2 rounded-lg p-3 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-1">Label</label>
                        <input
                          autoFocus
                          className="input w-full text-[12px]"
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-1">Subject</label>
                        <input
                          className="input w-full text-[12px]"
                          value={editSubject}
                          onChange={e => setEditSubject(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-1">Teacher</label>
                        <select
                          className="input w-full text-[12px]"
                          value={editTeacherId}
                          onChange={e => setEditTeacherId(e.target.value)}
                        >
                          <option value="">— None —</option>
                          {teachers.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="text-[11px] px-2 py-1 rounded bg-accent text-white disabled:opacity-40"
                        onClick={handleSaveEdit}
                        disabled={!editLabel.trim()}
                      >Save</button>
                      <button
                        className="text-[11px] px-2 py-1 rounded border border-border text-ink-3"
                        onClick={() => setEditingId(null)}
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors">
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-[13px]">{m.label}</span>
                      {m.subject && (
                        <span className="ml-2 text-[11px] text-ink-3">{m.subject}</span>
                      )}
                      {m.teacherId && (
                        <span className="ml-2 text-[11px] text-accent">· {teacherName(m.teacherId)}</span>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-[11px] text-ink-3 hover:text-ink px-1.5 py-0.5 rounded hover:bg-surface-2"
                        onClick={() => startEdit(m)}
                      >Edit</button>
                      <button
                        className="text-[11px] text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50"
                        onClick={() => {
                          if (window.confirm(`Delete mapping "${m.label}"? Cells using it will be cleared.`)) {
                            deleteTimetableMapping(m.id)
                          }
                        }}
                      >Delete</button>
                    </div>
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
