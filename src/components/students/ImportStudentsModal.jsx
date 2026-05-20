import { Alert, DropZone, Spinner } from '../ui'
import { Steps, SummaryTile } from './import/Steps'
import UnresolvedRow from './import/UnresolvedRow'
import useImportFlow from './import/useImportFlow'

export default function ImportStudentsModal({ onClose }) {
  const {
    step, saving, error, done,
    studentFile, dragging, setDragging, loadingStudents, studentError, mergeResult,
    examFiles, loadingExam, examError, selections,
    studentFileRef, examFileRef,
    allStudentNames, totalRollsAssigned, addedStudents,
    handleStudentFile, handleStudentNext,
    handleExamFile, handleAssign, handleSkip, handleSelect,
    handleConfirm, goBackToStep1,
    setStep,
  } = useImportFlow()

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[600px] max-w-[95vw] max-h-[90vh]
                   overflow-y-auto flex flex-col"
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-tight">👤 Import Students</h2>
            <p className="text-[12px] text-ink-3 mt-0.5">
              Upload EIS student list, then optionally add exam files for roll numbers
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none transition-colors"
          >×</button>
        </div>

        <div className="px-7 py-6 flex-1">
          <Steps current={step} />

          {/* ── Step 1: Student List ─────────────────────────── */}
          {step === 1 && (
            <>
              <p className="text-[13px] text-ink-2 mb-4">
                Export the "Student Search List" from EIS and upload it here.
                New students will be added; existing students' mobile, email,
                batch and status will be updated.
              </p>

              <label className="form-label">
                Student Excel <span className="text-danger">*</span>
              </label>
              <DropZone
                file={studentFile}
                dragging={dragging}
                accept=".xlsx,.xls"
                icon="👤"
                hint="Student Search List export (.xls or .xlsx)"
                inputRef={studentFileRef}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                  e.preventDefault(); setDragging(false)
                  handleStudentFile(e.dataTransfer.files[0] || null)
                }}
                onChange={e => handleStudentFile(e.target.files[0])}
              />

              {loadingStudents && (
                <div className="flex items-center gap-2 mt-4 text-[13px] text-ink-3">
                  <Spinner size="sm" /> Reading student list…
                </div>
              )}

              {mergeResult && !loadingStudents && (
                <div className="mt-4 flex items-center gap-2 text-[13px]">
                  <span className="text-success font-bold">✓</span>
                  <span className="text-ink-2">
                    <strong>{mergeResult.students.length}</strong> students loaded —{' '}
                    {mergeResult.added > 0 && <><span className="text-success">{mergeResult.added} new</span>, </>}
                    {mergeResult.updated > 0 && <><span className="text-accent">{mergeResult.updated} updated</span>, </>}
                    {mergeResult.unchanged} unchanged
                  </span>
                </div>
              )}

              {studentError && (
                <div className="mt-4">
                  <Alert type="error"><span>⚠️</span><span>{studentError}</span></Alert>
                </div>
              )}

              <div className="flex justify-between mt-6">
                <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                <button
                  onClick={handleStudentNext}
                  disabled={!mergeResult || loadingStudents}
                  className="btn btn-primary disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Exam Files ───────────────────────────── */}
          {step === 2 && (
            <>
              <p className="text-[13px] text-ink-2 mb-1">
                Add Evalbee exam result files to extract roll numbers and name variants.
              </p>
              <p className="text-[12px] text-ink-3 mb-4">
                Each file is cross-referenced against the student list. Close matches are
                assigned automatically; others need manual confirmation.
              </p>

              <div className="flex items-center gap-3 mb-5">
                <button
                  onClick={() => examFileRef.current?.click()}
                  disabled={loadingExam}
                  className="btn btn-secondary text-[13px]"
                >
                  {loadingExam ? <><Spinner size="sm" /> Processing…</> : '+ Add Exam File'}
                </button>
                <input
                  ref={examFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => { handleExamFile(e.target.files[0]); e.target.value = '' }}
                />
                {examFiles.length === 0 && (
                  <span className="text-[12px] text-ink-3">No exam files added yet</span>
                )}
              </div>

              {examError && (
                <div className="mb-4">
                  <Alert type="error"><span>⚠️</span><span>{examError}</span></Alert>
                </div>
              )}

              {examFiles.map((ef, fi) => {
                const pendingCount  = ef.pending.filter(p => p.status === 'pending').length
                const assignedCount = ef.matched.length + ef.pending.filter(p => p.status === 'assigned').length
                const skippedCount  = ef.pending.filter(p => p.status === 'skipped').length

                return (
                  <div key={fi} className="border border-border rounded-xl overflow-hidden mb-4">
                    <div className="px-4 py-2.5 bg-surface-2 border-b border-border
                                    flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-ink truncate">{ef.name}</span>
                      <div className="flex items-center gap-3 text-[11px] flex-shrink-0 ml-2">
                        <span className="text-success font-bold">✓ {assignedCount}</span>
                        {pendingCount > 0 && <span className="text-warning font-bold">❓ {pendingCount}</span>}
                        {skippedCount > 0 && <span className="text-ink-3">{skippedCount} skipped</span>}
                      </div>
                    </div>

                    {ef.pending.length > 0 && (
                      <div className="divide-y divide-border">
                        {ef.pending.map(item => (
                          <UnresolvedRow
                            key={item.examName}
                            item={item}
                            fileIdx={fi}
                            allNames={allStudentNames}
                            selections={selections}
                            onSelect={handleSelect}
                            onAssign={handleAssign}
                            onSkip={handleSkip}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex justify-between mt-4">
                <button onClick={goBackToStep1} className="btn btn-secondary">← Back</button>
                <div className="flex gap-3">
                  <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={loadingExam}
                    className="btn btn-primary"
                  >
                    {examFiles.length === 0 ? 'Skip →' : 'Next →'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Step 3: Preview ──────────────────────────────── */}
          {step === 3 && mergeResult && (
            <>
              <p className="text-[13px] text-ink-2 mb-4">
                Review what will be saved before confirming.
              </p>

              <div className="border border-border rounded-xl overflow-hidden mb-4">
                <div className="px-4 py-2.5 bg-surface-2 border-b border-border
                                text-[10px] font-bold uppercase tracking-wide text-ink-3">
                  Student list — {studentFile?.name}
                </div>
                <div className="grid grid-cols-3 divide-x divide-border">
                  <SummaryTile
                    value={mergeResult.added}
                    label="New students"
                    color={mergeResult.added > 0 ? 'text-success' : 'text-ink-3'}
                  />
                  <SummaryTile
                    value={mergeResult.updated}
                    label="Updated"
                    color={mergeResult.updated > 0 ? 'text-accent' : 'text-ink-3'}
                  />
                  <SummaryTile value={mergeResult.unchanged} label="Unchanged" />
                </div>
              </div>

              {examFiles.length > 0 && (
                <div className="border border-border rounded-xl overflow-hidden mb-4">
                  <div className="px-4 py-2.5 bg-surface-2 border-b border-border
                                  text-[10px] font-bold uppercase tracking-wide text-ink-3">
                    Exam files — {examFiles.length} file{examFiles.length !== 1 ? 's' : ''}
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-border">
                    <SummaryTile
                      value={totalRollsAssigned}
                      label="Roll nos assigned"
                      color={totalRollsAssigned > 0 ? 'text-accent' : 'text-ink-3'}
                    />
                    <SummaryTile
                      value={examFiles.reduce((a, ef) => a + ef.pending.filter(p => p.status === 'skipped').length, 0)}
                      label="Skipped / unresolved"
                    />
                  </div>
                </div>
              )}

              {addedStudents.length > 0 && (
                <div className="border border-border rounded-xl overflow-hidden mb-4">
                  <div className="px-4 py-2.5 bg-green-50 border-b border-border
                                  text-[10px] font-bold uppercase tracking-wide text-success">
                    New students being added
                  </div>
                  <div className="divide-y divide-border max-h-40 overflow-y-auto">
                    {addedStudents.map(s => (
                      <div key={s.lws_id} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-[13px] font-medium">{s.canonical_name}</span>
                        <span className="text-[11px] text-ink-3 font-mono">{s.lws_id}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mergeResult.conflicts?.length > 0 && (
                <div className="border border-warning rounded-xl overflow-hidden mb-4">
                  <div className="px-4 py-2.5 bg-amber-50 border-b border-border
                                  text-[10px] font-bold uppercase tracking-wide text-warning">
                    ⚠️ {mergeResult.conflicts.length} possible conflict{mergeResult.conflicts.length !== 1 ? 's' : ''} — review before confirming
                  </div>
                  <div className="divide-y divide-border max-h-60 overflow-y-auto">
                    {mergeResult.conflicts.map((c, i) => (
                      <div key={i} className="px-4 py-3 text-[12px]">
                        <div className="font-semibold text-ink mb-1">
                          {c.reason === 'ambiguous_mobile' && 'Mobile shared by multiple existing students'}
                          {c.reason === 'ambiguous_name_branch' && 'Name + branch shared by multiple existing students'}
                          {c.reason === 'mobile_conflict_on_eis_match' && 'EIS match but mobile differs'}
                        </div>
                        <div className="text-ink-2 mb-1.5">
                          Import row: <span className="font-medium">{c.row.canonical_name || '—'}</span>
                          {c.row.eis_reg_no && <> · EIS <span className="font-mono">{c.row.eis_reg_no}</span></>}
                          {c.row.mobile && <> · Mobile <span className="font-mono">{c.row.mobile}</span></>}
                        </div>
                        <div className="text-ink-3 text-[11px] space-y-0.5">
                          {c.candidates.map((cand, j) => (
                            <div key={j}>
                              ↔ <span className="font-mono">{cand.lws_id}</span>{' '}
                              <span className="font-medium text-ink-2">{cand.canonical_name}</span>
                              {cand.branch && <> · {cand.branch}</>}
                              {cand.mobile && <> · {cand.mobile}</>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mergeResult.added === 0 && mergeResult.updated === 0 && totalRollsAssigned === 0 && (
                <Alert type="info">
                  <span>ℹ️</span>
                  <span>No changes detected — all records are already up to date.</span>
                </Alert>
              )}

              {error && (
                <div className="mt-4">
                  <Alert type="error"><span>⚠️</span><span>{error}</span></Alert>
                </div>
              )}

              <div className="flex justify-between gap-3 mt-6">
                <button onClick={() => setStep(2)} className="btn btn-secondary">← Back</button>
                <div className="flex gap-3">
                  <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                  <button
                    onClick={handleConfirm}
                    disabled={saving}
                    className="btn btn-primary"
                  >
                    {saving ? <><Spinner size="sm" /> Saving…</> : '✅ Confirm Import'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Step 4: Done ─────────────────────────────────── */}
          {step === 4 && done && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">✅</div>
              <h3 className="text-[17px] font-extrabold mb-2">Import complete</h3>
              <p className="text-[13px] text-ink-2 mb-6">
                {done.added > 0 && (
                  <><strong className="text-success">{done.added}</strong>{' '}
                    new student{done.added !== 1 ? 's' : ''} added.{' '}</>
                )}
                {done.updated > 0 && (
                  <><strong className="text-accent">{done.updated}</strong>{' '}
                    student{done.updated !== 1 ? 's' : ''} updated.{' '}</>
                )}
                {done.rollsAssigned > 0 && (
                  <><strong className="text-accent">{done.rollsAssigned}</strong>{' '}
                    roll number{done.rollsAssigned !== 1 ? 's' : ''} assigned.{' '}</>
                )}
                {done.added === 0 && done.updated === 0 && done.rollsAssigned === 0 && (
                  <>No changes — all records were already up to date.</>
                )}
              </p>
              <p className="text-[12px] text-ink-3 mb-6">
                <code className="bg-surface-2 px-1.5 py-0.5 rounded">students_db.json</code> updated.
                Run <code className="bg-surface-2 px-1.5 py-0.5 rounded">npm run deploy</code> to
                publish login hashes to GitHub Pages.
              </p>
              <button onClick={onClose} className="btn btn-primary">Close</button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(16px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0)    scale(1);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
