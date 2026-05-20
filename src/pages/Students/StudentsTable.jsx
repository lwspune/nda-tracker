import { useMemo, useState } from 'react'
import { Badge } from '../../components/ui'
import StudentRowEditor from './StudentRowEditor'

const PAGE_SIZE = 25

// Build a name → exam-count + last-activity lookup once per render.
function buildActivityIndex(exams, students) {
  // Map every student's canonical name + variants → canonical name
  const nameToCanonical = new Map()
  for (const s of students) {
    nameToCanonical.set(s.name, s.name)
    for (const v of s.nameVariants || []) nameToCanonical.set(v, s.name)
  }

  const counts = new Map()       // canonical → exam count
  const latest = new Map()       // canonical → latest exam date (YYYY-MM-DD)

  for (const exam of exams) {
    for (const er of exam.students || []) {
      const canonical = nameToCanonical.get(er.name)
      if (!canonical) continue
      counts.set(canonical, (counts.get(canonical) || 0) + 1)
      const prev = latest.get(canonical)
      if (!prev || exam.date > prev) latest.set(canonical, exam.date)
    }
  }
  return { counts, latest }
}

export default function StudentsTable({
  students = [],
  exams = [],
  activeStudent = null,
  onSelect,
  onEdit,
  isFaculty = false,
}) {
  const [search, setSearch]         = useState('')
  const [branchFilter, setBranch]   = useState('all')
  const [batchFilter, setBatchF]    = useState('all')
  const [statusFilter, setStatus]   = useState('all')
  const [page, setPage]             = useState(1)
  const [editingId, setEditingId]   = useState(null)

  // Distinct filter options
  const allBranches = useMemo(
    () => [...new Set(students.map(s => s.branch).filter(Boolean))].sort(),
    [students]
  )
  const allBatches = useMemo(
    () => [...new Set(students.flatMap(s => s.batches || []).filter(Boolean))].sort(),
    [students]
  )

  // Activity counts
  const activity = useMemo(() => buildActivityIndex(exams, students), [exams, students])

  // Apply filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter(s => {
      if (branchFilter !== 'all' && s.branch !== branchFilter) return false
      if (batchFilter  !== 'all' && !(s.batches || []).includes(batchFilter)) return false
      if (statusFilter !== 'all' && s.accountStatus !== statusFilter) return false
      if (q) {
        const haystack = [
          s.name,
          s.lwsId,
          ...(s.nameVariants || []),
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [students, search, branchFilter, batchFilter, statusFilter])

  // Reset to page 1 whenever a filter changes — useMemo above changes identity, page state below resets
  // (Use a derived clamp so we don't need a useEffect with `set` inside.)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  if (safePage !== page) {
    // Synchronously reset — React batches this safely on the next render
    setTimeout(() => setPage(safePage), 0)
  }

  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  function resetPage() { setPage(1) }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-6">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="search"
            placeholder="Search name, LWS ID, or variant…"
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage() }}
            className="form-input text-[12px] pr-7 w-full"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-[12px]">🔍</span>
        </div>

        <select
          aria-label="Branch filter"
          value={branchFilter}
          onChange={e => { setBranch(e.target.value); resetPage() }}
          className="form-input text-[12px] w-auto"
        >
          <option value="all">All branches</option>
          {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>

        <select
          aria-label="Batch filter"
          value={batchFilter}
          onChange={e => { setBatchF(e.target.value); resetPage() }}
          className="form-input text-[12px] w-auto max-w-[220px]"
        >
          <option value="all">All batches</option>
          {allBatches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>

        <select
          aria-label="Status filter"
          value={statusFilter}
          onChange={e => { setStatus(e.target.value); resetPage() }}
          className="form-input text-[12px] w-auto"
        >
          <option value="all">All statuses</option>
          <option value="Active">Active</option>
          <option value="Quit">Quit</option>
        </select>

        <span className="text-[11px] font-mono text-ink-3 ml-auto">
          {filtered.length} of {students.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 border-b border-border">
            <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-3">
              <th className="px-4 py-2">Name</th>
              <th className="px-3 py-2 hidden md:table-cell">LWS ID</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Batch(es)</th>
              <th className="px-3 py-2 hidden md:table-cell">Mobile</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 hidden md:table-cell text-right">Exams</th>
              <th className="px-3 py-2 hidden md:table-cell">Last activity</th>
              {isFaculty && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-ink-3 italic">
                  No students match the current filters.
                </td>
              </tr>
            )}
            {pageItems.map(s => {
              const examCount = activity.counts.get(s.name) || 0
              const lastDate  = activity.latest.get(s.name) || null
              const isActive  = activeStudent === s.name
              const isEditing = editingId === s.lwsId

              return (
                <>
                  <tr
                    key={s.lwsId}
                    aria-current={isActive ? 'true' : undefined}
                    className={`border-b border-border last:border-0 transition-colors
                                ${isActive ? 'bg-accent-soft/40' : 'hover:bg-surface-2'}`}
                  >
                    <td className="px-4 py-2 font-medium">
                      <button
                        onClick={() => onSelect && onSelect(s.name)}
                        className="text-left text-accent hover:underline"
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-3 hidden md:table-cell">{s.lwsId}</td>
                    <td className="px-3 py-2 text-ink-2">{s.branch || '—'}</td>
                    <td className="px-3 py-2 text-ink-2">
                      {(s.batches || []).length === 0
                        ? <span className="text-ink-3 italic">—</span>
                        : (
                          <span>
                            {s.batches[0]}
                            {s.batches.length > 1 && (
                              <span className="ml-1 text-[10px] font-mono text-ink-3">+{s.batches.length - 1}</span>
                            )}
                          </span>
                        )
                      }
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-2 hidden md:table-cell">{s.mobile || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge variant={s.accountStatus === 'Active' ? 'green' : 'gray'}>
                        {s.accountStatus || '—'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-2 text-right hidden md:table-cell">{examCount}</td>
                    <td className="px-3 py-2 font-mono text-ink-3 hidden md:table-cell">{lastDate || '—'}</td>
                    {isFaculty && (
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setEditingId(isEditing ? null : s.lwsId)}
                          className="btn btn-secondary text-[11px] min-h-[28px] px-2.5"
                        >
                          {isEditing ? 'Close' : 'Edit'}
                        </button>
                      </td>
                    )}
                  </tr>
                  {isEditing && (
                    <tr key={`${s.lwsId}-editor`}>
                      <td colSpan={9} className="p-0">
                        <StudentRowEditor
                          lwsId={s.lwsId}
                          name={s.name}
                          branch={s.branch || ''}
                          batches={s.batches || []}
                          availableBranches={allBranches}
                          availableBatches={allBatches}
                          onSave={(patch) => {
                            onEdit && onEdit(s.lwsId, s.name, patch)
                            setEditingId(null)
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between text-[12px]">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="btn btn-secondary text-[12px] min-h-[36px] px-3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="font-mono text-ink-3">
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="btn btn-secondary text-[12px] min-h-[36px] px-3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
