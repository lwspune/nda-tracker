import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'
import { getBlockableMembers } from '../../lib/batchMembers'
import { isBlockedStatus } from '../../lib/accountStatus'

const REASON_LABELS = {
  name_required:   'Name is required.',
  branch_required: 'Branch is required.',
  unknown_branch:  'Branch is not in the central branch list.',
  duplicate_name:  'A batch with this name already exists.',
  comma_in_name:   'Batch names cannot contain commas (reserved as exam-batch separator).',
}

export default function BatchesTab() {
  const syllabusBatches       = useStore(s => s.syllabusBatches)
  const archivedBatches       = useStore(s => s.archivedBatches)
  const syllabusBatchBranches = useStore(s => s.syllabusBatchBranches)
  const batchProgramAssignments = useStore(s => s.batchProgramAssignments)
  const timetables            = useStore(s => s.timetables)
  const branches              = useStore(s => s.branches)
  const addBatch              = useStore(s => s.addBatch)
  const renameBatch           = useStore(s => s.renameBatch)
  const deleteBatch           = useStore(s => s.deleteBatch)
  const setBatchArchived      = useStore(s => s.setBatchArchived)
  const bulkSetAccountStatus  = useStore(s => s.bulkSetAccountStatus)
  const studentProfiles       = useStore(s => s.studentProfiles)
  const batchInUseBy          = useStore(s => s.batchInUseBy)
  const setSyllabusBatchBranch = useStore(s => s.setSyllabusBatchBranch)

  const [newName, setNewName] = useState('')
  const [newBranch, setNewBranch] = useState(branches[0] ?? '')
  const [editing, setEditing] = useState(null)
  const [error, setError]     = useState('')
  // { name, members: [{lwsId,name}], block: bool } while the archive confirm is open.
  const [archiving, setArchiving] = useState(null)

  // Union of names from both stores so drift is visible to the admin.
  const allBatches = useMemo(() => {
    return [...new Set([
      ...syllabusBatches,
      ...timetables.map(t => t.batchName).filter(Boolean),
    ])].sort()
  }, [syllabusBatches, timetables])

  // Archiving retires a batch from the pickers that assign NEW work. It deletes
  // nothing: membership, exams and every analytics surface are untouched, and the
  // batch stays filterable on Dashboard / Exams / Item Stats. See BATCH_RETIREMENT.md.
  const archivedSet   = useMemo(() => new Set(archivedBatches ?? []), [archivedBatches])
  const activeList    = allBatches.filter(b => !archivedSet.has(b))
  const archivedList  = allBatches.filter(b =>  archivedSet.has(b))

  function handleAdd() {
    const result = addBatch(newName, newBranch)
    if (!result.ok) {
      setError(REASON_LABELS[result.reason] ?? 'Could not add batch.')
      return
    }
    setNewName('')
    setError('')
  }

  function handleSave() {
    const draft = editing.draft.trim()
    if (!draft || draft === editing.oldName) { setEditing(null); return }
    if (allBatches.includes(draft)) { setError(`"${draft}" already exists`); return }
    renameBatch(editing.oldName, draft)
    setEditing(null)
    setError('')
  }

  function handleDelete(name) {
    const result = deleteBatch(name)
    if (!result.ok) {
      const parts = []
      if (result.usage.timetableCount)    parts.push(`${result.usage.timetableCount} timetable${result.usage.timetableCount > 1 ? 's' : ''}`)
      if (result.usage.examScheduleCount) parts.push(`${result.usage.examScheduleCount} exam schedule${result.usage.examScheduleCount > 1 ? 's' : ''}`)
      if (result.usage.memberCount)       parts.push(`${result.usage.memberCount} student${result.usage.memberCount > 1 ? 's' : ''}`)
      // Point at Archive: a finished batch is retired by archiving, and deleting one
      // students still hold would orphan their batch assignments.
      const next = result.usage.memberCount
        ? 'If this batch has finished, use Archive instead — it retires the batch without deleting anything.'
        : 'Delete the timetable(s) and exam schedule(s) first.'
      window.alert(`Cannot delete "${name}" — still in use by ${parts.join(' and ')}.\n\n${next}`)
    }
  }

  // Archiving asks whether to block the batch's students in the same action —
  // per-student blocking is ~3 interactions each, so at batch scale that step of
  // the retirement procedure never gets done. Nothing to block means nothing to
  // ask, so an empty batch archives straight away. Unarchive never asks and never
  // unblocks: it is rare, and silently restoring access to students blocked for
  // unrelated reasons would be worse than one explicit extra step.
  function handleArchive(name) {
    const members = getBlockableMembers(studentProfiles, name)
    if (members.length === 0) { setBatchArchived(name, true); return }
    setArchiving({ name, members, block: true })
  }

  function confirmArchive() {
    const { name, members, block } = archiving
    setBatchArchived(name, true)
    if (block && members.length) bulkSetAccountStatus(members.map(m => m.lwsId), 'Block')
    setArchiving(null)
  }

  function handleSetBranch(name, branch) {
    setSyllabusBatchBranch(name, branch || null)
  }

  function rowMeta(name) {
    const inSyllabus   = syllabusBatches.includes(name)
    const ttCount      = timetables.filter(t => t.batchName === name).length
    const branch       = syllabusBatchBranches[name] ?? null
    const programCount = (batchProgramAssignments[name] ?? []).length
    // Shown because unarchive deliberately does NOT unblock — the count is how
    // that stays visible instead of relying on the operator's memory.
    let blockedCount = 0
    for (const [key, p] of Object.entries(studentProfiles ?? {})) {
      if (!p || p.name !== key) continue
      if (!(p.batches ?? []).includes(name)) continue
      if (isBlockedStatus(p.accountStatus)) blockedCount++
    }
    return { inSyllabus, ttCount, branch, programCount, blockedCount }
  }

  // What is STILL live on an archived batch. An archived batch with a timetable is
  // still on teachers' screens and their Google Calendar, so "archived" would
  // otherwise read as "done" when it isn't. Doubles as the retirement checklist.
  function residue(name) {
    const meta  = rowMeta(name)
    const usage = batchInUseBy(name)
    const parts = []
    if (meta.ttCount > 0)             parts.push(`still has a timetable${meta.ttCount > 1 ? ` (${meta.ttCount})` : ''} — teachers still see this class`)
    if (usage.examScheduleCount > 0)  parts.push(`${usage.examScheduleCount} exam schedule${usage.examScheduleCount > 1 ? 's' : ''}`)
    return parts
  }

  const branchesEmpty = branches.length === 0

  function renderRow(b, { archived }) {
    const meta  = rowMeta(b)
    const usage = batchInUseBy(b)
    const branchMissing = meta.inSyllabus && !meta.branch
    const warnings = archived ? residue(b) : []
    return (
      <div key={b} className="py-2.5 flex items-center gap-3 group">
        {editing?.oldName === b ? (
          <>
            <input
              autoFocus
              className="input flex-1 text-[13px] py-1"
              value={editing.draft}
              onChange={e => setEditing({ ...editing, draft: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleSave()
                if (e.key === 'Escape') { setEditing(null); setError('') }
              }}
            />
            <button className="text-[11px] px-2 py-1 rounded bg-accent text-white" onClick={handleSave}>✓ Save</button>
            <button className="text-[11px] px-2 py-1 rounded border border-border text-ink-3" onClick={() => { setEditing(null); setError('') }}>✕ Cancel</button>
          </>
        ) : archiving?.name === b ? (
          <div data-testid="archive-confirm" className="flex-1 min-w-0">
            <div className="text-[13px] font-medium mb-1">Archive {b}?</div>
            <p className="text-[11px] text-ink-3 mb-2">
              Retires the batch from uploads, quizzes and timetables. Nothing is deleted — all
              history stays visible.
            </p>
            <label className="flex items-start gap-2 text-[12px] cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={archiving.block}
                onChange={e => setArchiving({ ...archiving, block: e.target.checked })}
                className="accent-current mt-0.5"
              />
              <span>
                Also block portal access for the {archiving.members.length} active
                student{archiving.members.length !== 1 ? 's' : ''} in this batch
                <span className="block text-[11px] text-ink-3">
                  Reversible per student from the Students page. Unarchiving does not undo it.
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <button className="text-[11px] px-3 py-1 rounded bg-accent text-white" onClick={confirmArchive}>Archive</button>
              <button className="text-[11px] px-3 py-1 rounded border border-border text-ink-3" onClick={() => setArchiving(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium flex items-center gap-2 flex-wrap">
                <span className={archived ? 'text-ink-3' : undefined}>{b}</span>
                {branchMissing && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 text-red-700">no branch</span>
                )}
                {!meta.inSyllabus && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="Exists only in timetables — no syllabus entry">timetable-only</span>
                )}
              </div>
              <div className="text-[11px] text-ink-3">
                {meta.ttCount > 0 ? `${meta.ttCount} timetable${meta.ttCount !== 1 ? 's' : ''}` : 'no timetable'}
                {' · '}
                {usage.examScheduleCount > 0 ? `${usage.examScheduleCount} exam schedule${usage.examScheduleCount !== 1 ? 's' : ''}` : 'no exam schedules'}
                {' · '}
                {meta.programCount} program{meta.programCount !== 1 ? 's' : ''}
                {' · '}
                {usage.memberCount} student{usage.memberCount !== 1 ? 's' : ''}
                {meta.blockedCount > 0 && ` (${meta.blockedCount} blocked)`}
              </div>
              {warnings.length > 0 && (
                <div data-testid="batch-residue" className="text-[11px] text-amber-700 mt-0.5">⚠ {warnings.join(' · ')}</div>
              )}
            </div>
            {meta.inSyllabus && (
              <select
                className="input text-[12px] py-1 min-w-[120px]"
                value={meta.branch ?? ''}
                onChange={e => handleSetBranch(b, e.target.value)}
                aria-label={`Branch for ${b}`}
              >
                {!meta.branch && <option value="">— pick branch —</option>}
                {branches.map(br => <option key={br} value={br}>{br}</option>)}
              </select>
            )}
            <button
              className="text-[12px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-surface-2"
              onClick={() => setEditing({ oldName: b, draft: b })}
            >Rename</button>
            <button
              className="text-[12px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-surface-2"
              onClick={() => archived ? setBatchArchived(b, false) : handleArchive(b)}
              aria-label={archived ? `Unarchive ${b}` : `Archive ${b}`}
              title={archived
                ? 'Bring this batch back into the pickers'
                : 'Retire from the pickers that assign new work. Deletes nothing — all history stays visible.'}
            >{archived ? 'Unarchive' : 'Archive'}</button>
            <button
              className="text-[12px] text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={() => handleDelete(b)}
              disabled={meta.ttCount > 0 || usage.examScheduleCount > 0 || usage.memberCount > 0}
              aria-label={`Delete ${b}`}
              title={
                usage.memberCount > 0
                  ? `${usage.memberCount} student${usage.memberCount > 1 ? 's are' : ' is'} still in this batch — archive it instead`
                  : meta.ttCount + usage.examScheduleCount > 0
                    ? 'Delete the timetable / exam schedules first'
                    : 'Delete'
              }
            >Delete</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add batch</div>
        {branchesEmpty ? (
          <p className="text-[13px] text-amber-600 italic">Add at least one branch first (Branches tab).</p>
        ) : (
          <>
            <div className="flex gap-2 mb-2">
              <input
                className="input flex-1 text-[13px]"
                placeholder="e.g. LWS_NDA_2Y_(26-28)_C"
                value={newName}
                onChange={e => { setNewName(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <select
                className="input text-[13px] min-w-[140px]"
                value={newBranch}
                onChange={e => setNewBranch(e.target.value)}
                aria-label="Branch for the new batch"
              >
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <button
                className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
                onClick={handleAdd}
                disabled={!newName.trim() || !newBranch}
              >Add</button>
            </div>
            <p className="text-[11px] text-ink-3">Every batch must have a branch. Creates the syllabus entry; add a timetable later from the Timetable page when classes start.</p>
            {error && <div className="text-[12px] text-red-500 mt-2">{error}</div>}
          </>
        )}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">
          Batches ({activeList.length})
        </div>
        {activeList.length === 0 ? (
          <p className="text-[13px] text-ink-3 italic">
            {archivedList.length ? 'Every batch is archived.' : 'No batches yet — add one above.'}
          </p>
        ) : (
          <div className="divide-y divide-border" data-testid="active-batches">
            {activeList.map(b => renderRow(b, { archived: false }))}
          </div>
        )}
      </Card>

      {archivedList.length > 0 && (
        <Card>
          <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">
            Archived ({archivedList.length})
          </div>
          <p className="text-[11px] text-ink-3 mb-3">
            Retired from the pickers that assign new work. Nothing was deleted — their students,
            exams and history stay visible everywhere else.
          </p>
          <div className="divide-y divide-border" data-testid="archived-batches">
            {archivedList.map(b => renderRow(b, { archived: true }))}
          </div>
        </Card>
      )}

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">About</div>
        <p className="text-[12px] text-ink-3 leading-relaxed">
          Every batch must belong to a branch. Renaming here updates the syllabus and timetable in one step so they can't drift.
          <strong className="text-ink-2"> To retire a finished batch, archive it — don't delete it.</strong> Archiving is reversible
          and hides the batch from new uploads, quizzes and timetables while keeping every record; deleting drops the syllabus
          progress and leaves students still assigned to a batch that no longer exists.
          Deleting requires you to remove the timetable and any exam schedules first.
          The <code className="px-1 py-0.5 rounded bg-surface-2 text-ink-2">batches</code> field on student profiles is a separate list maintained from the Students page.
        </p>
      </Card>
    </div>
  )
}
