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
        style={{ maxHeight: '88vh' }}
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

export default function ManageSubjectModal({ program, subject, onClose }) {
  const updateSubject   = useStore(s => s.updateSubject)
  const addChapter      = useStore(s => s.addChapter)
  const updateChapter   = useStore(s => s.updateChapter)
  const deleteChapter   = useStore(s => s.deleteChapter)
  const reorderChapters = useStore(s => s.reorderChapters)

  // Read live subject from store (edits update the store in real-time)
  const liveSubject = useStore(s =>
    s.syllabusPrograms.find(p => p.id === program.id)?.subjects.find(s => s.id === subject.id)
  )

  const [subjName, setSubjName]       = useState(subject.name)
  const [newChName, setNewChName]     = useState('')
  const [newChGroup, setNewChGroup]   = useState('')
  const [editingChId, setEditingChId] = useState(null)
  const [editChName, setEditChName]   = useState('')
  const [editChGroup, setEditChGroup] = useState('')

  if (!liveSubject) return null

  const chapters = liveSubject.chapters
  const groups = [...new Set(chapters.map(c => c.group).filter(Boolean))]

  function saveSubjName() {
    const trimmed = subjName.trim()
    if (trimmed && trimmed !== liveSubject.name) updateSubject(program.id, subject.id, { name: trimmed })
  }

  function handleAddChapter() {
    const name = newChName.trim()
    if (!name) return
    addChapter(program.id, subject.id, name, newChGroup.trim() || null)
    setNewChName('')
  }

  function startEditChapter(ch) {
    setEditingChId(ch.id)
    setEditChName(ch.name)
    setEditChGroup(ch.group ?? '')
  }

  function saveChapter() {
    const name = editChName.trim()
    if (name && editingChId) {
      updateChapter(program.id, subject.id, editingChId, {
        name,
        group: editChGroup.trim() || null,
      })
    }
    setEditingChId(null)
  }

  function moveChapter(idx, direction) {
    const ids = chapters.map(c => c.id)
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= ids.length) return
    ;[ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]]
    reorderChapters(program.id, subject.id, ids)
  }

  return (
    <ModalShell title={`Edit Subject: ${liveSubject.name}`} onClose={onClose}>

      {/* Subject name */}
      <section>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
          Subject Name
        </label>
        <input
          className="input w-full"
          value={subjName}
          onChange={e => setSubjName(e.target.value)}
          onBlur={saveSubjName}
          onKeyDown={e => e.key === 'Enter' && saveSubjName()}
        />
      </section>

      {/* Chapters */}
      <section>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
          Chapters
          <span className="ml-2 font-normal text-ink-3 normal-case">{chapters.length} total</span>
        </label>

        <div className="space-y-1 mb-3 max-h-64 overflow-y-auto pr-1">
          {chapters.length === 0 && (
            <p className="text-[12px] text-ink-3 italic py-2">No chapters yet.</p>
          )}
          {chapters.map((ch, idx) => (
            <div key={ch.id}>
              {editingChId === ch.id ? (
                <div className="bg-accent-soft/20 border border-accent/20 rounded-lg p-2.5 space-y-2">
                  <input
                    autoFocus
                    className="input w-full text-[12px]"
                    placeholder="Chapter name"
                    value={editChName}
                    onChange={e => setEditChName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveChapter()}
                  />
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-[12px]"
                      placeholder="Group (optional, e.g. Class 11)"
                      value={editChGroup}
                      onChange={e => setEditChGroup(e.target.value)}
                      list="group-suggestions"
                      onKeyDown={e => e.key === 'Enter' && saveChapter()}
                    />
                    <datalist id="group-suggestions">
                      {groups.map(g => <option key={g} value={g} />)}
                    </datalist>
                    <button className="btn btn-primary text-[12px] px-3" onClick={saveChapter}>Save</button>
                    <button className="btn btn-secondary text-[12px] px-2" onClick={() => setEditingChId(null)}>✕</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 group py-0.5">
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="text-ink-3 hover:text-ink text-[9px] leading-none disabled:opacity-20"
                      onClick={() => moveChapter(idx, -1)}
                      disabled={idx === 0}
                    >▲</button>
                    <button
                      className="text-ink-3 hover:text-ink text-[9px] leading-none disabled:opacity-20"
                      onClick={() => moveChapter(idx, 1)}
                      disabled={idx === chapters.length - 1}
                    >▼</button>
                  </div>
                  <div
                    className="flex-1 text-[12px] px-2 py-1.5 rounded bg-surface-2 cursor-pointer hover:bg-surface-3 min-w-0"
                    onClick={() => startEditChapter(ch)}
                  >
                    <span className="text-ink truncate block">{ch.name}</span>
                    {ch.group && (
                      <span className="text-accent text-[10px] font-medium">{ch.group}</span>
                    )}
                  </div>
                  <button
                    className="text-danger text-[12px] hover:opacity-70 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteChapter(program.id, subject.id, ch.id)}
                    title="Delete chapter"
                  >✕</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add chapter */}
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Add Chapter</p>
          <input
            className="input w-full text-[12px]"
            placeholder="Chapter name"
            value={newChName}
            onChange={e => setNewChName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddChapter()}
          />
          <div className="flex gap-2">
            <input
              className="input flex-1 text-[12px]"
              placeholder="Group (optional)"
              value={newChGroup}
              onChange={e => setNewChGroup(e.target.value)}
              list="group-suggestions-add"
              onKeyDown={e => e.key === 'Enter' && handleAddChapter()}
            />
            <datalist id="group-suggestions-add">
              {groups.map(g => <option key={g} value={g} />)}
            </datalist>
            <button className="btn btn-primary text-[12px] px-3" onClick={handleAddChapter}>Add</button>
          </div>
        </div>
      </section>

    </ModalShell>
  )
}
