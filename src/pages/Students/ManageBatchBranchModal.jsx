import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { uniqueStudents } from './batchBranch/helpers'
import { TabBtn } from './batchBranch/TabBtn'
import RenameTab from './batchBranch/RenameTab'
import BulkAssignTab from './batchBranch/BulkAssignTab'
import FindDuplicatesTab from './batchBranch/FindDuplicatesTab'

export default function ManageBatchBranchModal({ onClose }) {
  const [tab, setTab] = useState('rename')

  const exams                = useStore(s => s.exams)
  const studentProfiles      = useStore(s => s.studentProfiles)
  const renameBatch          = useStore(s => s.renameBatch)
  const renameBranch         = useStore(s => s.renameBranch)
  const bulkAssignBatch      = useStore(s => s.bulkAssignBatch)
  const bulkAssignBranch     = useStore(s => s.bulkAssignBranch)
  const mergeStudentProfiles = useStore(s => s.mergeStudentProfiles)

  const students = useMemo(() => uniqueStudents(studentProfiles), [studentProfiles])

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
            <p className="text-[12px] text-ink-3 mt-0.5">Rename existing batches/branches, bulk-assign them to students, or detect &amp; merge duplicate records</p>
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
          <TabBtn label="Rename"          active={tab === 'rename'} onClick={() => setTab('rename')} />
          <TabBtn label="Bulk Assign"     active={tab === 'assign'} onClick={() => setTab('assign')} />
          <TabBtn label="Find Duplicates" active={tab === 'dedup'}  onClick={() => setTab('dedup')} />
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex-1">
          {tab === 'rename' ? (
            <RenameTab
              students={students}
              exams={exams}
              renameBatch={renameBatch}
              renameBranch={renameBranch}
            />
          ) : tab === 'assign' ? (
            <BulkAssignTab
              students={students}
              exams={exams}
              bulkAssignBatch={bulkAssignBatch}
              bulkAssignBranch={bulkAssignBranch}
            />
          ) : (
            <FindDuplicatesTab
              students={students}
              mergeStudentProfiles={mergeStudentProfiles}
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
