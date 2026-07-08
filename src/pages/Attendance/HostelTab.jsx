import { useState, useEffect, useMemo, useCallback } from 'react'
import useStore from '../../store/useStore'
import { supabase } from '../../lib/supabase'
import { EmptyState, Spinner, Alert } from '../../components/ui'
import { buildDailyChain, resolveOnLeave, CHECKPOINT_ORDER, CHECKPOINT_LABEL } from '../../lib/analytics/chain'
import { CAPTURE_CHECKPOINTS, ROLL_CHECKPOINTS } from '../../store/slices/checkpointSlice'

// Hostel + mess attendance board for APJ boarders. Exception-only capture
// (default-present); roll checkpoints add a reconciliation gate. Admin-only,
// scoped to branch='APJ'. Phase 1 — see FLOWS.md "Hostel & Mess".

// Exception status cycle on tap: present → absent → sick → outpass → present.
const STATUS_CYCLE = { undefined: 'absent', absent: 'sick', sick: 'outpass', outpass: undefined }
const STATUS_META = {
  present: { label: 'Present', cls: 'text-green-500' },
  absent:  { label: 'Absent',  cls: 'text-red-400 bg-red-400/10 border-red-400/30' },
  sick:    { label: 'Sick',    cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  outpass: { label: 'Out-pass',cls: 'text-sky-400 bg-sky-400/10 border-sky-400/30' },
  leave:   { label: 'Leave',   cls: 'text-purple-400' },
  late:    { label: 'Late',    cls: 'text-yellow-400' },
}
// For a roll reconciliation, "away" = physically not in the dorm.
const AWAY_STATUSES = new Set(['absent', 'outpass'])

function todayDmy() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}
function dmyToIso(dmy) {
  const [d, m, y] = dmy.split('-')
  return `${y}-${m}-${d}`
}
function isoToDmy(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}
// Local-midnight epoch bounds for a DD-MM-YYYY day (leave-overlap arithmetic).
function dayBoundsMs(dmy) {
  const [d, m, y] = dmy.split('-').map(Number)
  return { startMs: new Date(y, m - 1, d, 0, 0, 0).getTime(), endMs: new Date(y, m - 1, d, 23, 59, 59).getTime() }
}

export default function HostelTab() {
  const studentProfiles = useStore(s => s.studentProfiles)
  const setActiveStudent = useStore(s => s.setActiveStudent)
  const setCheckpointExceptions = useStore(s => s.setCheckpointExceptions)
  const getCheckpointExceptionsForDate = useStore(s => s.getCheckpointExceptionsForDate)
  const confirmRoll = useStore(s => s.confirmRoll)
  const getConfirmationsForDate = useStore(s => s.getConfirmationsForDate)
  const fetchDailyAttendance = useStore(s => s.fetchDailyAttendance)
  const getActiveLeaves = useStore(s => s.getActiveLeaves)
  const hostelAlertMobiles = useStore(s => s.hostelAlertMobiles)
  const setHostelAlertMobiles = useStore(s => s.setHostelAlertMobiles)

  const [view, setView] = useState('mark')          // 'mark' | 'chain'
  const [date, setDate] = useState(todayDmy)
  const [checkpoint, setCheckpoint] = useState('hostel_pm')
  const [edits, setEdits] = useState({})            // lwsId → status (present omitted)
  const [saved, setSaved] = useState({})            // last-saved snapshot for this (date, cp)
  const [headcount, setHeadcount] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState(null)

  // Board data for the chain view.
  const [attendanceRows, setAttendanceRows] = useState([])
  const [checkpointRows, setCheckpointRows] = useState([])
  const [confirmations, setConfirmations] = useState([])
  const [onLeaveIds, setOnLeaveIds] = useState(() => new Set())

  // Warden alert.
  const [alerting, setAlerting] = useState(false)
  const [alertResult, setAlertResult] = useState(null)
  const [showAlertCfg, setShowAlertCfg] = useState(false)
  const [newWarden, setNewWarden] = useState('')

  const isRoll = ROLL_CHECKPOINTS.includes(checkpoint)

  // APJ boarder roster (Active, non-variant profiles). residential filtering
  // hooks in here once the profile carries the flag; today all APJ are boarders.
  const roster = useMemo(() => {
    const out = []
    for (const [key, p] of Object.entries(studentProfiles)) {
      if (!p || p.name !== key) continue                 // skip variant-keyed entries
      if (p.branch !== 'APJ') continue
      if (p.accountStatus && p.accountStatus !== 'Active') continue
      out.push({ lwsId: p.lwsId, name: p.name })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [studentProfiles])

  const loadDay = useCallback(async () => {
    setLoading(true)
    try {
      const [cpRows, att, confs, leaves] = await Promise.all([
        getCheckpointExceptionsForDate(date),
        fetchDailyAttendance(date),
        getConfirmationsForDate(date),
        (async () => {
          const { startMs, endMs } = dayBoundsMs(date)
          const rows = await getActiveLeaves(new Date(startMs).toISOString(), new Date(endMs).toISOString())
          return resolveOnLeave(
            rows.map(r => ({ lwsId: r.lws_id, fromMs: new Date(r.from_ts).getTime(), toMs: new Date(r.to_ts).getTime() })),
            startMs, endMs,
          )
        })(),
      ])
      setCheckpointRows(cpRows)
      setAttendanceRows(att.rows || [])
      setConfirmations(confs)
      setOnLeaveIds(leaves)
      // Seed the marking grid from saved exceptions for the selected checkpoint.
      const forCp = {}
      for (const r of cpRows) if (r.checkpoint === checkpoint) forCp[r.lws_id] = r.status
      setEdits(forCp)
      setSaved(forCp)
    } finally {
      setLoading(false)
    }
  }, [date, checkpoint, getCheckpointExceptionsForDate, fetchDailyAttendance, getConfirmationsForDate, getActiveLeaves])

  useEffect(() => { loadDay() }, [loadDay])

  function cycle(lwsId) {
    setEdits(prev => {
      const next = { ...prev }
      const nextStatus = STATUS_CYCLE[prev[lwsId]]
      if (nextStatus === undefined) delete next[lwsId]
      else next[lwsId] = nextStatus
      return next
    })
  }

  const exceptionCount = Object.keys(edits).length
  const awayCount = Object.values(edits).filter(s => AWAY_STATUSES.has(s)).length
  const expectedInDorm = roster.length - awayCount
  const dirty = useMemo(() => JSON.stringify(edits) !== JSON.stringify(saved), [edits, saved])

  async function handleSave() {
    setSaving(true)
    setBanner(null)
    const exceptions = Object.entries(edits).map(([lwsId, status]) => ({ lwsId, status }))
    const ok = await setCheckpointExceptions(date, checkpoint, exceptions)
    setSaving(false)
    if (ok) {
      setSaved({ ...edits })
      setBanner({ type: 'success', msg: `Saved ${CHECKPOINT_LABEL[checkpoint]} — ${exceptionCount} exception${exceptionCount !== 1 ? 's' : ''}.` })
      loadDay()
    } else {
      setBanner({ type: 'error', msg: 'Save failed — check your session and try again.' })
    }
  }

  async function handleConfirmRoll() {
    const present = Number(headcount)
    if (!Number.isInteger(present) || present < 0) {
      setBanner({ type: 'error', msg: 'Enter the physical headcount to reconcile.' })
      return
    }
    setSaving(true)
    const ok = await confirmRoll(date, checkpoint, {
      expectedCount: roster.length, exceptionCount: awayCount, confirmedPresent: present,
    })
    setSaving(false)
    if (ok) {
      const reconciled = present === expectedInDorm
      setBanner({
        type: reconciled ? 'success' : 'error',
        msg: reconciled
          ? `${CHECKPOINT_LABEL[checkpoint]} reconciled ✓ (${present} in dorm).`
          : `⚠ Headcount ${present} ≠ expected ${expectedInDorm}. Logged as an OPEN incident — resolve before closing.`,
      })
      setHeadcount('')
      loadDay()
    } else {
      setBanner({ type: 'error', msg: 'Reconcile failed — check your session.' })
    }
  }

  function addWarden() {
    const digits = newWarden.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) return
    setHostelAlertMobiles([...hostelAlertMobiles, digits])
    setNewWarden('')
  }
  function removeWarden(n) {
    setHostelAlertMobiles(hostelAlertMobiles.filter(x => x !== n))
  }

  // Fire the warden alert. The server RE-computes the chain for `date` and sends
  // to the configured warden numbers — this button just triggers it.
  async function sendWardenAlert() {
    if (!supabase) { setAlertResult({ error: 'Supabase not configured locally — deploy to Vercel to send.' }); return }
    setAlerting(true); setAlertResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in as admin to send alerts.')
      const r = await fetch('/api/send-hostel-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ date }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error || 'Alert failed')
      setAlertResult({ ok: data.sent > 0, sent: data.sent ?? 0, count: data.count ?? 0, message: data.message })
    } catch (e) {
      setAlertResult({ error: e.message })
    } finally {
      setAlerting(false)
    }
  }

  // ── Chain / anomaly board ───────────────────────────────────
  const chain = useMemo(
    () => buildDailyChain({ roster, attendanceRows, checkpointRows, onLeaveIds }),
    [roster, attendanceRows, checkpointRows, onLeaveIds],
  )
  const anomalies = chain.filter(r => r.anomaly)
  const openRolls = ROLL_CHECKPOINTS.filter(cp => {
    const c = confirmations.find(x => x.checkpoint === cp)
    return !c || !c.reconciled
  })

  if (roster.length === 0) {
    return <EmptyState icon="🏠" title="No APJ boarders" sub="Hostel & mess tracking is scoped to the APJ branch. No Active APJ students found." />
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="date"
          value={dmyToIso(date)}
          onChange={e => e.target.value && setDate(isoToDmy(e.target.value))}
          className="form-input text-[13px] min-h-[44px] px-3"
          aria-label="Attendance date"
        />
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setView('mark')}
            aria-pressed={view === 'mark'}
            className={`px-4 py-2 text-[12px] font-semibold min-h-[44px] ${view === 'mark' ? 'bg-accent text-black' : 'text-ink-3 hover:text-ink'}`}
          >Mark</button>
          <button
            type="button"
            onClick={() => setView('chain')}
            aria-pressed={view === 'chain'}
            className={`px-4 py-2 text-[12px] font-semibold min-h-[44px] ${view === 'chain' ? 'bg-accent text-black' : 'text-ink-3 hover:text-ink'}`}
          >
            Chain {anomalies.length > 0 && <span className="ml-1 text-danger">({anomalies.length})</span>}
          </button>
        </div>
      </div>

      {banner && (
        <div className="mb-4"><Alert type={banner.type}>{banner.msg}<button onClick={() => setBanner(null)} className="ml-3 text-[12px] underline">dismiss</button></Alert></div>
      )}

      {view === 'mark' ? (
        <>
          {/* Checkpoint selector */}
          <div className="flex flex-wrap gap-2 mb-4">
            {CAPTURE_CHECKPOINTS.map(cp => (
              <button
                key={cp}
                type="button"
                onClick={() => setCheckpoint(cp)}
                aria-pressed={checkpoint === cp}
                className={`px-3 py-2 rounded-full text-[12px] font-semibold border min-h-[40px] transition-colors
                  ${checkpoint === cp ? 'border-accent text-accent bg-accent-soft/40' : 'border-border text-ink-3 hover:text-ink'}
                  ${ROLL_CHECKPOINTS.includes(cp) ? 'ring-1 ring-inset ring-purple-400/20' : ''}`}
              >
                {CHECKPOINT_LABEL[cp]}
              </button>
            ))}
          </div>

          {/* Summary + tally */}
          <div className="flex flex-wrap gap-3 mb-4 text-[12px]">
            <span className="card px-4 py-2">Roster <b className="text-ink">{roster.length}</b></span>
            <span className="card px-4 py-2">Exceptions <b className="text-red-400">{exceptionCount}</b></span>
            {isRoll && <span className="card px-4 py-2">Expected in dorm <b className="text-ink">{expectedInDorm}</b></span>}
          </div>

          {loading ? (
            <div className="flex items-center gap-3 py-16 justify-center text-ink-3"><Spinner /> Loading…</div>
          ) : (
            <div className="card divide-y divide-border">
              {roster.map(st => {
                const status = onLeaveIds.has(st.lwsId) ? 'leave' : (edits[st.lwsId] || 'present')
                const onLeave = onLeaveIds.has(st.lwsId)
                const meta = STATUS_META[status]
                return (
                  <div key={st.lwsId} className="flex items-center justify-between gap-3 px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setActiveStudent(st.name)}
                      className="text-[13px] font-medium text-ink text-left hover:text-accent hover:underline"
                    >{st.name}</button>
                    <button
                      type="button"
                      disabled={onLeave}
                      onClick={() => cycle(st.lwsId)}
                      aria-label={`${st.name}: ${meta.label}${onLeave ? ' (on leave)' : ', tap to change'}`}
                      className={`text-[11px] font-bold font-mono px-3 py-1.5 rounded-full border min-h-[36px] min-w-[92px]
                        ${status === 'present' ? 'border-transparent' : 'border'} ${meta.cls}
                        ${onLeave ? 'opacity-70 cursor-default' : 'hover:brightness-110'}`}
                    >{meta.label}</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Save + reconciliation */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="btn btn-primary min-h-[44px] px-5"
            >{saving ? <Spinner size="sm" /> : `Save ${CHECKPOINT_LABEL[checkpoint]}`}</button>
            {dirty && <span className="text-[12px] text-yellow-400">Unsaved changes</span>}
          </div>

          {isRoll && (
            <div className="card px-5 py-4 mt-5">
              <div className="text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-3">Reconciliation gate</div>
              <div className="text-[13px] text-ink-2 mb-3">
                Expected in dorm = {roster.length} roster − {awayCount} away (absent/out-pass) = <b className="text-ink">{expectedInDorm}</b>.
                Enter the physical headcount to close the roll.
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  min={0}
                  value={headcount}
                  onChange={e => setHeadcount(e.target.value)}
                  placeholder="Headcount"
                  className="form-input w-32 text-center text-[14px] min-h-[44px] px-3"
                  aria-label="Physical headcount"
                />
                <button type="button" onClick={handleConfirmRoll} disabled={saving || dirty} className="btn btn-primary min-h-[44px] px-5">
                  Reconcile & close
                </button>
                {dirty && <span className="text-[12px] text-yellow-400">Save exceptions first</span>}
              </div>
            </div>
          )}
        </>
      ) : (
        // ── Chain / anomaly board ──────────────────────────────
        <>
          {openRolls.length > 0 && (
            <Alert type="error">
              ⚠ Unreconciled roll{openRolls.length !== 1 ? 's' : ''} for {date}: {openRolls.map(cp => CHECKPOINT_LABEL[cp]).join(', ')}. Reconcile in the Mark view.
            </Alert>
          )}
          <div className="mt-4 mb-3 text-[13px] text-ink-2">
            {anomalies.length === 0
              ? <span className="text-success font-semibold">✓ No unexplained absences — every boarder is accounted for on {date}.</span>
              : <span className="text-danger font-semibold">{anomalies.length} boarder{anomalies.length !== 1 ? 's' : ''} fell off the chain (unexplained) on {date}.</span>}
          </div>

          {/* Warden alert */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button
              type="button"
              onClick={sendWardenAlert}
              disabled={alerting || anomalies.length === 0 || hostelAlertMobiles.length === 0}
              className="btn btn-primary min-h-[44px] px-5"
            >
              {alerting ? <Spinner size="sm" /> : `📣 Alert warden${anomalies.length ? ` (${anomalies.length})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => setShowAlertCfg(v => !v)}
              className="text-[12px] text-ink-3 underline hover:text-ink"
            >
              Warden numbers ({hostelAlertMobiles.length})
            </button>
            {anomalies.length > 0 && hostelAlertMobiles.length === 0 && (
              <span className="text-[12px] text-yellow-400">Add a warden number to enable alerts</span>
            )}
          </div>

          {showAlertCfg && (
            <div className="card px-4 py-3 mb-3">
              <div className="text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">Warden alert numbers</div>
              <div className="flex gap-2 mb-2">
                <input
                  value={newWarden}
                  onChange={e => setNewWarden(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addWarden()}
                  placeholder="10-digit mobile"
                  className="form-input flex-1 text-[13px] font-mono min-h-[44px] px-3"
                  aria-label="Warden mobile number"
                />
                <button type="button" onClick={addWarden} disabled={!newWarden.trim()} className="btn btn-primary px-4 min-h-[44px]">Add</button>
              </div>
              {hostelAlertMobiles.length === 0 ? (
                <div className="text-[12px] text-ink-3 italic">No numbers — warden alerts are disabled.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {hostelAlertMobiles.map(n => (
                    <span key={n} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-surface-2 border border-border text-[13px] font-mono">
                      {n}
                      <button type="button" onClick={() => removeWarden(n)} aria-label={`Remove ${n}`} className="text-ink-3 hover:text-red-500 w-5 h-5 rounded-full flex items-center justify-center">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-ink-3 mt-2">Alerts fire only when you press <b>Alert warden</b>. The message is built server-side from this day's chain. Requires the Wabridge template to be configured (fails safe until then).</div>
            </div>
          )}

          {alertResult && (
            <div className="mb-3">
              <Alert type={alertResult.error ? 'error' : 'success'}>
                {alertResult.error
                  ? `❌ ${alertResult.error}`
                  : alertResult.sent > 0
                    ? `✓ Warden alerted (${alertResult.count} boarder${alertResult.count !== 1 ? 's' : ''}).`
                    : `${alertResult.message || 'Nothing to alert.'}`}
                <button onClick={() => setAlertResult(null)} className="ml-3 text-[12px] underline">dismiss</button>
              </Alert>
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-[10px] font-mono uppercase tracking-widest text-ink-3">
                  <th className="text-left px-3 py-2.5 sticky left-0 bg-surface">Boarder</th>
                  {CHECKPOINT_ORDER.map(cp => <th key={cp} className="px-2 py-2.5">{CHECKPOINT_LABEL[cp]}</th>)}
                  <th className="px-3 py-2.5">First break</th>
                </tr>
              </thead>
              <tbody>
                {(anomalies.length ? anomalies : chain).map((r, i) => (
                  <tr key={r.lwsId} className={`border-b border-border ${r.anomaly ? 'bg-red-400/5' : i % 2 ? 'bg-surface-2/40' : ''}`}>
                    <td className="px-3 py-2 font-medium text-ink sticky left-0 bg-inherit">
                      <button type="button" onClick={() => setActiveStudent(r.name)} className="hover:text-accent hover:underline">{r.name}</button>
                    </td>
                    {CHECKPOINT_ORDER.map(cp => {
                      const s = r.statuses[cp]
                      const dot = s === 'present' ? 'text-green-500/70' : s === 'absent' ? 'text-red-400' : 'text-ink-3'
                      return <td key={cp} className={`px-2 py-2 text-center font-mono ${dot}`} title={STATUS_META[s]?.label || s}>
                        {s === 'present' ? '·' : s === 'absent' ? '✕' : STATUS_META[s]?.label?.[0] || '?'}
                      </td>
                    })}
                    <td className="px-3 py-2 text-center text-danger font-semibold">{r.firstBreak ? CHECKPOINT_LABEL[r.firstBreak] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
