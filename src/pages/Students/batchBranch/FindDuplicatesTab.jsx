import { useState, useMemo } from 'react'
import {
  findDuplicateCandidates,
  getUnmatchedExamNames,
  findExamNameCandidates,
} from '../../../lib/mergeStudents'
import { uniqueSorted } from './helpers'

const REASON_LABELS = {
  name_similar:      { label: 'similar name',     color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  name_subset:       { label: 'first+last match', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  name_token_edit:   { label: 'typo distance',    color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  name_token_prefix: { label: 'first-name only',  color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  name_initial_match:{ label: 'initial match',    color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  same_mobile:       { label: 'same mobile',      color: 'bg-red-50 text-red-700 border-red-200' },
  same_eis:          { label: 'same EIS',         color: 'bg-red-50 text-red-700 border-red-200' },
}

function ReasonBadges({ reasons }) {
  return reasons.map(r => {
    const cfg = REASON_LABELS[r] || { label: r, color: 'bg-surface-2 text-ink-2 border-border' }
    return (
      <span key={r} className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${cfg.color}`}>
        {cfg.label}
      </span>
    )
  })
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

function ExamNameCard({ name, examCount }) {
  return (
    <div className="flex-1 bg-surface-2 border border-dashed border-border rounded-xl px-4 py-3 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[13px] font-bold text-ink truncate">{name}</span>
        <span className="text-[10px] font-mono bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded flex-shrink-0">
          exam name
        </span>
      </div>
      <div className="text-[11px] text-ink-3">
        appears in {examCount} exam{examCount !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

export default function FindDuplicatesTab({
  students,
  studentProfiles,
  exams,
  mergeStudentProfiles,
  addNameVariant,
}) {
  const [branchFilter, setBranchFilter] = useState('__all__')
  const [candidates,   setCandidates]   = useState(null)
  const [skipped,      setSkipped]      = useState(new Set())
  const [busy,         setBusy]         = useState(null)

  const allBranches = useMemo(() => uniqueSorted(students.map(p => p.branch)), [students])

  const byLwsId = useMemo(() => {
    const map = {}
    students.forEach(p => { map[p.lwsId] = p })
    return map
  }, [students])

  const snakeStudents = useMemo(() => students.map(p => ({
    lws_id:         p.lwsId,
    canonical_name: p.name,
    branch:         p.branch || '',
    mobile:         p.mobile || '',
    eis_reg_no:     '',
  })), [students])

  // Count how many exams each name appears in (for ExamNameCard display)
  const examCountMap = useMemo(() => {
    const map = {}
    exams.forEach(exam => {
      exam.students.forEach(s => {
        if (s.name) map[s.name] = (map[s.name] || 0) + 1
      })
    })
    return map
  }, [exams])

  function pairKey(c) {
    if (c.type === 'exam_profile') return `exam:${c.examName}|${c.profile.lws_id}`
    return [c.studentA.lws_id, c.studentB.lws_id].sort().join('|')
  }

  function handleScan() {
    // Profile–profile: respects branch filter
    const profileOpts = branchFilter === '__all__' ? {} : { branchFilter }
    const profilePairs = findDuplicateCandidates(snakeStudents, profileOpts)
      .map(c => ({ type: 'profile_profile', ...c }))

    // Exam-name–profile: always runs across all branches (exam names have no branch)
    const unmatched = getUnmatchedExamNames(exams, studentProfiles)
    const examPairs = findExamNameCandidates(unmatched, snakeStudents)
      .map(c => ({ type: 'exam_profile', ...c }))

    setCandidates([...profilePairs, ...examPairs])
    setSkipped(new Set())
  }

  function handleSkip(c) {
    setSkipped(prev => new Set([...prev, pairKey(c)]))
  }

  async function handleMerge(primaryId, secondaryId, key) {
    setBusy(key)
    await mergeStudentProfiles(primaryId, secondaryId)
    setCandidates(prev => prev?.filter(c =>
      c.type !== 'profile_profile' ||
      (c.studentA.lws_id !== secondaryId && c.studentB.lws_id !== secondaryId)
    ) ?? null)
    setBusy(null)
  }

  async function handleLink(examName, profileLwsId, key) {
    setBusy(key)
    await addNameVariant(profileLwsId, examName)
    setCandidates(prev => prev?.filter(c =>
      !(c.type === 'exam_profile' && c.examName === examName && c.profile.lws_id === profileLwsId)
    ) ?? null)
    setBusy(null)
  }

  const visible = (candidates ?? []).filter(c => !skipped.has(pairKey(c)))
  const profilePairCount = visible.filter(c => c.type === 'profile_profile').length
  const examPairCount    = visible.filter(c => c.type === 'exam_profile').length

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
                {candidates.length > visible.length
                  ? `${candidates.length - visible.length} pair${candidates.length - visible.length !== 1 ? 's' : ''} skipped`
                  : 'All student records look unique in this scope.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[12px] text-ink-3">
                {profilePairCount > 0 && (
                  <span>{profilePairCount} duplicate profile pair{profilePairCount !== 1 ? 's' : ''}</span>
                )}
                {profilePairCount > 0 && examPairCount > 0 && <span className="mx-1">·</span>}
                {examPairCount > 0 && (
                  <span>{examPairCount} unlinked exam name{examPairCount !== 1 ? 's' : ''}</span>
                )}
                {' '}found.
              </p>

              {visible.map(c => {
                const key  = pairKey(c)
                const isBusy = busy === key

                if (c.type === 'exam_profile') {
                  const profile = byLwsId[c.profile.lws_id]
                  return (
                    <div key={key} className="border border-border rounded-xl overflow-hidden">
                      <div className="flex items-stretch gap-3 p-4">
                        <ExamNameCard name={c.examName} examCount={examCountMap[c.examName] || 0} />
                        <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0 px-1">
                          <span className="text-[18px] text-ink-3">→</span>
                          {c.score > 0 && (
                            <span className="text-[10px] font-mono text-ink-3">
                              {Math.round(c.score * 100)}%
                            </span>
                          )}
                        </div>
                        <StudentCard profile={profile} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-2 border-t border-border">
                        <div className="flex flex-wrap gap-1.5">
                          <ReasonBadges reasons={c.reasons} />
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            disabled={isBusy}
                            onClick={() => handleLink(c.examName, c.profile.lws_id, key)}
                            className="btn btn-sm btn-primary text-[11px] px-3 py-1.5"
                            title={`Add "${c.examName}" as a name variant of ${profile?.name}`}
                          >
                            {isBusy ? '…' : 'Link as variant'}
                          </button>
                          <button
                            disabled={isBusy}
                            onClick={() => handleSkip(c)}
                            className="btn btn-sm btn-secondary text-[11px] px-3 py-1.5"
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }

                // profile_profile pair
                const profileA = byLwsId[c.studentA.lws_id]
                const profileB = byLwsId[c.studentB.lws_id]
                return (
                  <div key={key} className="border border-border rounded-xl overflow-hidden">
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
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-2 border-t border-border">
                      <div className="flex flex-wrap gap-1.5">
                        <ReasonBadges reasons={c.reasons} />
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          disabled={isBusy}
                          onClick={() => handleMerge(c.studentA.lws_id, c.studentB.lws_id, key)}
                          className="btn btn-sm btn-primary text-[11px] px-3 py-1.5"
                          title={`Keep ${profileA?.name} as primary`}
                        >
                          {isBusy ? '…' : `Keep ${profileA?.name?.split(' ')[0]} →`}
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => handleMerge(c.studentB.lws_id, c.studentA.lws_id, key)}
                          className="btn btn-sm btn-primary text-[11px] px-3 py-1.5"
                          title={`Keep ${profileB?.name} as primary`}
                        >
                          {isBusy ? '…' : `← Keep ${profileB?.name?.split(' ')[0]}`}
                        </button>
                        <button
                          disabled={isBusy}
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
