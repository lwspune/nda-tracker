import { useState, useMemo } from 'react'
import { uniqueSorted } from './helpers'

export default function BulkAssignTab({ students, exams, bulkAssignBatch, bulkAssignBranch }) {
  const [search,       setSearch]       = useState('')
  const [selected,     setSelected]     = useState(new Set())
  const [assignBatch,  setAssignBatch]  = useState('')
  const [customBatch,  setCustomBatch]  = useState('')
  const [assignBranch, setAssignBranch] = useState('')
  const [customBranch, setCustomBranch] = useState('')
  const [assigning,    setAssigning]    = useState(false)
  const [doneMsg,      setDoneMsg]      = useState('')

  const allBatches = useMemo(() =>
    uniqueSorted([
      ...students.flatMap(p => p.batches || []),
      ...exams.map(e => e.batch),
    ]), [students, exams])

  const allBranches = useMemo(() =>
    uniqueSorted([
      ...students.map(p => p.branch),
      ...exams.map(e => e.branch),
    ]), [students, exams])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return q ? students.filter(p => p.name.toLowerCase().includes(q)) : students
  }, [students, search])

  const allVisible   = filtered.every(p => selected.has(p.lwsId))
  const someSelected = selected.size > 0

  function toggleStudent(lwsId) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(lwsId) ? next.delete(lwsId) : next.add(lwsId)
      return next
    })
  }

  function toggleAll() {
    if (allVisible) {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(p => next.delete(p.lwsId))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(p => next.add(p.lwsId))
        return next
      })
    }
  }

  const batchTarget  = assignBatch  === '__custom__' ? customBatch.trim()  : assignBatch
  const branchTarget = assignBranch === '__custom__' ? customBranch.trim() : assignBranch
  const canApply     = someSelected && (batchTarget || branchTarget)

  async function handleApply() {
    if (!canApply) return
    const lwsIds = [...selected]
    setAssigning(true)
    if (batchTarget)  await bulkAssignBatch(lwsIds, batchTarget)
    if (branchTarget) await bulkAssignBranch(lwsIds, branchTarget)
    const parts = []
    if (batchTarget)  parts.push(`batch "${batchTarget}"`)
    if (branchTarget) parts.push(`branch "${branchTarget}"`)
    setDoneMsg(`${lwsIds.length} student${lwsIds.length !== 1 ? 's' : ''} updated — ${parts.join(' and ')} assigned.`)
    setSelected(new Set())
    setAssignBatch('')
    setAssignBranch('')
    setCustomBatch('')
    setCustomBranch('')
    setAssigning(false)
  }

  return (
    <div>
      {doneMsg && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-[12.5px] text-green-900 flex items-start gap-2">
          <span>✅</span>
          <span>{doneMsg}</span>
        </div>
      )}

      {students.length === 0 ? (
        <p className="text-[12px] text-ink-3">No students in the database. Import students first.</p>
      ) : (
        <>
          {/* Assignment controls */}
          <div className="grid grid-cols-2 gap-4 mb-5 p-4 bg-surface-2 rounded-xl border border-border">
            {/* Batch */}
            <div>
              <label className="form-label mb-1.5">Assign Batch</label>
              <select
                className="form-input text-[13px] mb-1.5"
                value={assignBatch}
                onChange={e => { setAssignBatch(e.target.value); setCustomBatch('') }}
              >
                <option value="">— No change —</option>
                {allBatches.map(b => <option key={b} value={b}>{b}</option>)}
                <option value="__custom__">+ New batch…</option>
              </select>
              {assignBatch === '__custom__' && (
                <input
                  autoFocus
                  className="form-input text-[13px]"
                  placeholder="New batch name"
                  value={customBatch}
                  onChange={e => setCustomBatch(e.target.value)}
                />
              )}
            </div>

            {/* Branch */}
            <div>
              <label className="form-label mb-1.5">Assign Branch</label>
              <select
                className="form-input text-[13px] mb-1.5"
                value={assignBranch}
                onChange={e => { setAssignBranch(e.target.value); setCustomBranch('') }}
              >
                <option value="">— No change —</option>
                {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
                <option value="__custom__">+ New branch…</option>
              </select>
              {assignBranch === '__custom__' && (
                <input
                  autoFocus
                  className="form-input text-[13px]"
                  placeholder="New branch name"
                  value={customBranch}
                  onChange={e => setCustomBranch(e.target.value)}
                />
              )}
            </div>

            {/* Apply */}
            <div className="col-span-2 flex items-center justify-between">
              <span className="text-[12px] text-ink-3">
                {selected.size > 0
                  ? `${selected.size} student${selected.size !== 1 ? 's' : ''} selected`
                  : 'Select students below to assign'}
              </span>
              <button
                onClick={handleApply}
                disabled={!canApply || assigning}
                className="btn btn-primary text-[13px]"
              >
                {assigning ? 'Applying…' : 'Apply to Selected'}
              </button>
            </div>
          </div>

          {/* Student search */}
          <div className="relative mb-3">
            <input
              className="form-input pr-9 text-[13px]"
              placeholder="Filter students…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 text-[13px]">🔍</span>
          </div>

          {/* Student list */}
          <div className="border border-border rounded-xl overflow-hidden">
            {/* Select-all header */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-2 border-b border-border">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent cursor-pointer"
                checked={filtered.length > 0 && allVisible}
                onChange={toggleAll}
              />
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink-3">
                {allVisible && filtered.length > 0 ? 'Deselect all' : `Select all${search ? ' matching' : ''}`}
              </span>
              <span className="ml-auto text-[11px] text-ink-3">{filtered.length} student{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Rows */}
            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-[12px] text-ink-3 text-center">No students match "{search}"</div>
              ) : filtered.map(p => (
                <label
                  key={p.lwsId}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors
                    ${selected.has(p.lwsId) ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-accent flex-shrink-0"
                    checked={selected.has(p.lwsId)}
                    onChange={() => toggleStudent(p.lwsId)}
                  />
                  <span className="text-[13px] font-medium text-ink flex-1 truncate">{p.name}</span>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {p.branch && (
                      <span className="text-[10px] font-mono bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full">
                        {p.branch}
                      </span>
                    )}
                    {(p.batches || []).slice(0, 2).map(b => (
                      <span key={b} className="text-[10px] font-mono bg-accent-soft text-accent border border-accent/20 px-2 py-0.5 rounded-full max-w-[120px] truncate">
                        {b}
                      </span>
                    ))}
                    {(p.batches || []).length > 2 && (
                      <span className="text-[10px] text-ink-3">+{p.batches.length - 2}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
