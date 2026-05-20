import { useState } from 'react'

// Inline editor for a single student's branch + batches.
// Mounted only in faculty mode; the StudentsTable hides the Edit button for teachers.
// Keeps its own draft state until Save (calls onSave) or Cancel (discards).
export default function StudentRowEditor({
  branch:             initialBranch  = '',
  batches:            initialBatches = [],
  availableBranches   = [],
  availableBatches    = [],
  onSave,
  onCancel,
}) {
  const [branch, setBranch]     = useState(initialBranch)
  const [batches, setBatches]   = useState(initialBatches)
  const [pendingBatch, setPendingBatch] = useState('')

  const branchOptions = Array.from(new Set([initialBranch, ...availableBranches].filter(Boolean)))
  const batchOptions  = availableBatches.filter(b => !batches.includes(b))

  function removeBatch(name) {
    setBatches(batches.filter(b => b !== name))
  }

  function addBatch() {
    const name = pendingBatch.trim()
    if (!name) return
    if (batches.includes(name)) return
    setBatches([...batches, name])
    setPendingBatch('')
  }

  function save() {
    onSave({ branch, batches })
  }

  return (
    <div className="bg-surface-2 border-t border-border px-4 py-3 grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-3 items-start">
      {/* Branch */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1">
          Branch
        </label>
        <select
          aria-label="Branch"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          className="form-input text-[12px]"
        >
          <option value="">—</option>
          {branchOptions.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {/* Batches */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1">
          Batches
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {batches.length === 0 && (
            <span className="text-[11px] text-ink-3 italic">No batches assigned</span>
          )}
          {batches.map(b => (
            <span
              key={b}
              className="inline-flex items-center gap-1 bg-accent-soft text-accent
                         text-[11px] font-medium px-2 py-1 rounded-full border border-accent/20"
            >
              {b}
              <button
                type="button"
                aria-label={`Remove ${b}`}
                onClick={() => removeBatch(b)}
                className="text-accent/70 hover:text-danger leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Add batch"
            value={pendingBatch}
            onChange={e => setPendingBatch(e.target.value)}
            className="form-input text-[12px] flex-1"
          >
            <option value="">Select a batch to add…</option>
            {batchOptions.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={addBatch}
            disabled={!pendingBatch}
            className="btn btn-secondary text-[12px] min-h-[36px] px-3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex md:flex-col gap-2 md:items-stretch justify-end">
        <button
          type="button"
          onClick={save}
          className="btn btn-primary text-[12px] min-h-[36px] px-4"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => onCancel()}
          className="btn btn-secondary text-[12px] min-h-[36px] px-4"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
