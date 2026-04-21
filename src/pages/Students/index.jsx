import { useState } from 'react'
import useStore from '../../store/useStore'
import { PageHeader, EmptyState } from '../../components/ui'
import { getAllStudents } from '../../lib/analytics'
import { useMode } from '../../context/ModeContext'
import StudentView from './StudentView'
import ImportStudentsModal from '../../components/students/ImportStudentsModal'
import ManageBatchBranchModal from './ManageBatchBranchModal'

export default function StudentsPage() {
  const exams = useStore(s => s.exams)
  const activeStudent = useStore(s => s.activeStudent)
  const setActiveStudent = useStore(s => s.setActiveStudent)
  const mode = useMode()

  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const allStudents = getAllStudents(exams)
  const filtered = query.trim()
    ? allStudents.filter(n => n.toLowerCase().includes(query.toLowerCase()))
    : []

  return (
    <div>
      <PageHeader
        title="Students"
        sub="Search a student to view their performance"
        actions={mode === 'faculty' && (
          <div className="flex gap-2">
            <button
              onClick={() => setManageOpen(true)}
              className="btn btn-secondary text-[13px]"
            >
              🏷️ Manage Batches &amp; Branches
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="btn btn-secondary text-[13px]"
            >
              👤 Import Students
            </button>
          </div>
        )}
      />

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <input
          className="form-input pr-10"
          placeholder="Search student name…"
          value={query}
          onChange={e => { setQuery(e.target.value); setDropdownOpen(true) }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">🔍</span>

        {dropdownOpen && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface border-[1.5px] border-accent
                          rounded-xl shadow-lg z-50 max-h-56 overflow-y-auto">
            {filtered.slice(0, 10).map(name => (
              <button
                key={name}
                onMouseDown={() => {
                  setActiveStudent(name)
                  setQuery(name)
                  setDropdownOpen(false)
                }}
                className="w-full text-left px-4 py-2.5 text-[13px] font-medium
                           hover:bg-accent-soft hover:text-accent border-b border-border
                           last:border-0 transition-colors"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Student view */}
      {activeStudent ? (
        <StudentView name={activeStudent} />
      ) : (
        exams.length === 0
          ? <EmptyState icon="👤" title="No exams yet" sub="Add exams first to see student data" />
          : <EmptyState icon="🔍" title="Search for a student" sub={`${allStudents.length} students across ${exams.length} exams`} />
      )}

      {importOpen && <ImportStudentsModal onClose={() => setImportOpen(false)} />}
      {manageOpen && <ManageBatchBranchModal onClose={() => setManageOpen(false)} />}
    </div>
  )
}
