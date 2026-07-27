import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { supabase } from '../../lib/supabase'
import { findTeacherByEmail, getTeacherLecturesForDate, withFilingStatus } from '../../lib/teacherDay'
import { buildOfflineRoster } from '../../lib/offlineRoster'
import { resolveOnLeave } from '../../lib/analytics/chain'
import MarkAbsenteesModal from '../Attendance/MarkAbsenteesModal'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

// /school-attendance — the teacher's own day. Distinct from the hostel & mess
// attendance surface (APJ boarders), hence "school".
//
// Teachers file their OWN periods here instead of the office doing it centrally.
// Two writes per period, in order: the absentee set (lecture_absences) and then
// the filing record (lecture_submissions). The filing is what separates "all
// present" from "never filed" — see src/lib/teacherDay.js withFilingStatus.
//
// Capture only: sending anything to parents stays on the admin side, so no
// send-history (a persisted store key, and therefore a whole-blob faculty_state
// write) is ever touched from a teacher client.
export default function SchoolAttendancePage({ email, initialDate, onLogout }) {
  const studentProfiles     = useStore(s => s.studentProfiles)
  const timetables          = useStore(s => s.timetables)
  const mappings            = useStore(s => s.timetableMappings)
  const teachers            = useStore(s => s.timetableTeachers)
  const setForPeriod        = useStore(s => s.setLectureAbsenteesForPeriod)
  const getAbsencesForDate  = useStore(s => s.getLectureAbsencesForDate)
  const submitLecture       = useStore(s => s.submitLecture)
  const getSubmissions      = useStore(s => s.getSubmissionsForDate)
  const getActiveLeaves     = useStore(s => s.getActiveLeaves)
  const endLeave            = useStore(s => s.endLeave)

  const [date, setDate] = useState(initialDate ?? todayIso())
  const [absencesBySlot, setAbsencesBySlot] = useState({})   // `${slotId}|${batch}` → [lwsId]
  const [submissions, setSubmissions] = useState([])
  const [modalLecture, setModalLecture] = useState(null)
  const [saving, setSaving] = useState(false)
  const [onLeaveIds, setOnLeaveIds] = useState(() => new Set())
  const [leaveRowByLwsId, setLeaveRowByLwsId] = useState({})
  const [refresh, setRefresh] = useState(0)

  const teacher = useMemo(() => findTeacherByEmail(teachers, email), [teachers, email])

  const lectures = useMemo(
    () => getTeacherLecturesForDate({ teacherId: teacher?.id, timetables, mappings, date }),
    [teacher, timetables, mappings, date],
  )

  const lecturesWithStatus = useMemo(
    () => withFilingStatus(lectures, submissions),
    [lectures, submissions],
  )

  // Load the day's absentee rows + filings together so the cards render one
  // consistent picture. Keyed by (slotId|batch): slot ids are per-timetable.
  useEffect(() => {
    if (!date || !teacher) {
      setAbsencesBySlot({}); setSubmissions([])
      return
    }
    let cancelled = false
    Promise.all([getAbsencesForDate(date), getSubmissions(date)]).then(([rows, subs]) => {
      if (cancelled) return
      const grouped = {}
      for (const r of rows ?? []) {
        if (!r.slot_id) continue
        if (!grouped[r.slot_id]) grouped[r.slot_id] = []
        grouped[r.slot_id].push(r.lws_id)
      }
      setAbsencesBySlot(grouped)
      setSubmissions(subs ?? [])
    })
    return () => { cancelled = true }
  }, [date, teacher, getAbsencesForDate, getSubmissions, refresh])

  // Active leaves for the day (hostel scope). Empty for non-hostel branches, in
  // which case the modal is a plain present/absent toggle with nothing locked.
  useEffect(() => {
    if (!date) return
    let cancelled = false
    const dayStartIso = `${date}T00:00:00+05:30`
    const dayEndIso   = `${date}T23:59:59+05:30`
    getActiveLeaves(dayStartIso, dayEndIso).then(rows => {
      if (cancelled) return
      const ids = resolveOnLeave(
        (rows ?? []).map(r => ({
          lwsId: r.lws_id,
          fromMs: Date.parse(r.from_ts),
          toMs: r.to_ts == null ? null : Date.parse(r.to_ts),
        })),
        Date.parse(dayStartIso), Date.parse(dayEndIso),
      )
      const byId = {}
      for (const r of rows ?? []) if (ids.has(r.lws_id) && !byId[r.lws_id]) byId[r.lws_id] = { id: r.id }
      setOnLeaveIds(ids)
      setLeaveRowByLwsId(byId)
    })
    return () => { cancelled = true }
  }, [date, getActiveLeaves, refresh])

  // Roster for the open period's batch. buildOfflineRoster is the shared
  // "current members of these batches" helper — it also drops Block/Quit/
  // Inactive students so they can't surface as phantom absentees.
  const roster = useMemo(
    () => (modalLecture ? buildOfflineRoster(studentProfiles, [modalLecture.batchName]) : []),
    [studentProfiles, modalLecture],
  )

  async function handleMarkReturned(lwsId) {
    const row = leaveRowByLwsId[lwsId]
    if (!row?.id) return
    const prevEnd = new Date(`${date}T00:00:00+05:30`)
    prevEnd.setMilliseconds(prevEnd.getMilliseconds() - 1)
    if (await endLeave(row.id, prevEnd.toISOString())) setRefresh(n => n + 1)
  }

  // Absentees first, filing second — and only if the first succeeded. A filing
  // written over a failed absentee write would claim the period is accounted
  // for when its absentees were never saved.
  async function handleSave(lwsIds) {
    const lec = modalLecture
    if (!lec) return
    setSaving(true)
    try {
      const ok = await setForPeriod(date, lec.slotId, lec.subject, lwsIds)
      if (!ok) return
      setAbsencesBySlot(prev => ({ ...prev, [lec.slotId]: lwsIds }))
      await submitLecture({
        date,
        slotId: lec.slotId,
        batchName: lec.batchName,
        subject: lec.subject,
        teacherId: teacher?.id ?? null,
        absentCount: lwsIds.length,
        source: 'teacher',
      })
      setRefresh(n => n + 1)
    } finally {
      setSaving(false)
    }
  }

  const filedCount = lecturesWithStatus.filter(l => l.filed).length

  return (
    <div className="min-h-screen bg-bg px-4 py-5 max-w-2xl mx-auto">
      {/* Identity — load-bearing on a shared staffroom device */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[19px] font-extrabold text-ink tracking-tight">School attendance</h1>
          <div className="text-[12px] text-ink-3 mt-0.5">
            {teacher
              ? <>Signed in as <span className="font-semibold text-ink-2">{teacher.name}</span></>
              : <>Signed in as <span className="font-semibold text-ink-2">{email || 'unknown'}</span></>}
            {' · '}
            {/* Never render this conditionally on the prop — on a shared device
                the escape hatch IS the protection for created_by, so it falls
                back to a plain sign-out rather than vanishing at a call site
                that forgot to pass a handler. */}
            <button
              type="button"
              onClick={() => (onLogout ? onLogout() : supabase?.auth.signOut())}
              className="underline text-ink-3 hover:text-accent focus:outline-none
                         focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
              aria-label="Not you? Sign out"
            >Not you?</button>
          </div>
        </div>
        <label className="flex flex-col gap-1 shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Date</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            aria-label="Date"
            className="form-input text-[13px] min-h-[44px] px-2"
          />
        </label>
      </div>

      {!teacher ? (
        <div className="card px-5 py-6 text-center">
          <div className="text-[15px] font-semibold text-ink mb-1">No lectures to show</div>
          <p className="text-[13px] text-ink-3">
            This login is <strong>not linked to a teacher record</strong>, so we can't tell which
            periods are yours. Ask the office to add <span className="font-mono">{email || 'your email'}</span> to
            your teacher entry under Settings → Teachers.
          </p>
        </div>
      ) : lecturesWithStatus.length === 0 ? (
        <div className="card px-5 py-6 text-center">
          <div className="text-[15px] font-semibold text-ink mb-1">Nothing timetabled</div>
          <p className="text-[13px] text-ink-3">
            You have no scheduled periods on {fmtDay(date)}.
          </p>
        </div>
      ) : (
        <>
          <div className="text-[12px] text-ink-3 mb-3">
            {fmtDay(date)} · <span className="font-semibold text-ink-2">{filedCount}/{lecturesWithStatus.length}</span> filed
          </div>

          <div className="space-y-3">
            {lecturesWithStatus.map(lec => (
              <div key={`${lec.slotId}|${lec.batchName}`} className="card px-4 py-3.5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-ink truncate">{lec.subject}</div>
                    <div className="text-[12px] text-ink-3 truncate">{lec.batchName}</div>
                    <div className="text-[11px] font-mono text-ink-3 mt-0.5">
                      {lec.startTime} – {lec.endTime}
                    </div>
                  </div>
                  {lec.filed ? (
                    <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-success
                                     border border-success/30 bg-success/10 rounded-full px-2 py-1">
                      Filed
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-yellow-400
                                     border border-yellow-400/30 bg-yellow-400/10 rounded-full px-2 py-1">
                      Not filed
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-mono text-ink-3">
                    {lec.filed
                      ? <>{lec.absentCount} absent{lec.submittedAt ? ` · ${fmtTime(lec.submittedAt)}` : ''}</>
                      : 'Not recorded yet'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalLecture(lec)}
                    className={`btn text-[13px] min-h-[44px] px-4 ${lec.filed ? '' : 'btn-primary'}`}
                    aria-label={`Mark attendance for ${lec.subject} ${lec.batchName} ${lec.startTime}`}
                  >
                    {lec.filed ? 'Edit' : 'Mark attendance'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-ink-3 mt-5 leading-relaxed">
            File every period, including the ones where everybody turned up — a period with no
            entry is counted as outstanding, not as full attendance.
          </p>
        </>
      )}

      <MarkAbsenteesModal
        open={modalLecture !== null && !saving}
        date={date}
        subject={modalLecture ? `${modalLecture.subject} · ${modalLecture.batchName}` : ''}
        studentsInBatch={roster}
        initialAbsentees={modalLecture ? (absencesBySlot[modalLecture.slotId] || []) : []}
        onLeaveIds={onLeaveIds}
        onMarkReturned={handleMarkReturned}
        onSave={handleSave}
        onClose={() => setModalLecture(null)}
      />
    </div>
  )
}
