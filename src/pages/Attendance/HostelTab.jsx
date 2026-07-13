import { useState, useEffect, useMemo, useCallback } from 'react'
import useStore from '../../store/useStore'
import { supabase } from '../../lib/supabase'
import { EmptyState, Spinner, Alert } from '../../components/ui'
import { buildDailyChain, resolveOnLeave, CHECKPOINT_ORDER, CHECKPOINT_LABEL } from '../../lib/analytics/chain'
import { CAPTURE_CHECKPOINTS, ROLL_CHECKPOINTS } from '../../store/slices/checkpointSlice'
import { OPEN_LEAVE_TO_TS } from '../../store/slices/leavesSlice'
import { downloadHostelLeaveReportPdf } from '../../lib/hostelLeaveReportPdf'

// Hostel + mess attendance board for APJ boarders. Exception-only capture
// (default-present); roll checkpoints add a reconciliation gate. Admin-only,
// scoped to branch='APJ'. Phase 1 — see FLOWS.md "Hostel & Mess".

// Branches that have a hostel. Today just APJ (the boarder scope); adding a
// second here makes the branch filter appear automatically. Could move to
// config if hostel branches ever become faculty-managed.
const HOSTEL_BRANCHES = ['APJ']

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
// An open leave out this many days or more is flagged for review — the guard
// against a persist-until-return leave silently masking a boarder forever.
const STALE_LEAVE_DAYS = 3
const DAY_MS = 86_400_000
// A leave at/after this instant is treated as open-ended (the 2099 sentinel).
const OPEN_LEAVE_MS = Date.parse(OPEN_LEAVE_TO_TS)

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
  const endLeave = useStore(s => s.endLeave)
  const addLeave = useStore(s => s.addLeave)
  const hostelAlertMobiles = useStore(s => s.hostelAlertMobiles)
  const setHostelAlertMobiles = useStore(s => s.setHostelAlertMobiles)

  const [view, setView] = useState('mark')          // 'mark' | 'chain' | 'leave'
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
  const [leaveRows, setLeaveRows] = useState([])    // raw open leaves overlapping `date`

  // "Put on leave" form (On Leave view).
  const [showAddLeave, setShowAddLeave] = useState(false)
  const [addSel, setAddSel] = useState(() => new Set())   // lwsIds to put on leave
  const [addReason, setAddReason] = useState('')
  const [addQuery, setAddQuery] = useState('')
  const [addingLeave, setAddingLeave] = useState(false)
  const [downloadingReport, setDownloadingReport] = useState(false)

  // Warden alert.
  const [alerting, setAlerting] = useState(false)
  const [alertResult, setAlertResult] = useState(null)
  const [showAlertCfg, setShowAlertCfg] = useState(false)
  const [newWarden, setNewWarden] = useState('')

  // Marking-list filters (display lens only — never narrow the save set,
  // reconciliation tally, or alert, which stay whole-hostel).
  const [fBranch, setFBranch] = useState('all')
  const [fBatch, setFBatch] = useState('all')
  const [fGender, setFGender] = useState('all')          // all | boys | girls

  const isRoll = ROLL_CHECKPOINTS.includes(checkpoint)

  // Boarder roster (Active, residential, non-variant profiles). Scoped to the
  // hostel branch(es) — today just APJ; add here (or move to config) when another
  // residential branch is onboarded. Day-scholars (residential === false) are
  // excluded — matches the warden-alert endpoint's `.eq('residential', true)`
  // filter so the board and the alert agree on who is a boarder.
  const roster = useMemo(() => {
    const out = []
    for (const [key, p] of Object.entries(studentProfiles)) {
      if (!p || p.name !== key) continue                 // skip variant-keyed entries
      if (!HOSTEL_BRANCHES.includes(p.branch)) continue
      if (p.accountStatus && p.accountStatus !== 'Active') continue
      if (p.residential === false) continue              // day-scholar → not a boarder
      out.push({ lwsId: p.lwsId, name: p.name, branch: p.branch, gender: p.gender, batches: p.batches || [], mobile: p.mobile || '', parentMobiles: p.parentMobiles || [] })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [studentProfiles])

  // Filter options derived from the roster.
  const branchOptions = useMemo(() => [...new Set(roster.map(r => r.branch))].sort(), [roster])
  const batchOptions = useMemo(() => {
    const inBranch = fBranch === 'all' ? roster : roster.filter(r => r.branch === fBranch)
    return [...new Set(inBranch.flatMap(r => r.batches))].sort()
  }, [roster, fBranch])

  // The display subset. `roster` stays whole for save/reconciliation/alert.
  const visibleRoster = useMemo(() => roster.filter(r => {
    if (fBranch !== 'all' && r.branch !== fBranch) return false
    if (fBatch !== 'all' && !r.batches.includes(fBatch)) return false
    if (fGender !== 'all') {
      const isGirl = r.gender === 'Female'
      if (fGender === 'girls' && !isGirl) return false
      if (fGender === 'boys' && isGirl) return false
    }
    return true
  }), [roster, fBranch, fBatch, fGender])
  const filtered = visibleRoster.length !== roster.length

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
          const ids = resolveOnLeave(
            // to_ts null → toMs null (open-ended); new Date(null) is epoch 0,
            // which would wrongly exclude the leave, so map it explicitly.
            rows.map(r => ({ lwsId: r.lws_id, fromMs: new Date(r.from_ts).getTime(), toMs: r.to_ts == null ? null : new Date(r.to_ts).getTime() })),
            startMs, endMs,
          )
          return { ids, rows }
        })(),
      ])
      setCheckpointRows(cpRows)
      setAttendanceRows(att.rows || [])
      setConfirmations(confs)
      setOnLeaveIds(leaves.ids)
      setLeaveRows(leaves.rows)
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

  // Close an open leave — the boarder returned. Stamps to_ts to the END of the
  // board's day, so `date` itself still reads as leave (they were out today) but
  // tomorrow's checkpoints expect them present again.
  async function handleMarkReturned(id) {
    const { endMs } = dayBoundsMs(date)
    const ok = await endLeave(id, new Date(endMs).toISOString())
    if (ok) {
      setBanner({ type: 'success', msg: 'Marked returned — leave closed as of ' + date + '.' })
      loadDay()
    } else {
      setBanner({ type: 'error', msg: 'Could not close the leave — check your session.' })
    }
  }

  // Boarders eligible to be put on leave = roster minus those already on leave,
  // narrowed by the picker search.
  const availableForLeave = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    return roster.filter(r => !onLeaveIds.has(r.lwsId) && (!q || r.name.toLowerCase().includes(q)))
  }, [roster, onLeaveIds, addQuery])

  function toggleAddSel(lwsId) {
    setAddSel(prev => {
      const next = new Set(prev)
      if (next.has(lwsId)) next.delete(lwsId); else next.add(lwsId)
      return next
    })
  }

  // Put the selected boarders on an OPEN-ENDED leave from the board day (they
  // stay on leave until "Mark returned"). Encoded with the 2099 sentinel.
  async function handlePutOnLeave() {
    const ids = [...addSel]
    if (ids.length === 0) return
    setAddingLeave(true)
    const fromTs = `${dmyToIso(date)}T00:00:00+05:30`
    const reason = addReason.trim() || null
    let ok = 0
    for (const lwsId of ids) {
      if (await addLeave({ lwsId, fromTs, toTs: OPEN_LEAVE_TO_TS, reason })) ok++
    }
    setAddingLeave(false)
    if (ok > 0) {
      setBanner({ type: 'success', msg: `Put ${ok} student${ok !== 1 ? 's' : ''} on leave from ${date}.` })
      setAddSel(new Set()); setAddReason(''); setAddQuery(''); setShowAddLeave(false)
      loadDay()
    } else {
      setBanner({ type: 'error', msg: 'Could not add leave — check your session.' })
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
      const r = await fetch('/api/send-attendance-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ kind: 'hostel', date }),
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

  // ── On-leave list (persist-until-return management) ─────────
  const nameByLwsId = useMemo(() => {
    const m = new Map()
    for (const r of roster) m.set(r.lwsId, r.name)
    return m
  }, [roster])
  const rosterByLwsId = useMemo(() => {
    const m = new Map()
    for (const r of roster) m.set(r.lwsId, r)
    return m
  }, [roster])
  // lwsId → open-leave id, so the meal grid can close a leave in place when a
  // boarder shows up (an explicit "returned?" tap, mirroring the class modal).
  const leaveIdByLwsId = useMemo(() => {
    const m = new Map()
    for (const r of leaveRows) if (nameByLwsId.has(r.lws_id) && !m.has(r.lws_id)) m.set(r.lws_id, r.id)
    return m
  }, [leaveRows, nameByLwsId])

  // Boarders currently on leave for `date`, longest-out first so stale rise to
  // the top. Scoped to the roster (APJ boarders). `daysOut` counts whole days
  // from the leave's start to the board day.
  const onLeaveList = useMemo(() => {
    const dayStartMs = dayBoundsMs(date).startMs
    return leaveRows
      .filter(r => nameByLwsId.has(r.lws_id))
      .map(r => {
        const fromMs = new Date(r.from_ts).getTime()
        const daysOut = Math.max(0, Math.floor((dayStartMs - fromMs) / DAY_MS))
        return {
          id: r.id,
          lwsId: r.lws_id,
          name: nameByLwsId.get(r.lws_id),
          fromDmy: isoToDmy(r.from_ts.slice(0, 10)),
          openEnded: r.to_ts == null || Date.parse(r.to_ts) >= OPEN_LEAVE_MS,
          daysOut,
          stale: daysOut >= STALE_LEAVE_DAYS,
        }
      })
      .sort((a, b) => b.daysOut - a.daysOut || a.name.localeCompare(b.name))
  }, [leaveRows, nameByLwsId, date])
  const staleCount = onLeaveList.filter(l => l.stale).length

  // Download the day's on-leave boarders as a PDF, grouped gender → class
  // (9th → 6M), batch-wise. Covers the WHOLE day's leaves — deliberately
  // independent of the Mark-view display filters.
  async function handleDownloadReport() {
    if (onLeaveList.length === 0) return
    setDownloadingReport(true)
    try {
      const rows = onLeaveList.map(l => {
        const r = rosterByLwsId.get(l.lwsId)
        return {
          lwsId: l.lwsId,
          name: l.name,
          gender: r?.gender || '',
          batch: r?.batches?.[0] || '',
          since: l.fromDmy,
          daysOut: l.daysOut,
          mobile: r?.mobile || '',
          parent: (r?.parentMobiles || []).join(', '),
        }
      })
      await downloadHostelLeaveReportPdf({ date, rows })
    } catch (e) {
      setBanner({ type: 'error', msg: `Could not build the report — ${e.message}` })
    } finally {
      setDownloadingReport(false)
    }
  }

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
          <button
            type="button"
            onClick={() => setView('leave')}
            aria-pressed={view === 'leave'}
            className={`px-4 py-2 text-[12px] font-semibold min-h-[44px] border-l border-border ${view === 'leave' ? 'bg-accent text-black' : 'text-ink-3 hover:text-ink'}`}
          >
            On Leave {onLeaveList.length > 0 && <span className={`ml-1 ${staleCount > 0 ? 'text-danger' : 'text-ink-3'}`}>({onLeaveList.length})</span>}
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

          {/* Summary + tally (always whole-hostel — filters below don't shrink these) */}
          <div className="flex flex-wrap gap-3 mb-4 text-[12px]">
            <span className="card px-4 py-2">Roster <b className="text-ink">{roster.length}</b></span>
            <span className="card px-4 py-2">Exceptions <b className="text-red-400">{exceptionCount}</b></span>
            {isRoll && <span className="card px-4 py-2">Expected in dorm <b className="text-ink">{expectedInDorm}</b></span>}
          </div>

          {/* Filters — narrow the marking LIST only (not the save/tally/alert) */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {branchOptions.length > 1 && (
              <select
                value={fBranch}
                onChange={e => { setFBranch(e.target.value); setFBatch('all') }}
                className="form-input text-[12px] min-h-[40px] px-2"
                aria-label="Filter by branch"
              >
                <option value="all">All branches</option>
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <select
              value={fBatch}
              onChange={e => setFBatch(e.target.value)}
              className="form-input text-[12px] min-h-[40px] px-2 max-w-[220px]"
              aria-label="Filter by batch"
            >
              <option value="all">All batches</option>
              {batchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <div className="inline-flex rounded-lg border border-border overflow-hidden">
              {[['all', 'All'], ['boys', 'Boys'], ['girls', 'Girls']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFGender(v)}
                  aria-pressed={fGender === v}
                  className={`px-3 py-2 text-[12px] font-semibold min-h-[40px] ${fGender === v ? 'bg-accent text-black' : 'text-ink-3 hover:text-ink'}`}
                >{label}</button>
              ))}
            </div>
            {filtered && (
              <span className="text-[12px] text-ink-3">
                Showing <b className="text-ink">{visibleRoster.length}</b> of {roster.length}
                <button type="button" onClick={() => { setFBranch('all'); setFBatch('all'); setFGender('all') }} className="ml-2 underline hover:text-ink">clear</button>
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-3 py-16 justify-center text-ink-3"><Spinner /> Loading…</div>
          ) : visibleRoster.length === 0 ? (
            <div className="card px-5 py-10 text-center text-[13px] text-ink-3">No boarders match these filters.</div>
          ) : (
            <div className="card divide-y divide-border">
              {visibleRoster.map(st => {
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
                    <div className="flex items-center gap-2">
                      {onLeave && leaveIdByLwsId.has(st.lwsId) && (
                        <button
                          type="button"
                          onClick={() => handleMarkReturned(leaveIdByLwsId.get(st.lwsId))}
                          aria-label={`Mark ${st.name} returned`}
                          className="text-[11px] font-semibold text-accent underline underline-offset-2 min-h-[36px] px-2 hover:text-ink"
                        >returned?</button>
                      )}
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
      ) : view === 'chain' ? (
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
      ) : (
        // ── On Leave (persist-until-return management) ─────────
        <>
          {/* Put students on leave */}
          <div className="mt-4 mb-3">
            {!showAddLeave ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddLeave(true)}
                  className="btn text-[12px] min-h-[40px] px-3 border border-border hover:border-accent hover:text-accent"
                  aria-label="Put students on leave"
                >+ Put on leave</button>
                <button
                  type="button"
                  onClick={handleDownloadReport}
                  disabled={downloadingReport || onLeaveList.length === 0}
                  className="btn text-[12px] min-h-[40px] px-3 border border-border hover:border-accent hover:text-accent"
                  aria-label="Download daily hostel-leave report as PDF"
                >{downloadingReport ? <Spinner size="sm" /> : `⬇ Download report (${onLeaveList.length})`}</button>
              </div>
            ) : (
              <div className="card px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-ink-3">Put on leave — from {date}</div>
                  <button
                    type="button"
                    onClick={() => { setShowAddLeave(false); setAddSel(new Set()); setAddReason(''); setAddQuery('') }}
                    className="text-[12px] text-ink-3 hover:text-ink underline"
                  >cancel</button>
                </div>
                <input
                  type="text"
                  value={addQuery}
                  onChange={e => setAddQuery(e.target.value)}
                  placeholder="Search boarders…"
                  aria-label="Search boarders to put on leave"
                  className="form-input w-full text-[13px] min-h-[44px] px-3 mb-2"
                />
                <div className="space-y-1 max-h-[40vh] overflow-y-auto mb-3">
                  {availableForLeave.length === 0 ? (
                    <div className="text-[12px] text-ink-3 italic py-3 text-center">No boarders match (all shown are already on leave, or filtered out).</div>
                  ) : availableForLeave.map(s => (
                    <label key={s.lwsId} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-surface-2 cursor-pointer min-h-[40px]">
                      <input
                        type="checkbox"
                        checked={addSel.has(s.lwsId)}
                        onChange={() => toggleAddSel(s.lwsId)}
                        className="w-4 h-4"
                        aria-label={s.name}
                      />
                      <span className="text-[13px] text-ink">{s.name}</span>
                    </label>
                  ))}
                </div>
                <input
                  type="text"
                  value={addReason}
                  onChange={e => setAddReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Leave reason"
                  className="form-input w-full text-[13px] min-h-[44px] px-3 mb-3"
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handlePutOnLeave}
                    disabled={addingLeave || addSel.size === 0}
                    className="btn btn-primary min-h-[44px] px-5"
                  >{addingLeave ? <Spinner size="sm" /> : `Put ${addSel.size} on leave`}</button>
                  <span className="text-[12px] text-ink-3">Open-ended — stays on leave until you Mark returned.</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 mb-3 text-[13px] text-ink-2">
            {onLeaveList.length === 0
              ? <span className="text-success font-semibold">✓ No boarders on leave on {date}.</span>
              : <>
                  <span className="font-semibold text-ink">{onLeaveList.length}</span> boarder{onLeaveList.length !== 1 ? 's' : ''} on leave on {date}
                  {staleCount > 0 && <span className="text-danger font-semibold"> · {staleCount} out {STALE_LEAVE_DAYS}+ days — review</span>}
                  <span className="block text-[12px] text-ink-3 mt-1">A leave persists (covering every checkpoint) until you mark the boarder returned. Close stale leaves so they don't mask a real absence.</span>
                </>}
          </div>

          {onLeaveList.length > 0 && (
            <div className="card divide-y divide-border">
              {onLeaveList.map(l => (
                <div key={l.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${l.stale ? 'bg-red-400/5' : ''}`}>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setActiveStudent(l.name)}
                      className="text-[13px] font-medium text-ink text-left hover:text-accent hover:underline"
                    >{l.name}</button>
                    <div className="text-[11px] font-mono text-ink-3 mt-0.5">
                      since {l.fromDmy} · {l.daysOut} day{l.daysOut !== 1 ? 's' : ''} out
                      {l.openEnded ? ' · open-ended' : ''}
                      {l.stale && <span className="ml-1.5 text-danger font-semibold">⚠ stale</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleMarkReturned(l.id)}
                    aria-label={`Mark ${l.name} returned`}
                    className="btn btn-ghost text-[12px] min-h-[40px] px-3 whitespace-nowrap border border-border hover:border-accent hover:text-accent"
                  >Mark returned</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
