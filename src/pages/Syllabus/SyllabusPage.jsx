import { useState, useRef, useEffect } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { PageHeader, EmptyState } from '../../components/ui'
import SubjectAccordion from './SubjectAccordion'
import ManageProgramModal from './ManageProgramModal'
import ManageSubjectModal from './ManageSubjectModal'
import AssignProgramsModal from './AssignProgramsModal'

export default function SyllabusPage() {
  const mode      = useMode()
  const isFaculty = mode === 'faculty'

  const syllabusPrograms        = useStore(s => s.syllabusPrograms)
  const batchProgramAssignments = useStore(s => s.batchProgramAssignments)
  const syllabusBatches         = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches   = useStore(s => s.syllabusBatchBranches)
  const timetables              = useStore(s => s.timetables)
  const addSyllabusBatch        = useStore(s => s.addSyllabusBatch)
  const renameSyllabusBatch     = useStore(s => s.renameSyllabusBatch)
  const deleteSyllabusBatch     = useStore(s => s.deleteSyllabusBatch)
  const setSyllabusBatchBranch  = useStore(s => s.setSyllabusBatchBranch)

  // Branch names sourced from timetables (same source as TimetablePage / ExamScheduleView)
  const branches = [...new Set(timetables.map(t => t.branch))].sort()

  const [selectedBranch, setSelectedBranch]         = useState(null) // null = All
  const [selectedBatch, setSelectedBatch]           = useState(() => syllabusBatches[0] ?? '')
  const [selectedProgramId, setSelectedProgramId]   = useState(null)
  const [manageProgramId, setManageProgramId]       = useState(null)
  const [manageSubject, setManageSubject]           = useState(null)
  const [assignOpen, setAssignOpen]                 = useState(false)

  // Batch add state
  const [addingBatch, setAddingBatch]       = useState(false)
  const [newBatchName, setNewBatchName]     = useState('')
  const [newBatchBranch, setNewBatchBranch] = useState('')

  // Batch rename state
  const [renamingBatch, setRenamingBatch] = useState(null)
  const [renameValue, setRenameValue]     = useState('')

  // Batch menu + branch picker
  const [batchMenuOpen, setBatchMenuOpen]       = useState(null)
  const [settingBranchFor, setSettingBranchFor] = useState(null)
  const menuRef = useRef(null)

  // Batches visible under the current branch filter
  const visibleBatches = selectedBranch
    ? syllabusBatches.filter(b => syllabusBatchBranches[b] === selectedBranch)
    : syllabusBatches

  // Close batch menu on outside click
  useEffect(() => {
    if (!batchMenuOpen) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setBatchMenuOpen(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [batchMenuOpen])

  // Close branch picker on outside click
  useEffect(() => {
    if (!settingBranchFor) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setSettingBranchFor(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [settingBranchFor])

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

  function handleAddBatch() {
    const name = newBatchName.trim()
    if (!name) return
    addSyllabusBatch(name)
    const branch = selectedBranch || newBatchBranch || null
    if (branch) setSyllabusBatchBranch(name, branch)
    setSelectedBatch(name)
    setNewBatchName('')
    setNewBatchBranch('')
    setAddingBatch(false)
  }

  function handleRenameConfirm(oldName) {
    renameSyllabusBatch(oldName, renameValue)
    if (selectedBatch === oldName) setSelectedBatch(renameValue.trim() || oldName)
    setRenamingBatch(null)
  }

  function handleDelete(name) {
    const hasProgress = !!batchProgramAssignments[name]?.length
    if (hasProgress && !window.confirm(`Delete batch "${name}"? This will remove all program assignments and progress for this batch.`)) return
    deleteSyllabusBatch(name)
    setBatchMenuOpen(null)
  }

  return (
    <div>
      <PageHeader
        title="Syllabus Tracker"
        sub={selectedBatch ? `Tracking progress for batch: ${selectedBatch}` : 'Select a batch to begin'}
        actions={isFaculty && (
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

      {/* Batch selector */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-[12px] text-ink-3 font-semibold uppercase tracking-wide">Batch</label>

        {visibleBatches.length === 0 && !addingBatch ? (
          <span className="text-[12px] text-ink-3 italic">
            {selectedBranch ? `No batches for ${selectedBranch}.` : 'No batches yet.'}
            {isFaculty && ' Add one below.'}
          </span>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            {visibleBatches.map(b => (
              <div
                key={b}
                className="relative flex items-center gap-0.5"
                ref={(batchMenuOpen === b || settingBranchFor === b) ? menuRef : null}
              >
                {renamingBatch === b ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      className="input text-[12px] py-1 px-2 w-36"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  handleRenameConfirm(b)
                        if (e.key === 'Escape') setRenamingBatch(null)
                      }}
                    />
                    <button
                      className="text-[11px] px-1.5 py-0.5 rounded bg-accent text-white"
                      onClick={() => handleRenameConfirm(b)}
                    >✓</button>
                    <button
                      className="text-[11px] px-1.5 py-0.5 rounded border border-border text-ink-3"
                      onClick={() => setRenamingBatch(null)}
                    >✕</button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setSelectedBatch(b); setSelectedProgramId(null) }}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                        b === selectedBatch
                          ? 'bg-accent text-white border-accent'
                          : 'bg-surface border-border text-ink-2 hover:border-accent/50'
                      }`}
                    >
                      {b}
                    </button>
                    {isFaculty && (
                      <button
                        className="p-0.5 rounded text-ink-3 hover:text-ink hover:bg-surface-2 text-[11px] leading-none transition-colors"
                        onClick={() => setBatchMenuOpen(batchMenuOpen === b ? null : b)}
                        title="Batch options"
                      >⋯</button>
                    )}

                    {/* Batch ⋯ menu */}
                    {isFaculty && batchMenuOpen === b && (
                      <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 min-w-[130px]">
                        <button
                          className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-2 transition-colors"
                          onClick={() => { setRenamingBatch(b); setRenameValue(b); setBatchMenuOpen(null) }}
                        >Rename</button>
                        {branches.length > 0 && (
                          <button
                            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-2 transition-colors"
                            onClick={() => { setSettingBranchFor(b); setBatchMenuOpen(null) }}
                          >Set branch</button>
                        )}
                        <button
                          className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-surface-2 transition-colors"
                          onClick={() => handleDelete(b)}
                        >Delete</button>
                      </div>
                    )}

                    {/* Branch picker popover */}
                    {isFaculty && settingBranchFor === b && (
                      <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 min-w-[130px]">
                        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-3 border-b border-border mb-1">Set branch</div>
                        {branches.map(br => (
                          <button
                            key={br}
                            className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-2 transition-colors flex items-center gap-2 ${syllabusBatchBranches[b] === br ? 'text-accent font-semibold' : ''}`}
                            onClick={() => { setSyllabusBatchBranch(b, br); setSettingBranchFor(null) }}
                          >
                            <span className="w-3">{syllabusBatchBranches[b] === br ? '✓' : ''}</span>
                            {br}
                          </button>
                        ))}
                        {syllabusBatchBranches[b] && (
                          <button
                            className="w-full text-left px-3 py-1.5 text-[12px] text-ink-3 hover:bg-surface-2 transition-colors border-t border-border mt-1"
                            onClick={() => { setSyllabusBatchBranch(b, null); setSettingBranchFor(null) }}
                          >Clear branch</button>
                        )}
                        <button
                          className="w-full text-left px-3 py-1.5 text-[12px] text-ink-3 hover:bg-surface-2 transition-colors"
                          onClick={() => setSettingBranchFor(null)}
                        >Cancel</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Add batch */}
            {isFaculty && !addingBatch && (
              <button
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-dashed border-border text-ink-3 hover:border-accent/50 hover:text-ink transition-colors"
                onClick={() => setAddingBatch(true)}
              >+ Add batch</button>
            )}
          </div>
        )}

        {isFaculty && !addingBatch && visibleBatches.length === 0 && (
          <button
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-dashed border-border text-ink-3 hover:border-accent/50 hover:text-ink transition-colors"
            onClick={() => setAddingBatch(true)}
          >+ Add batch</button>
        )}

        {isFaculty && addingBatch && (
          <div className="flex items-center gap-1 flex-wrap">
            <input
              autoFocus
              className="input text-[12px] py-1 px-2 w-44"
              placeholder="e.g. LWS 2Y 26-28"
              value={newBatchName}
              onChange={e => setNewBatchName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleAddBatch()
                if (e.key === 'Escape') { setAddingBatch(false); setNewBatchName(''); setNewBatchBranch('') }
              }}
            />
            {/* Branch selector in add form — only when no branch filter is active */}
            {!selectedBranch && branches.length > 0 && (
              <select
                className="input text-[12px] py-1 px-2"
                value={newBatchBranch}
                onChange={e => setNewBatchBranch(e.target.value)}
              >
                <option value="">No branch</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <button
              className="text-[11px] px-2 py-1 rounded bg-accent text-white disabled:opacity-40"
              onClick={handleAddBatch}
              disabled={!newBatchName.trim()}
            >Add</button>
            <button
              className="text-[11px] px-2 py-1 rounded border border-border text-ink-3"
              onClick={() => { setAddingBatch(false); setNewBatchName(''); setNewBatchBranch('') }}
            >Cancel</button>
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
          {isFaculty && (
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
                {isFaculty && prog.id === activeProgramId && (
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
                    No subjects yet.{isFaculty && ' Click ⚙ on the program tab to add subjects.'}
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
