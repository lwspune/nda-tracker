import { useState } from 'react'
import useStore from '../../store/useStore'

export default function AssignProgramsModal({ batchName: initialBatch, batches, onClose }) {
  const syllabusPrograms        = useStore(s => s.syllabusPrograms)
  const batchProgramAssignments = useStore(s => s.batchProgramAssignments)
  const setAssignedPrograms     = useStore(s => s.setAssignedPrograms)
  const addProgram              = useStore(s => s.addProgram)

  const [selectedBatch, setSelectedBatch] = useState(initialBatch || batches[0] || '')

  const activeBatch = selectedBatch

  const assigned = new Set(batchProgramAssignments[activeBatch] ?? [])

  function toggle(programId) {
    if (!activeBatch) return
    const next = new Set(assigned)
    if (next.has(programId)) next.delete(programId)
    else next.add(programId)
    setAssignedPrograms(activeBatch, [...next])
  }

  // New program creation
  const [showNewProg, setShowNewProg] = useState(false)
  const [newProgName, setNewProgName] = useState('')
  const [newProgCols, setNewProgCols] = useState('Lectures, Homework, Quiz, PYQs')

  function handleCreateProgram() {
    const name = newProgName.trim()
    if (!name) return
    const cols = newProgCols.split(',').map(c => c.trim()).filter(Boolean)
    if (cols.length === 0) return
    const id = addProgram(name, cols)
    // Auto-assign to the current batch
    if (activeBatch) {
      const next = new Set(batchProgramAssignments[activeBatch] ?? [])
      next.add(id)
      setAssignedPrograms(activeBatch, [...next])
    }
    setShowNewProg(false)
    setNewProgName('')
    setNewProgCols('Lectures, Homework, Quiz, PYQs')
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-[15px]">Manage Programs</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* Batch selector */}
          <section>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
              Batch
            </label>
            <select
              className="input w-full"
              value={selectedBatch}
              onChange={e => setSelectedBatch(e.target.value)}
            >
              {batches.map(b => <option key={b} value={b}>{b}</option>)}
              {batches.length === 0 && <option value="">No batches — add one from the Syllabus page</option>}
            </select>
          </section>

          {/* Program assignment checkboxes */}
          <section>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
              Programs for {activeBatch || '—'}
            </label>

            {syllabusPrograms.length === 0 ? (
              <p className="text-[12px] text-ink-3 italic">No programs defined yet. Create one below.</p>
            ) : (
              <div className="space-y-2">
                {syllabusPrograms.map(prog => (
                  <label
                    key={prog.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      assigned.has(prog.id)
                        ? 'border-accent/40 bg-accent-soft/30'
                        : 'border-border hover:border-accent/30'
                    } ${!activeBatch ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={assigned.has(prog.id)}
                      onChange={() => toggle(prog.id)}
                      className="mt-0.5"
                      disabled={!activeBatch}
                    />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-ink">{prog.name}</div>
                      <div className="text-[11px] text-ink-3 mt-0.5">
                        {prog.subjects.length} subjects · Columns: {prog.trackingColumns.join(', ')}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* Create new program */}
          <section className="border-t border-border pt-4">
            {!showNewProg ? (
              <button
                className="btn btn-secondary w-full text-[13px]"
                onClick={() => setShowNewProg(true)}
              >
                + Create New Program
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-3">New Program</p>
                <input
                  autoFocus
                  className="input w-full"
                  placeholder="Program name, e.g. CDS Program"
                  value={newProgName}
                  onChange={e => setNewProgName(e.target.value)}
                />
                <div>
                  <label className="block text-[11px] text-ink-3 mb-1">
                    Tracking columns (comma-separated)
                  </label>
                  <input
                    className="input w-full text-[12px]"
                    value={newProgCols}
                    onChange={e => setNewProgCols(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary flex-1 text-[13px]"
                    onClick={handleCreateProgram}
                    disabled={!newProgName.trim()}
                  >
                    Create Program
                  </button>
                  <button
                    className="btn btn-secondary text-[13px] px-3"
                    onClick={() => setShowNewProg(false)}
                  >Cancel</button>
                </div>
              </div>
            )}
          </section>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button className="btn btn-primary px-5" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
