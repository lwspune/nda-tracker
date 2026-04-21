import { useState, useMemo } from 'react'
import { findDuplicateCandidates } from '../../../lib/mergeStudents'
import { uniqueSorted } from './helpers'

const REASON_LABELS = {
  name_similar: { label: 'similar name', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  same_mobile:  { label: 'same mobile',  color: 'bg-red-50 text-red-700 border-red-200' },
  same_eis:     { label: 'same EIS',     color: 'bg-red-50 text-red-700 border-red-200' },
}

function StudentCard({ profile }) {
  if (!profile) return null
  return (
    <div className="flex-1 bg-surface-2 border border-border rounded-xl px-4 py-3 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[13px] font-bold text-ink truncate">{profile.name}</span>
        <span className="text-[10px] font-mono text-ink-3 flex-shrink-0">{profile.lwsId}</span>
      </div>
      {profile.branch && (
        <div className="text-[11px] text-ink-3 mb-1.5">
          <span className="font-mono bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full">
            {profile.branch}
          </span>
        </div>
      )}
      {profile.mobile && (
        <div className="text-[11px] text-ink-3 font-mono mb-1">{profile.mobile}</div>
      )}
      {(profile.batches || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {profile.batches.slice(0, 2).map(b => (
            <span key={b} className="text-[10px] font-mono bg-accent-soft text-accent border border-accent/20 px-2 py-0.5 rounded-full truncate max-w-[130px]">
              {b}
            </span>
          ))}
          {profile.batches.length > 2 && (
            <span className="text-[10px] text-ink-3">+{profile.batches.length - 2}</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function FindDuplicatesTab({ students, mergeStudentProfiles }) {
  const [branchFilter, setBranchFilter] = useState('__all__')
  const [candidates,   setCandidates]   = useState(null)   // null = not yet scanned
  const [skipped,      setSkipped]      = useState(new Set())
  const [merging,      setMerging]      = useState(null)   // key of pair being merged

  // Unique branches for the filter dropdown
  const allBranches = useMemo(() => uniqueSorted(students.map(p => p.branch)), [students])

  // Index profiles by lwsId for fast lookup during display
  const byLwsId = useMemo(() => {
    const map = {}
    students.forEach(p => { map[p.lwsId] = p })
    return map
  }, [students])

  // Map camelCase profiles → snake_case input for findDuplicateCandidates
  // eis_reg_no is not stored in in-memory profiles; name + mobile signals still apply
  const snakeStudents = useMemo(() => students.map(p => ({
    lws_id:         p.lwsId,
    canonical_name: p.name,
    branch:         p.branch || '',
    mobile:         p.mobile || '',
    eis_reg_no:     '',
  })), [students])

  function pairKey(c) {
    return [c.studentA.lws_id, c.studentB.lws_id].sort().join('|')
  }

  function handleScan() {
    const opts = branchFilter === '__all__' ? {} : { branchFilter }
    setCandidates(findDuplicateCandidates(snakeStudents, opts))
    setSkipped(new Set())
  }

  function handleSkip(c) {
    setSkipped(prev => new Set([...prev, pairKey(c)]))
  }

  async function handleMerge(primaryId, secondaryId) {
    const key = [primaryId, secondaryId].sort().join('|')
    setMerging(key)
    await mergeStudentProfiles(primaryId, secondaryId)
    // Drop any pair that referenced the now-removed secondary
    setCandidates(prev => prev?.filter(c =>
      c.studentA.lws_id !== secondaryId && c.studentB.lws_id !== secondaryId
    ) ?? null)
    setMerging(null)
  }

  const visible = (candidates ?? []).filter(c => !skipped.has(pairKey(c)))

  return (
    <div>
      {students.length === 0 ? (
        <p className="text-[12px] text-ink-3">No students in the database. Import students first.</p>
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3 mb-5">
            <div className="flex-1 min-w-[180px]">
              <label className="form-label mb-1.5">Scan branch</label>
              <select
                className="form-input text-[13px]"
                value={branchFilter}
                onChange={e => { setBranchFilter(e.target.value); setCandidates(null) }}
              >
                <option value="__all__">All branches</option>
                <option value="">Unassigned</option>
                {allBranches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <button onClick={handleScan} className="btn btn-primary text-[13px]">
              🔍 Scan for Duplicates
            </button>
          </div>

          {/* Results */}
          {candidates === null ? (
            <div className="text-center py-10 text-ink-3">
              <div className="text-[32px] mb-2">🔍</div>
              <p className="text-[13px]">Choose a branch scope and click Scan to find potential duplicate student records.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-10 text-ink-3">
              <div className="text-[32px] mb-2">✅</div>
              <p className="text-[13px] font-semibold text-ink">No duplicates detected</p>
              <p className="text-[12px] mt-1">
                {candidates.length > 0
                  ? `${candidates.length - visible.length} pair${candidates.length - visible.length !== 1 ? 's' : ''} skipped`
                  : 'All student records look unique in this scope.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[12px] text-ink-3">
                {visible.length} potential duplicate pair{visible.length !== 1 ? 's' : ''} found.
                Review each pair and choose which record to keep as primary.
              </p>

              {visible.map(c => {
                const profileA = byLwsId[c.studentA.lws_id]
                const profileB = byLwsId[c.studentB.lws_id]
                const key      = pairKey(c)
                const busy     = merging === key

                return (
                  <div key={key} className="border border-border rounded-xl overflow-hidden">
                    {/* Pair cards */}
                    <div className="flex items-stretch gap-3 p-4">
                      <StudentCard profile={profileA} />

                      <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0 px-1">
                        <span className="text-[18px] text-ink-3">↔</span>
                        {c.score > 0 && (
                          <span className="text-[10px] font-mono text-ink-3">
                            {Math.round(c.score * 100)}%
                          </span>
                        )}
                      </div>

                      <StudentCard profile={profileB} />
                    </div>

                    {/* Reason badges + actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-2 border-t border-border">
                      <div className="flex flex-wrap gap-1.5">
                        {c.reasons.map(r => {
                          const cfg = REASON_LABELS[r] || { label: r, color: 'bg-surface-2 text-ink-2 border-border' }
                          return (
                            <span key={r} className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          )
                        })}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          disabled={busy}
                          onClick={() => handleMerge(c.studentA.lws_id, c.studentB.lws_id)}
                          className="btn btn-sm btn-primary text-[11px] px-3 py-1.5"
                          title={`Keep ${profileA?.name} as primary`}
                        >
                          {busy ? '…' : `Keep ${profileA?.name?.split(' ')[0]} →`}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => handleMerge(c.studentB.lws_id, c.studentA.lws_id)}
                          className="btn btn-sm btn-primary text-[11px] px-3 py-1.5"
                          title={`Keep ${profileB?.name} as primary`}
                        >
                          {busy ? '…' : `← Keep ${profileB?.name?.split(' ')[0]}`}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => handleSkip(c)}
                          className="btn btn-sm btn-secondary text-[11px] px-3 py-1.5"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
