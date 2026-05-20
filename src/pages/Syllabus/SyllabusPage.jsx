import { useState, useEffect } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { PageHeader, EmptyState } from '../../components/ui'
import SubjectAccordion from './SubjectAccordion'
import ManageProgramModal from './ManageProgramModal'
import ManageSubjectModal from './ManageSubjectModal'
import AssignProgramsModal from './AssignProgramsModal'

// Batch CRUD lives in Settings → Batches (since 2026-05-20). This page
// renders syllabus progress for a selected batch — view-only on the batch
// list itself, edit on the per-batch program assignments and chapter status.
export default function SyllabusPage() {
  const mode      = useMode()
  const isAdmin = mode === 'admin'

  const syllabusPrograms        = useStore(s => s.syllabusPrograms)
  const batchProgramAssignments = useStore(s => s.batchProgramAssignments)
  const syllabusBatches         = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches   = useStore(s => s.syllabusBatchBranches)
  const branches                = useStore(s => s.branches)

  const [selectedBranch, setSelectedBranch]         = useState(null) // null = All
  const [selectedBatch, setSelectedBatch]           = useState(() => syllabusBatches[0] ?? '')
  const [selectedProgramId, setSelectedProgramId]   = useState(null)
  const [manageProgramId, setManageProgramId]       = useState(null)
  const [manageSubject, setManageSubject]           = useState(null)
  const [assignOpen, setAssignOpen]                 = useState(false)

  // Batches visible under the current branch filter
  const visibleBatches = selectedBranch
    ? syllabusBatches.filter(b => syllabusBatchBranches[b] === selectedBranch)
    : syllabusBatches

  // Auto-select first visible batch when filter changes and current selection disappears
  useEffect(() => {
    if (!visibleBatches.includes(selectedBatch)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedBatch(visibleBatches[0] ?? '')
    }
  }, [visibleBatches.join(','), selectedBatch])

  // Programs assigned to the selected batch
  const assignedIds      = batchProgramAssignments[selectedBatch] ?? []
  const assignedPrograms = syllabusPrograms.filter(p => assignedIds.includes(p.id))

  const activeProgramId = assignedPrograms.find(p => p.id === selectedProgramId)
    ? selectedProgramId
    : assignedPrograms[0]?.id ?? null

  const activeProgram = syllabusPrograms.find(p => p.id === activeProgramId) ?? null

  return (
    <div>
      <PageHeader
        title="Syllabus Tracker"
        sub={selectedBatch ? `Tracking progress for batch: ${selectedBatch}` : 'Select a batch to begin'}
        actions={isAdmin && (
          <button
            className="btn btn-primary text-[13px] px-3 py-1.5"
            onClick={() => setAssignOpen(true)}
          >
            + Manage Programs
          </button>
        )}
      />

      {/* Branch filter — shown only when timetables have branches */}
      {branches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mr-1">Branch</span>
          <button
            onClick={() => setSelectedBranch(null)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
              selectedBranch === null
                ? 'bg-accent text-white border-accent'
                : 'bg-surface border-border text-ink-2 hover:border-accent/50'
            }`}
          >
            All
          </button>
          {branches.map(b => (
            <button
              key={b}
              onClick={() => setSelectedBranch(b)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                selectedBranch === b
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface border-border text-ink-2 hover:border-accent/50'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      )}

      {/* Batch selector — view only. CRUD lives in Settings → Batches. */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-[12px] text-ink-3 font-semibold uppercase tracking-wide">Batch</label>

        {visibleBatches.length === 0 ? (
          <span className="text-[12px] text-ink-3 italic">
            {selectedBranch ? `No batches for ${selectedBranch}.` : 'No batches yet.'}
            {isAdmin && ' Add one in Settings → Batches.'}
          </span>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            {visibleBatches.map(b => (
              <button
                key={b}
                onClick={() => { setSelectedBatch(b); setSelectedProgramId(null) }}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                  b === selectedBatch
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No batch selected */}
      {!selectedBatch && (
        <EmptyState icon="📚" title="Select a batch" sub="Choose a batch above to view its syllabus progress." />
      )}

      {/* Batch selected but no programs assigned */}
      {selectedBatch && assignedPrograms.length === 0 && (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3 opacity-30">📋</div>
          <div className="text-[15px] font-bold mb-1.5">No programs assigned</div>
          <div className="text-[13px] text-ink-3 mb-5">
            Assign one or more programs to <strong>{selectedBatch}</strong> to start tracking.
          </div>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setAssignOpen(true)}>
              Assign Programs
            </button>
          )}
        </div>
      )}

      {/* Programs assigned — show tabs + subjects */}
      {selectedBatch && assignedPrograms.length > 0 && (
        <>
          {/* Program tabs */}
          <div className="flex flex-wrap items-center gap-1 mb-5 border-b border-border pb-0">
            {assignedPrograms.map(prog => (
              <div key={prog.id} className="relative flex items-center">
                <button
                  onClick={() => setSelectedProgramId(prog.id)}
                  className={`px-4 py-2.5 text-[13px] font-semibold rounded-t-lg border-b-2 transition-colors ${
                    prog.id === activeProgramId
                      ? 'border-accent text-accent'
                      : 'border-transparent text-ink-3 hover:text-ink'
                  }`}
                >
                  {prog.name}
                </button>
                {isAdmin && prog.id === activeProgramId && (
                  <button
                    className="ml-0.5 mb-0.5 p-1 rounded text-ink-3 hover:text-ink hover:bg-surface-2 text-[12px] transition-colors"
                    onClick={() => setManageProgramId(prog.id)}
                    title="Edit program"
                  >⚙</button>
                )}
              </div>
            ))}
          </div>

          {/* Subjects */}
          {activeProgram && (
            <div className="flex flex-col gap-3">
              {activeProgram.subjects.length === 0 ? (
                <div className="card text-center py-10">
                  <div className="text-[13px] text-ink-3">
                    No subjects yet.{isAdmin && ' Click ⚙ on the program tab to add subjects.'}
                  </div>
                </div>
              ) : (
                activeProgram.subjects.map(subj => (
                  <SubjectAccordion
                    key={subj.id}
                    subject={subj}
                    program={activeProgram}
                    batchName={selectedBatch}
                    onEdit={() => setManageSubject({ program: activeProgram, subject: subj })}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {assignOpen && (
        <AssignProgramsModal
          batchName={selectedBatch}
          batches={syllabusBatches}
          onClose={() => setAssignOpen(false)}
        />
      )}

      {manageProgramId && (
        <ManageProgramModal
          programId={manageProgramId}
          onClose={() => setManageProgramId(null)}
        />
      )}

      {manageSubject && (
        <ManageSubjectModal
          program={manageSubject.program}
          subject={manageSubject.subject}
          onClose={() => setManageSubject(null)}
        />
      )}
    </div>
  )
}
