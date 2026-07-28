import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { supabase } from '../../lib/supabase'
import { hasHostelAccess, findTeacherByEmail } from '../../lib/teacherDay'
import { buildBoarderRoster } from '../../lib/hostelRoster'
import { resolveOnLeave, CHECKPOINT_LABEL } from '../../lib/analytics/chain'
import { CAPTURE_CHECKPOINTS, ROLL_CHECKPOINTS } from '../../store/slices/checkpointSlice'
import { OPEN_LEAVE_TO_TS } from '../../store/slices/leavesSlice'
import ModalShell from '../Timetable/ModalShell'

// /hostel-mess-attendance — the warden's and mess staff's own capture surface.
//
// The office used to type this second-hand, which is why it never actually
// happened (10 rows, one day, all from a reconciliation script). This puts the
// five checkpoints in front of the people who physically see them.
//
// Dates are DD-MM-YYYY throughout, matching the rest of the hostel subsystem
// (checkpoint_absences / checkpoint_confirmations). Only student_attendance is
// ISO, and this page never reads it.
//
// Access is the `hostelAccess` flag on the teacher record, toggled in
// Settings → Teachers. Reusing role='teacher' rather than minting a new auth
// role is deliberate — see lib/teacherDay.js hasHostelAccess.

// Tap cycle: present → absent → sick → out-pass → present. Mirrors HostelTab.
const STATUS_CYCLE = { undefined: 'absent', absent: 'sick', sick: 'outpass', outpass: undefined }
const STATUS_META = {
  present: { label: 'Present',  cls: 'text-ink-3 border-border' },
  absent:  { label: 'Absent',   cls: 'text-red-400 bg-red-400/10 border-red-400/30' },
  sick:    { label: 'Sick',     cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  outpass: { label: 'Out-pass', cls: 'text-sky-400 bg-sky-400/10 border-sky-400/30' },
}
// "Away" for a roll headcount = physically not in the dorm.
const AWAY_STATUSES = new Set(['absent', 'outpass'])

function todayDmy() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}
function dmyToIso(dmy) {
  const [d, m, y] = String(dmy).split('-')
  return `${y}-${m}-${d}`
}
function isoToDmy(iso) {
  const [y, m, d] = String(iso).split('-')
  return `${d}-${m}-${y}`
}
function dayBoundsIso(dmy) {
  const iso = dmyToIso(dmy)
  return { startIso: `${iso}T00:00:00+05:30`, endIso: `${iso}T23:59:59+05:30` }
}

export default function HostelAttendancePage({ email, initialDate, onLogout }) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const teachers        = useStore(s => s.timetableTeachers)
  const setExceptions   = useStore(s => s.setCheckpointExceptions)
  const getExceptions   = useStore(s => s.getCheckpointExceptionsForDate)
  const confirmRoll     = useStore(s => s.confirmRoll)
  const getActiveLeaves = useStore(s => s.getActiveLeaves)
  const addLeave        = useStore(s => s.addLeave)
  const endLeave        = useStore(s => s.endLeave)

  const [date, setDate]             = useState(initialDate ?? todayDmy())
  const [checkpoint, setCheckpoint] = useState('breakfast')
  const [edits, setEdits]           = useState({})     // lwsId → status (present omitted)
  const [onLeaveIds, setOnLeaveIds] = useState(() => new Set())
  const [leaveRowByLwsId, setLeaveRowByLwsId] = useState({})  // lwsId → { id } for "returned?"
  const [leaveRefresh, setLeaveRefresh] = useState(0)         // bump to reload leaves
  const [leaveForm, setLeaveForm]   = useState(null)   // null = closed; else { lwsId, name, reason }
  const [headcount, setHeadcount]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [banner, setBanner]         = useState(null)

  const staff     = useMemo(() => findTeacherByEmail(teachers, email), [teachers, email])
  const allowed   = useMemo(() => hasHostelAccess(teachers, email), [teachers, email])
  const roster    = useMemo(() => buildBoarderRoster(studentProfiles), [studentProfiles])
  const isRoll    = ROLL_CHECKPOINTS.includes(checkpoint)

  // Seed the grid from what's already saved for this (date, checkpoint).
  useEffect(() => {
    if (!allowed || !date) return
    let cancelled = false
    getExceptions(date).then(rows => {
      if (cancelled) return
      const forCp = {}
      for (const r of rows ?? []) if (r.checkpoint === checkpoint) forCp[r.lws_id] = r.status
      setEdits(forCp)
    })
    return () => { cancelled = true }
  }, [allowed, date, checkpoint, getExceptions])

  // A leave EXPLAINS every checkpoint in its window — the boarder is shown,
  // locked, and never written as an exception row (confirmed 2026-07-27).
  useEffect(() => {
    if (!allowed || !date) return
    let cancelled = false
    const { startIso, endIso } = dayBoundsIso(date)
    getActiveLeaves(startIso, endIso).then(rows => {
      if (cancelled) return
      const ids = resolveOnLeave(
        (rows ?? []).map(r => ({
          lwsId: r.lws_id,
          fromMs: Date.parse(r.from_ts),
          toMs: r.to_ts == null ? null : Date.parse(r.to_ts),
        })),
        Date.parse(startIso), Date.parse(endIso),
      )
      // Keep each on-leave boarder's row id so "returned?" can close THAT leave.
      const byId = {}
      for (const r of rows ?? []) if (ids.has(r.lws_id) && !byId[r.lws_id]) byId[r.lws_id] = { id: r.id }
      setOnLeaveIds(ids)
      setLeaveRowByLwsId(byId)
    })
    return () => { cancelled = true }
  }, [allowed, date, getActiveLeaves, leaveRefresh])

  const exceptions = useMemo(
    () => Object.entries(edits)
      .filter(([lwsId]) => !onLeaveIds.has(lwsId))
      .map(([lwsId, status]) => ({ lwsId, status })),
    [edits, onLeaveIds],
  )
  const awayCount = exceptions.filter(e => AWAY_STATUSES.has(e.status)).length
  const expectedInDorm = roster.length - awayCount

  function cycle(lwsId) {
    if (onLeaveIds.has(lwsId)) return
    setEdits(prev => {
      const next = { ...prev }
      const status = STATUS_CYCLE[prev[lwsId]]
      if (status === undefined) delete next[lwsId]
      else next[lwsId] = status
      return next
    })
  }

  // The warden is the person who physically sees a boarder go and come back, so
  // the leave lifecycle belongs here and not only in the office's board. `leaves`
  // RLS is `authenticated`, so this needed no policy change — it was a UI gap.
  //
  // Revoking a leave outright (deleteLeave) is deliberately NOT offered: that
  // erases the record rather than recording a return, and it's office judgement.

  // The boarder is back. Stamp to_ts to the END of the PREVIOUS day so the
  // selected date itself is no longer a leave day and unlocks for marking.
  async function handleMarkReturned(lwsId, name) {
    const row = leaveRowByLwsId[lwsId]
    if (!row?.id) return
    const { startIso } = dayBoundsIso(date)
    const ok = await endLeave(row.id, new Date(Date.parse(startIso) - 1).toISOString())
    setBanner(ok
      ? { type: 'ok', msg: `${name} marked returned — markable from ${date}.` }
      : { type: 'err', msg: 'Could not close the leave — check your connection.' })
    if (ok) setLeaveRefresh(n => n + 1)
  }

  // Open-ended by default (the 2099 sentinel, never NULL — see leavesSlice).
  // No end-date picker on purpose: "out until they're back" is the model that
  // works, and a date typed in a hurry silently stops explaining checkpoints.
  async function handlePutOnLeave() {
    if (!leaveForm?.lwsId) return
    setSaving(true)
    const ok = await addLeave({
      lwsId: leaveForm.lwsId,
      fromTs: dayBoundsIso(date).startIso,
      toTs: OPEN_LEAVE_TO_TS,
      reason: leaveForm.reason.trim() || null,
    })
    setSaving(false)
    setBanner(ok
      ? { type: 'ok', msg: `${leaveForm.name} on leave from ${date} — tap "returned?" when back.` }
      : { type: 'err', msg: 'Could not record the leave — check your connection.' })
    if (ok) { setLeaveForm(null); setLeaveRefresh(n => n + 1) }
  }

  async function handleSave() {
    setSaving(true)
    setBanner(null)
    const ok = await setExceptions(date, checkpoint, exceptions)
    setSaving(false)
    setBanner(ok
      ? { type: 'ok', msg: `Saved ${CHECKPOINT_LABEL[checkpoint]} — ${exceptions.length} exception${exceptions.length !== 1 ? 's' : ''}.` }
      : { type: 'err', msg: 'Save failed — check your connection and try again.' })
  }

  async function handleConfirmRoll() {
    const present = Number(headcount)
    if (!Number.isInteger(present) || present < 0) {
      setBanner({ type: 'err', msg: 'Enter the physical headcount to reconcile.' })
      return
    }
    setSaving(true)
    const ok = await confirmRoll(date, checkpoint, {
      expectedCount: roster.length, exceptionCount: awayCount, confirmedPresent: present,
    })
    setSaving(false)
    if (!ok) { setBanner({ type: 'err', msg: 'Could not record the roll.' }); return }
    setBanner(present === expectedInDorm
      ? { type: 'ok',  msg: `${CHECKPOINT_LABEL[checkpoint]} reconciled ✓ (${present} in dorm).` }
      : { type: 'err', msg: `⚠ Headcount ${present} ≠ expected ${expectedInDorm}. Logged as an OPEN incident — tell the warden.` })
  }

  const identity = (
    <div className="text-[12px] text-ink-3 mt-0.5">
      Signed in as <span className="font-semibold text-ink-2">{staff?.name || email || 'unknown'}</span>
      {' · '}
      {/* Unconditional: on a shared device this is what keeps created_by honest. */}
      <button
        type="button"
        onClick={() => (onLogout ? onLogout() : supabase?.auth.signOut())}
        className="underline text-ink-3 hover:text-accent focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
        aria-label="Not you? Sign out"
      >Not you?</button>
    </div>
  )

  if (!allowed) {
    return (
      <div className="min-h-screen bg-bg px-4 py-5 max-w-2xl mx-auto">
        <h1 className="text-[19px] font-extrabold text-ink tracking-tight">Hostel &amp; mess attendance</h1>
        {identity}
        <div className="card px-5 py-6 text-center mt-4">
          <div className="text-[15px] font-semibold text-ink mb-1">No access</div>
          <p className="text-[13px] text-ink-3">
            You <strong>don't have access</strong> to hostel &amp; mess attendance. Ask the office to
            enable it for <span className="font-mono">{email || 'your account'}</span> under
            Settings → Teachers.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-5 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[19px] font-extrabold text-ink tracking-tight">Hostel &amp; mess attendance</h1>
          {identity}
        </div>
        <label className="flex flex-col gap-1 shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Date</span>
          <input
            type="date"
            value={dmyToIso(date)}
            onChange={e => e.target.value && setDate(isoToDmy(e.target.value))}
            aria-label="Date"
            className="form-input text-[13px] min-h-[44px] px-2"
          />
        </label>
      </div>

      {/* Checkpoint picker */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {CAPTURE_CHECKPOINTS.map(cp => (
          <button
            key={cp}
            type="button"
            onClick={() => setCheckpoint(cp)}
            aria-pressed={checkpoint === cp}
            className={`text-[12px] px-3 py-2 rounded-full border min-h-[44px] ${
              checkpoint === cp
                ? 'border-accent text-accent bg-accent-soft/40 font-semibold'
                : 'border-border text-ink-3 hover:text-ink'}`}
          >
            {CHECKPOINT_LABEL[cp]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap text-[12px]">
        <span className="card px-3 py-1.5">Boarders <b className="text-ink">{roster.length}</b></span>
        <span className="card px-3 py-1.5">Exceptions <b className="text-red-400">{exceptions.length}</b></span>
        {onLeaveIds.size > 0 && (
          <span className="card px-3 py-1.5">On leave <b className="text-purple-400">{onLeaveIds.size}</b></span>
        )}
      </div>

      <p className="text-[11px] text-ink-3 mb-3">
        Everyone counts as present — tap only the boarders who aren't there. Tap again to change
        the reason. Save even when nobody is missing, so the office knows this checkpoint was done.
      </p>

      {roster.length === 0 ? (
        <div className="card px-5 py-6 text-center text-[13px] text-ink-3">No boarders on the roster.</div>
      ) : (
        <div className="space-y-1">
          {roster.map(s => {
            const locked = onLeaveIds.has(s.lwsId)
            const status = locked ? 'leave' : (edits[s.lwsId] || 'present')
            const meta = STATUS_META[status] || STATUS_META.present
            return (
              <div key={s.lwsId} className="flex items-center gap-3 px-1 py-1.5 border-b border-border">
                <span className="text-[14px] text-ink flex-1 min-w-0 truncate">{s.name}</span>
                {locked ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleMarkReturned(s.lwsId, s.name)}
                      aria-label={`${s.name} returned — close leave`}
                      className="text-[11px] font-semibold underline text-ink-3 hover:text-accent
                                 min-h-[44px] px-2 rounded shrink-0
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >returned?</button>
                    <button
                      type="button"
                      disabled
                      aria-label={`Mark ${s.name} (on leave)`}
                      className="text-[11px] font-semibold px-3 py-2 rounded-lg border min-h-[44px]
                                 text-purple-400 bg-purple-400/10 border-purple-400/30 opacity-80"
                    >On leave</button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setLeaveForm({ lwsId: s.lwsId, name: s.name, reason: '' })}
                      aria-label={`Put ${s.name} on leave`}
                      className="text-[11px] font-semibold text-ink-3 hover:text-purple-400
                                 min-h-[44px] px-2 rounded shrink-0
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >leave</button>
                    <button
                      type="button"
                      onClick={() => cycle(s.lwsId)}
                      aria-label={`Mark ${s.name}`}
                      className={`text-[11px] font-semibold px-3 py-2 rounded-lg border min-h-[44px] ${meta.cls}`}
                    >{meta.label}</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Roll reconciliation — rolls only; meals are exception-only */}
      {isRoll && (
        <div className="card px-4 py-3 mt-4">
          <div className="text-[12px] text-ink-2 mb-2">
            Expected in dorm: <b>{expectedInDorm}</b> ({roster.length} boarders − {awayCount} away)
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Headcount</span>
              <input
                type="number"
                min={0}
                value={headcount}
                onChange={e => setHeadcount(e.target.value)}
                aria-label="Physical headcount"
                className="form-input text-[13px] min-h-[44px] px-3 w-28"
              />
            </label>
            <button
              type="button"
              onClick={handleConfirmRoll}
              disabled={saving}
              className="btn text-[13px] min-h-[44px] px-4 disabled:opacity-40"
            >Confirm roll</button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 bg-bg pt-3 pb-2 mt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary w-full text-[14px] min-h-[48px] disabled:opacity-40"
        >
          {saving ? 'Saving…' : `Save ${CHECKPOINT_LABEL[checkpoint]} (${exceptions.length})`}
        </button>
        {banner && (
          <div className={`mt-2 text-[12px] ${banner.type === 'ok' ? 'text-success' : 'text-red-400'}`}>
            {banner.msg}
          </div>
        )}
      </div>

      {leaveForm && (
        <ModalShell
          title={`Put ${leaveForm.name} on leave`}
          onClose={() => setLeaveForm(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeaveForm(null)}
                className="btn text-[13px] min-h-[44px] px-4"
              >Cancel</button>
              <button
                type="button"
                onClick={handlePutOnLeave}
                disabled={saving}
                className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40"
              >Put on leave</button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-2">
            From <b>{date}</b>, open-ended — {leaveForm.name} stays on leave, explaining every
            checkpoint, until you tap <b>returned?</b> on their row.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Reason (optional)</span>
            <input
              type="text"
              value={leaveForm.reason}
              onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. home visit, medical"
              aria-label="Reason (optional)"
              className="form-input text-[13px] min-h-[44px] px-3"
            />
          </label>
        </ModalShell>
      )}
    </div>
  )
}
