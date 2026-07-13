import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { PageHeader, EmptyState } from '../../components/ui'
import { useMode } from '../../context/ModeContext'
import StudentsTable from './StudentsTable'
import StudentView from './StudentView'
import ImportStudentsModal from '../../components/students/ImportStudentsModal'
import ManageBatchBranchModal from './ManageBatchBranchModal'

export default function StudentsPage() {
  const exams                  = useStore(s => s.exams)
  const studentList            = useStore(s => s.studentList)
  const studentProfiles        = useStore(s => s.studentProfiles)
  const activeStudent          = useStore(s => s.activeStudent)
  const setActiveStudent       = useStore(s => s.setActiveStudent)
  const updateBranchBatch      = useStore(s => s.updateStudentBranchBatch)
  const deleteStudent          = useStore(s => s.deleteStudent)
  const setAccountStatus       = useStore(s => s.setAccountStatus)
  const branches               = useStore(s => s.branches)
  const syllabusBatches        = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches  = useStore(s => s.syllabusBatchBranches)

  const mode = useMode()
  const isAdmin = mode === 'admin'

  const [importOpen, setImportOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  // Build the table-friendly student list. Prefer the raw `studentList` (one row per
  // record, no canonical-name collapse), and fall back to `studentProfiles` values
  // for installs that haven't loaded the raw list yet.
  const students = useMemo(() => {
    if (studentList && studentList.length) {
      return studentList
        .map(s => ({
          lwsId:         s.lws_id,
          name:          s.canonical_name || s.name || '',
          branch:        s.branch || '',
          batches:       s.batches || [],
          mobile:        s.mobile || '',
          accountStatus: s.account_status || '',
          nameVariants:  s.name_variants || [],
        }))
        .filter(s => s.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    return Object.entries(studentProfiles)
      .filter(([key, p]) => p.name === key) // canonical entries only
      .map(([, p]) => ({
        lwsId:         p.lwsId || '',
        name:          p.name,
        branch:        p.branch || '',
        batches:       p.batches || [],
        mobile:        p.mobile || '',
        accountStatus: p.accountStatus || '',
        nameVariants:  p.nameVariants || [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [studentList, studentProfiles])

  return (
    <div>
      <PageHeader
        title="Students"
        sub={`${students.length} students · click a name to drill in`}
        actions={isAdmin && (
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

      {students.length === 0 ? (
        <EmptyState
          icon="👤"
          title="No students yet"
          sub="Import students or add an exam to get started"
        />
      ) : activeStudent ? (
        <>
          <div className="mb-4">
            <button
              onClick={() => setActiveStudent(null)}
              className="btn btn-secondary text-[12px] min-h-[36px]"
            >
              ← Back to list
            </button>
          </div>
          <StudentView name={activeStudent} />
        </>
      ) : (
        <StudentsTable
          students={students}
          exams={exams}
          activeStudent={activeStudent}
          onSelect={setActiveStudent}
          onEdit={(lwsId, name, patch) => updateBranchBatch(lwsId, name, patch)}
          onDelete={isAdmin ? (lwsId) => deleteStudent(lwsId) : undefined}
          onSetStatus={isAdmin ? (lwsId, status) => setAccountStatus(lwsId, status) : undefined}
          isAdmin={isAdmin}
          centralBranches={branches}
          centralBatches={syllabusBatches}
          batchBranchMap={syllabusBatchBranches}
        />
      )}

      {importOpen && <ImportStudentsModal onClose={() => setImportOpen(false)} />}
      {manageOpen && <ManageBatchBranchModal onClose={() => setManageOpen(false)} />}
    </div>
  )
}
