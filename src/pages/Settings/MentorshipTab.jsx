import { useState, useEffect, useMemo } from 'react'
import { Card } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import useStore from '../../store/useStore'

// Calls the admin POST path of /api/send-mentor-nudges with the current session.
async function callNudges(body) {
  if (!supabase) return { ok: false, error: 'Supabase not configured locally — run via Vercel or npm run dev with .env.local.' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'Sign in as admin first.' }
  try {
    const r = await fetch('/api/send-mentor-nudges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    return await r.json()
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

export default function MentorshipTab() {
  const [busy, setBusy] = useState(false)
  const [testMobile, setTestMobile] = useState('')
  const [result, setResult] = useState(null) // { kind, data }

  async function run(body, kind) {
    setBusy(true)
    setResult(null)
    const data = await callNudges(body)
    setBusy(false)
    setResult({ kind, data })
  }

  // force:true bypasses the Mon–Fri gate so you can preview/test any day.
  const dryRun   = () => run({ dryRun: true, force: true }, 'dry')
  const testSend = () => {
    if (testMobile.replace(/\D/g, '').length < 10) return
    run({ redirectTo: testMobile, force: true }, 'test')
  }

  const data = result?.data

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Mentorship nudges</div>
        <p className="text-[13px] text-ink-2 leading-relaxed mb-3">
          Each weekday morning every mentor is sent 3 mentees to check in with, rotating so everyone is
          covered before anyone repeats. This runs automatically (Mon–Fri). Use the tools below to preview
          today's picks or send yourself a test — neither advances the live rotation.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={dryRun}
            disabled={busy}
          >{busy ? 'Working…' : 'Preview today’s picks'}</button>

          <span className="text-ink-3 text-[12px] mx-1">or send a real test message to:</span>
          <input
            className="input text-[13px] w-40"
            placeholder="10-digit mobile"
            type="tel"
            inputMode="numeric"
            value={testMobile}
            onChange={e => setTestMobile(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && testSend()}
          />
          <button
            className="btn px-4 text-[12px] min-h-[36px] border border-border disabled:opacity-40"
            onClick={testSend}
            disabled={busy || testMobile.replace(/\D/g, '').length < 10}
          >Send test</button>
        </div>
      </Card>

      {result && (
        <Card>
          {!data?.ok ? (
            <div className="text-[13px] text-red-600">{data?.error || 'Request failed'}</div>
          ) : data.skipped === 'weekend' ? (
            <div className="text-[13px] text-ink-2">{data.lines?.[0]}</div>
          ) : (
            <>
              <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">
                {result.kind === 'dry'
                  ? `Today’s picks — ${data.today}`
                  : `Test send — ${data.today} (redirected, rotation untouched)`}
              </div>

              {result.kind === 'dry' && Array.isArray(data.planned) && (
                data.planned.length === 0
                  ? <p className="text-[13px] text-ink-3 italic">No picks — every mentor's round is already complete for today, or no active mentees.</p>
                  : (
                    <div className="divide-y divide-border mb-3">
                      {data.planned.map((p, i) => (
                        <div key={i} className="py-2 flex items-baseline gap-3">
                          <div className="text-[13px] font-medium w-32 shrink-0">{p.teacher}</div>
                          <div className="text-[13px] text-ink-2">{p.students.join(', ')}</div>
                        </div>
                      ))}
                    </div>
                  )
              )}

              {Array.isArray(data.lines) && (
                <pre className="text-[11px] text-ink-3 bg-surface-2 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                  {data.lines.join('\n')}
                </pre>
              )}
            </>
          )}
        </Card>
      )}

      <MenteeAssignments />
    </div>
  )
}

// ── Mentee assignment management ────────────────────────────────────────────
// Reassign / remove mentees and surface active students who have no mentor, so
// nobody silently falls out of the daily rotation. Reads `mentor_assignments`
// on mount; mutations re-fetch.
function MenteeAssignments() {
  const teachers              = useStore(s => s.timetableTeachers)
  const studentProfiles       = useStore(s => s.studentProfiles)
  const fetchMentorAssignments = useStore(s => s.fetchMentorAssignments)
  const setMentorAssignment    = useStore(s => s.setMentorAssignment)
  const removeMentorAssignment = useStore(s => s.removeMentorAssignment)

  const [assignments, setAssignments] = useState(null) // [{lwsId, teacherId}] | null
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  async function refresh() {
    setLoading(true)
    setAssignments(await fetchMentorAssignments())
    setLoading(false)
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [])

  // lwsId → canonical profile (skip variant-keyed map entries; dedupe by lwsId).
  const profileByLws = useMemo(() => {
    const m = new Map()
    for (const [key, p] of Object.entries(studentProfiles || {})) {
      if (!p?.lwsId || p.name !== key) continue
      if (!m.has(p.lwsId)) m.set(p.lwsId, p)
    }
    return m
  }, [studentProfiles])

  const teachersSorted = useMemo(
    () => [...(teachers || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [teachers],
  )
  const teacherName = id => (teachers || []).find(t => t.id === id)?.name || id

  const { byMentor, unassignedActive } = useMemo(() => {
    const assignedTo = new Map((assignments || []).map(a => [a.lwsId, a.teacherId]))
    const groups = new Map()
    for (const [lwsId, teacherId] of assignedTo) {
      if (!groups.has(teacherId)) groups.set(teacherId, [])
      groups.get(teacherId).push({ lwsId, profile: profileByLws.get(lwsId) || null })
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.profile?.name || a.lwsId).localeCompare(b.profile?.name || b.lwsId))
    }
    const unassigned = [...profileByLws.values()]
      .filter(p => p.accountStatus === 'Active' && !assignedTo.has(p.lwsId))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { byMentor: groups, unassignedActive: unassigned }
  }, [assignments, profileByLws])

  async function reassign(lwsId, teacherId) {
    if (!teacherId) return
    setBusy(true)
    await setMentorAssignment(lwsId, teacherId)
    await refresh()
    setBusy(false)
  }
  async function remove(lwsId) {
    setBusy(true)
    await removeMentorAssignment(lwsId)
    await refresh()
    setBusy(false)
  }

  const matches = name => !search.trim() || (name || '').toLowerCase().includes(search.toLowerCase())
  const mentorIds = [...byMentor.keys()].sort((a, b) => teacherName(a).localeCompare(teacherName(b)))
  const totalAssigned = (assignments || []).length

  const MentorSelect = ({ lwsId, value }) => (
    <select
      className="input text-[12px] py-0.5 px-1 w-36"
      value={value || ''}
      disabled={busy}
      onChange={e => reassign(lwsId, e.target.value)}
    >
      {!value && <option value="">— assign —</option>}
      {teachersSorted.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  )

  return (
    <Card>
      <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2 flex items-center justify-between">
        <span>Mentee assignments</span>
        {!loading && (
          <span className="text-ink-3 normal-case font-normal">
            {totalAssigned} assigned · {mentorIds.length} mentor{mentorIds.length !== 1 ? 's' : ''}
            {unassignedActive.length > 0 && <span className="text-amber-600"> · {unassignedActive.length} unassigned</span>}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-[13px] text-ink-3 italic">Loading assignments…</p>
      ) : (
        <>
          <input
            className="input w-full text-[13px] mb-3"
            placeholder="Filter by student name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {unassignedActive.filter(p => matches(p.name)).length > 0 && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-2">
              <div className="text-[11px] font-semibold text-amber-700 mb-1">
                Active students with no mentor — assign so they enter the rotation
              </div>
              <div className="divide-y divide-amber-100">
                {unassignedActive.filter(p => matches(p.name)).map(p => (
                  <div key={p.lwsId} className="py-1.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0 text-[13px] truncate">
                      {p.name} <span className="text-ink-3 text-[11px]">· {(p.batches || []).join(', ') || 'no batch'}</span>
                    </div>
                    <MentorSelect lwsId={p.lwsId} value={null} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {mentorIds.length === 0 && unassignedActive.length === 0 ? (
            <p className="text-[13px] text-ink-3 italic">No assignments yet.</p>
          ) : (
            <div className="space-y-3">
              {mentorIds.map(tid => {
                const mentees = byMentor.get(tid).filter(m => matches(m.profile?.name || m.lwsId))
                if (mentees.length === 0) return null
                return (
                  <div key={tid}>
                    <div className="text-[12px] font-semibold mb-1">
                      {teacherName(tid)} <span className="text-ink-3 font-normal">({byMentor.get(tid).length})</span>
                    </div>
                    <div className="divide-y divide-border">
                      {mentees.map(({ lwsId, profile }) => (
                        <div key={lwsId} className="py-1.5 flex items-center gap-2">
                          <div className="flex-1 min-w-0 text-[13px] truncate">
                            {profile?.name || <span className="text-ink-3 italic">unknown ({lwsId})</span>}
                            {profile && profile.accountStatus !== 'Active' && (
                              <span className="text-[11px] text-red-500"> · {profile.accountStatus}</span>
                            )}
                          </div>
                          <MentorSelect lwsId={lwsId} value={tid} />
                          <button
                            className="text-[12px] text-red-500 hover:text-red-700 px-1.5 disabled:opacity-40"
                            disabled={busy}
                            onClick={() => remove(lwsId)}
                            title="Remove from mentorship"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
