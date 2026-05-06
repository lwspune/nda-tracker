import { useState } from 'react'
import useStore from '../../store/useStore'

function ModalShell({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl w-full max-w-lg flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-[15px]">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {children}
        </div>
      </div>
    </div>
  )
}

export default function ManageProgramModal({ programId, onClose }) {
  const program          = useStore(s => s.syllabusPrograms.find(p => p.id === programId))
  const updateProgram    = useStore(s => s.updateProgram)
  const deleteProgram    = useStore(s => s.deleteProgram)
  const addSubject       = useStore(s => s.addSubject)
  const updateSubject    = useStore(s => s.updateSubject)
  const deleteSubject    = useStore(s => s.deleteSubject)
  const addTrackingColumn    = useStore(s => s.addTrackingColumn)
  const renameTrackingColumn = useStore(s => s.renameTrackingColumn)
  const deleteTrackingColumn = useStore(s => s.deleteTrackingColumn)

  const [progName, setProgName]   = useState(program?.name ?? '')
  const [newSubjName, setNewSubjName] = useState('')
  const [newColName, setNewColName]   = useState('')
  const [editingSubjId, setEditingSubjId] = useState(null)
  const [editingSubjName, setEditingSubjName] = useState('')
  const [editingColIdx, setEditingColIdx] = useState(null)
  const [editingColName, setEditingColName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!program) return null

  function saveProgramName() {
    const trimmed = progName.trim()
    if (trimmed && trimmed !== program.name) updateProgram(programId, { name: trimmed })
  }

  function handleAddSubject() {
    const name = newSubjName.trim()
    if (!name) return
    addSubject(programId, name)
    setNewSubjName('')
  }

  function handleAddColumn() {
    const name = newColName.trim()
    if (!name || program.trackingColumns.includes(name)) return
    addTrackingColumn(programId, name)
    setNewColName('')
  }

  function saveSubjectName() {
    const trimmed = editingSubjName.trim()
    if (trimmed && editingSubjId) updateSubject(programId, editingSubjId, { name: trimmed })
    setEditingSubjId(null)
  }

  function saveColumnName() {
    const trimmed = editingColName.trim()
    const oldName = program.trackingColumns[editingColIdx]
    if (trimmed && trimmed !== oldName) renameTrackingColumn(programId, oldName, trimmed)
    setEditingColIdx(null)
  }

  return (
    <ModalShell title="Edit Program" onClose={onClose}>

      {/* Program name */}
      <section>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
          Program Name
        </label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={progName}
            onChange={e => setProgName(e.target.value)}
            onBlur={saveProgramName}
            onKeyDown={e => e.key === 'Enter' && saveProgramName()}
          />
        </div>
      </section>

      {/* Tracking columns */}
      <section>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
          Tracking Columns
        </label>
        <div className="space-y-1.5 mb-2">
          {program.trackingColumns.map((col, idx) => (
            <div key={col} className="flex items-center gap-2">
              {editingColIdx === idx ? (
                <input
                  autoFocus
                  className="input flex-1 text-[12px]"
                  value={editingColName}
                  onChange={e => setEditingColName(e.target.value)}
                  onBlur={saveColumnName}
                  onKeyDown={e => { if (e.key === 'Enter') saveColumnName(); if (e.key === 'Escape') setEditingColIdx(null) }}
                />
              ) : (
                <span
                  className="flex-1 text-[12px] text-ink px-2 py-1 rounded bg-surface-2 cursor-pointer hover:bg-surface-3"
                  onClick={() => { setEditingColIdx(idx); setEditingColName(col) }}
                >
                  {col}
                </span>
              )}
              <button
                className="text-danger text-[12px] hover:opacity-70 px-1"
                onClick={() => {
                  if (program.trackingColumns.length > 1) deleteTrackingColumn(programId, col)
                }}
                disabled={program.trackingColumns.length <= 1}
                title="Delete column"
              >✕</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1 text-[12px]"
            placeholder="New column name"
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
          />
          <button className="btn btn-secondary text-[12px] px-3" onClick={handleAddColumn}>Add</button>
        </div>
      </section>

      {/* Subjects */}
      <section>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
          Subjects
        </label>
        <div className="space-y-1.5 mb-2">
          {program.subjects.length === 0 && (
            <p className="text-[12px] text-ink-3 italic">No subjects yet.</p>
          )}
          {program.subjects.map(subj => (
            <div key={subj.id} className="flex items-center gap-2">
              {editingSubjId === subj.id ? (
                <input
                  autoFocus
                  className="input flex-1 text-[12px]"
                  value={editingSubjName}
                  onChange={e => setEditingSubjName(e.target.value)}
                  onBlur={saveSubjectName}
                  onKeyDown={e => { if (e.key === 'Enter') saveSubjectName(); if (e.key === 'Escape') setEditingSubjId(null) }}
                />
              ) : (
                <span
                  className="flex-1 text-[12px] text-ink px-2 py-1 rounded bg-surface-2 cursor-pointer hover:bg-surface-3"
                  onClick={() => { setEditingSubjId(subj.id); setEditingSubjName(subj.name) }}
                >
                  {subj.name}
                  <span className="ml-2 text-ink-3 text-[10.5px]">{subj.chapters.length} ch</span>
                </span>
              )}
              <button
                className="text-danger text-[12px] hover:opacity-70 px-1"
                onClick={() => deleteSubject(programId, subj.id)}
                title="Delete subject"
              >✕</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1 text-[12px]"
            placeholder="New subject name"
            value={newSubjName}
            onChange={e => setNewSubjName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddSubject()}
          />
          <button className="btn btn-secondary text-[12px] px-3" onClick={handleAddSubject}>Add</button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="border-t border-border pt-4">
        {confirmDelete ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[12px]">
            <p className="text-red-800 mb-3">
              Delete <strong>{program.name}</strong>? This removes all subjects, chapters, and progress for all batches. Cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                className="btn text-[12px] bg-danger text-white hover:bg-red-700 px-3 py-1.5"
                onClick={() => { deleteProgram(programId); onClose() }}
              >Yes, Delete</button>
              <button className="btn btn-secondary text-[12px] px-3 py-1.5" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="text-[12px] text-danger hover:underline"
            onClick={() => setConfirmDelete(true)}
          >
            Delete this program…
          </button>
        )}
      </section>

    </ModalShell>
  )
}
