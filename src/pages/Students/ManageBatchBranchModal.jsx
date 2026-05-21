import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { uniqueStudents } from './batchBranch/helpers'
import { TabBtn } from './batchBranch/TabBtn'
import BulkAssignTab from './batchBranch/BulkAssignTab'
import FindDuplicatesTab from './batchBranch/FindDuplicatesTab'

// Rename functionality moved to Settings → Branches / Settings → Batches
// (2026-05-21). This modal now only handles Bulk Assign + Find Duplicates,
// both of which operate on student records (the legitimate use case that
// can't live in Settings since it requires per-student selection).
export default function ManageBatchBranchModal({ onClose }) {
  const [tab, setTab] = useState('assign')

  const exams                = useStore(s => s.exams)
  const studentProfiles      = useStore(s => s.studentProfiles)
  const studentList          = useStore(s => s.studentList)
  const bulkAssignBatch      = useStore(s => s.bulkAssignBatch)
  const bulkAssignBranch     = useStore(s => s.bulkAssignBranch)
  const mergeStudentProfiles = useStore(s => s.mergeStudentProfiles)
  const addNameVariant       = useStore(s => s.addNameVariant)

  const students = useMemo(() => uniqueStudents(studentProfiles), [studentProfiles])

  // For duplicate scanning: use the raw list so two profiles with the same
  // canonical_name (which studentProfiles collapses to one key) are both visible.
  const allStudents = useMemo(() =>
    studentList
      .map(s => ({
        lwsId:   s.lws_id,
        name:    s.canonical_name || s.name || '',
        branch:  s.branch || '',
        mobile:  s.mobile || '',
        batches: s.batches || [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  , [studentList])

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[680px] max-w-[95vw] max-h-[90vh]
                   overflow-y-auto flex flex-col"
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-[17px] font-extrabold text-ink">Manage Batches &amp; Branches</h2>
            <p className="text-[12px] text-ink-3 mt-0.5">Bulk-assign batches/branches to students or detect &amp; merge duplicate records. Rename batches and branches in <strong>Settings</strong>.</p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-2"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-6 py-4 border-b border-border flex-shrink-0">
          <TabBtn label="Bulk Assign"     active={tab === 'assign'} onClick={() => setTab('assign')} />
          <TabBtn label="Find Duplicates" active={tab === 'dedup'}  onClick={() => setTab('dedup')} />
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex-1">
          {tab === 'assign' ? (
            <BulkAssignTab
              students={students}
              exams={exams}
              bulkAssignBatch={bulkAssignBatch}
              bulkAssignBranch={bulkAssignBranch}
            />
          ) : (
            <FindDuplicatesTab
              students={allStudents}
              studentProfiles={studentProfiles}
              exams={exams}
              mergeStudentProfiles={mergeStudentProfiles}
              addNameVariant={addNameVariant}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  )
}
