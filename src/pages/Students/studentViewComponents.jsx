import { useState } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { Card, CardTitle, Badge } from '../../components/ui'

// ── Helpers ───────────────────────────────────────────────────

/** Format 'YYYY-MM-DD' → 'DD MMM YYYY' (e.g. '15 Jun 2024'). Returns raw string on failure. */
function fmtDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Formats a UTC ISO timestamp as a relative human-readable string. */
function relativeDate(isoString) {
  if (!isoString) return null
  const diff = Date.now() - new Date(isoString).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`
  return new Date(isoString).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Returns badge variant and label for the account status field. */
function accountStatusBadge(status) {
  if (!status) return null
  const s = status.toLowerCase()
  if (s === 'active')   return { variant: 'green',  label: status }
  if (s === 'quit' || s === 'inactive') return { variant: 'red', label: status }
  return { variant: 'yellow', label: status }
}

// ── Profile Card ──────────────────────────────────────────────
export function ProfileCard({ name, profile, loginStats = null }) {
  const mode                       = useMode()
  const studentProfiles            = useStore(s => s.studentProfiles)
  const updateStudentBranchBatch   = useStore(s => s.updateStudentBranchBatch)
  const updateStudentParentMobiles = useStore(s => s.updateStudentParentMobiles)

  const [isEditing, setIsEditing]           = useState(false)
  const [editBranch, setEditBranch]         = useState('')
  const [editBatches, setEditBatches]       = useState([])
  const [batchInput, setBatchInput]         = useState('')
  const [editParentMobiles, setEditParentMobiles] = useState([])
  const [parentInput, setParentInput]       = useState('')
  const [saving, setSaving]                 = useState(false)

  const statusBadge  = accountStatusBadge(profile.accountStatus)
  const regFormatted = fmtDate(profile.regDate)

  // Collect known branches and batches from all profiles for datalist suggestions
  const allProfiles    = Object.values(studentProfiles)
  const knownBranches  = [...new Set(allProfiles.map(p => p.branch).filter(Boolean))].sort()
  const knownBatches   = [...new Set(allProfiles.flatMap(p => p.batches || []).filter(Boolean))].sort()

  function startEdit() {
    setEditBranch(profile.branch || '')
    setEditBatches([...(profile.batches || [])])
    setBatchInput('')
    setEditParentMobiles([...(profile.parentMobiles || [])])
    setParentInput('')
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  function addBatch() {
    const val = batchInput.trim()
    if (val && !editBatches.includes(val)) setEditBatches(b => [...b, val])
    setBatchInput('')
  }

  function removeBatch(b) {
    setEditBatches(bs => bs.filter(x => x !== b))
  }

  function addParentMobile() {
    const val = parentInput.trim().replace(/\D/g, '')
    if (val && !editParentMobiles.includes(val)) setEditParentMobiles(m => [...m, val])
    setParentInput('')
  }

  function removeParentMobile(m) {
    setEditParentMobiles(ms => ms.filter(x => x !== m))
  }

  async function saveEdit() {
    setSaving(true)
    await Promise.all([
      updateStudentBranchBatch(profile.lwsId || null, name, {
        branch: editBranch.trim(),
        batches: editBatches,
      }),
      updateStudentParentMobiles(profile.lwsId || null, name, editParentMobiles),
    ])
    setSaving(false)
    setIsEditing(false)
  }

  const canEdit = mode === 'faculty'

  return (
    <Card className="flex items-start gap-5 flex-wrap relative">
      {/* Avatar */}
      <div className="w-11 h-11 rounded-full bg-accent-soft flex items-center justify-center
                      text-[16px] font-extrabold text-accent flex-shrink-0 mt-0.5">
        {name.trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-[200px]">
        <div className="font-extrabold text-[15px]">{profile.name}</div>
        <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-ink-3 flex-wrap">
          {profile.lwsId && (
            <span className="bg-surface-2 border border-border px-2 py-0.5 rounded">{profile.lwsId}</span>
          )}
          {profile.gender && <span>{profile.gender === 'Male' ? '♂' : '♀'} {profile.gender}</span>}
          {profile.dob && <span>DOB: {fmtDate(profile.dob)}</span>}
          {regFormatted && <span>Reg: {regFormatted}</span>}
        </div>
        {loginStats !== null && (
          <div className="mt-1.5 text-[11px] font-mono">
            {loginStats.count === 0
              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                                 bg-amber-100 border border-amber-300 text-amber-700 font-semibold">
                  ⚠ Never logged in
                </span>
              : <span className="text-ink-3">
                  Last login: {relativeDate(loginStats.lastLogin)} · {loginStats.count} login{loginStats.count !== 1 ? 's' : ''}
                </span>
            }
          </div>
        )}
      </div>

      {/* Branch / Batch — view or edit */}
      <div className="flex flex-col md:flex-row flex-wrap gap-2 md:gap-4 text-[12px]">
        {isEditing ? (
          <div className="flex flex-col gap-3 w-full">
            {/* Branch input */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Branch</div>
              <input
                list="known-branches"
                value={editBranch}
                onChange={e => setEditBranch(e.target.value)}
                placeholder="e.g. LWS"
                className="form-input text-[12px] py-1 w-full"
              />
              <datalist id="known-branches">
                {knownBranches.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>

            {/* Batches input */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Batches</div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {editBatches.map(b => (
                  <span key={b} className="flex items-center gap-1 bg-surface-2 border border-border
                                           text-[11px] font-mono px-2 py-0.5 rounded">
                    {b}
                    <button onClick={() => removeBatch(b)}
                            className="text-ink-3 hover:text-danger leading-none ml-0.5">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  list="known-batches"
                  value={batchInput}
                  onChange={e => setBatchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addBatch())}
                  placeholder="Add batch…"
                  className="form-input text-[12px] py-1 flex-1"
                />
                <datalist id="known-batches">
                  {knownBatches.map(b => <option key={b} value={b} />)}
                </datalist>
                <button onClick={addBatch}
                        className="btn btn-secondary btn-sm text-[11px] px-3 min-h-[44px]">+ Add</button>
              </div>
            </div>

            {/* Parent Mobiles */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Parent Mobiles</div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {editParentMobiles.map((m, i) => (
                  <span key={i} className="flex items-center gap-1 bg-surface-2 border border-border
                                           text-[11px] font-mono px-2 py-0.5 rounded">
                    {m}
                    <button onClick={() => removeParentMobile(m)}
                            className="text-ink-3 hover:text-danger leading-none ml-0.5">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="tel"
                  value={parentInput}
                  onChange={e => setParentInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addParentMobile())}
                  placeholder="Add mobile number…"
                  className="form-input text-[12px] py-1 flex-1"
                />
                <button onClick={addParentMobile}
                        className="btn btn-secondary btn-sm text-[11px] px-3 min-h-[44px]">+ Add</button>
              </div>
            </div>

            {/* Save / Cancel */}
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                disabled={saving}
                className="btn btn-primary btn-sm text-[11px]"
              >
                {saving ? 'Saving…' : '💾 Save'}
              </button>
              <button onClick={cancelEdit} className="btn btn-secondary btn-sm text-[11px]">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {profile.batches?.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Batch</div>
                {profile.batches.map(b => (
                  <span key={b} className="bg-surface-2 border border-border text-[11px] font-mono px-2 py-0.5 rounded mr-1">{b}</span>
                ))}
              </div>
            )}
            {profile.branch && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Branch</div>
                <span className="font-semibold">{profile.branch}</span>
              </div>
            )}
          </>
        )}

        {profile.mobile && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Mobile</div>
            <span>{profile.mobile}</span>
          </div>
        )}
        {profile.parentMobiles?.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Parent Mobiles</div>
            <div className="flex flex-wrap gap-1">
              {profile.parentMobiles.map((m, i) => (
                <span key={i} className="bg-surface-2 border border-border text-[11px] font-mono px-2 py-0.5 rounded">{m}</span>
              ))}
            </div>
          </div>
        )}
        {statusBadge && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Status</div>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
        )}
      </div>

      {/* Edit button — faculty only, not while already editing */}
      {canEdit && !isEditing && (
        <button
          onClick={startEdit}
          title="Edit branch & batch"
          className="absolute top-3 right-3 text-[13px] text-ink-3 hover:text-accent
                     transition-colors p-1 rounded hover:bg-accent-soft"
        >
          ✏️
        </button>
      )}
    </Card>
  )
}

// ── Improvement Plan Card ─────────────────────────────────────
export function ImprovementPlan({ savedPlan }) {
  return (
    <Card>
      <CardTitle>Improvement Plan</CardTitle>
      {savedPlan ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <Badge variant="green">✅ Saved {new Date(savedPlan.generatedAt).toLocaleDateString('en-IN')}</Badge>
          </div>
          <div className="bg-surface-2 border border-border rounded-xl p-4 text-[13px]
                          leading-relaxed text-ink whitespace-pre-wrap font-sans max-h-[500px] overflow-y-auto">
            {savedPlan.text}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">
          No plan saved yet. Export your data, upload to Claude, and import the enriched JSON.
        </p>
      )}
    </Card>
  )
}
