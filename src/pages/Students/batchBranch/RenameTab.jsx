import { useState, useMemo } from 'react'
import { uniqueSorted } from './helpers'
import { RenameRow } from './TabBtn'

export default function RenameTab({ students, exams, renameBatch, renameBranch }) {
  const [saving, setSaving] = useState(false)

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

  async function handleRenameBatch(oldName, newName) {
    setSaving(true)
    await renameBatch(oldName, newName)
    setSaving(false)
  }

  async function handleRenameBranch(oldName, newName) {
    setSaving(true)
    await renameBranch(oldName, newName)
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      {/* Batches */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-3">Batches</div>
        {allBatches.length === 0 ? (
          <p className="text-[12px] text-ink-3">No batches assigned yet. Set a batch when uploading an exam or via Bulk Assign.</p>
        ) : (
          <div>
            {allBatches.map(b => {
              const batchStudents = students.filter(p => (p.batches || []).includes(b))
              const examCount     = exams.filter(e => e.batch === b).length
              return (
                <RenameRow
                  key={b}
                  name={b}
                  studentCount={batchStudents.length}
                  examCount={examCount}
                  saving={saving}
                  onSave={handleRenameBatch}
                  studentNames={batchStudents.map(p => p.name)}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Branches */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mb-3">Branches</div>
        {allBranches.length === 0 ? (
          <p className="text-[12px] text-ink-3">No branches assigned yet. Import students with a Branch column or use Bulk Assign.</p>
        ) : (
          <div>
            {allBranches.map(b => {
              const studentCount = students.filter(p => p.branch === b).length
              const examCount    = exams.filter(e => e.branch === b).length
              return (
                <RenameRow
                  key={b}
                  name={b}
                  studentCount={studentCount}
                  examCount={examCount}
                  saving={saving}
                  onSave={handleRenameBranch}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
