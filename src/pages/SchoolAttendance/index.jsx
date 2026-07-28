import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { supabase } from '../../lib/supabase'
import { findTeacherByEmail, getTeacherLecturesForDate, withFilingStatus, getTeacherBatches } from '../../lib/teacherDay'
import { buildOfflineRoster } from '../../lib/offlineRoster'
import { resolveOnLeave } from '../../lib/analytics/chain'
import MarkAbsenteesModal from '../Attendance/MarkAbsenteesModal'
import MarkDefaultersModal from '../Attendance/MarkDefaultersModal'
import ModalShell from '../Timetable/ModalShell'
import { deriveHomeworkType, homeworkTypeLabel } from '../../lib/homework'

// Impromptu (substitute / extra) lectures have no timetable slot, so we mint a
// synthetic id. The `adhoc_` prefix distinguishes them from timetable slots
// (`slot_*`) on reconstruction — same scheme as the admin Lecture log.
let _adhocSeq = 0
const mintAdhocId = () => `adhoc_${Date.now().toString(36)}_${(++_adhocSeq).toString(36)}`

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
  const setHomeworkDefaulters = useStore(s => s.setHomeworkDefaultersForItem)
  const getHomeworkForDate  = useStore(s => s.getHomeworkForDate)

  const [date, setDate] = useState(initialDate ?? todayIso())
  const [absencesBySlot, setAbsencesBySlot] = useState({})   // `${slotId}|${batch}` → [lwsId]
  const [submissions, setSubmissions] = useState([])
  const [modalLecture, setModalLecture] = useState(null)
  const [saving, setSaving] = useState(false)
  const [onLeaveIds, setOnLeaveIds] = useState(() => new Set())
  const [leaveRowByLwsId, setLeaveRowByLwsId] = useState({})
  const [refresh, setRefresh] = useState(0)
  // Impromptu cards created in this session but not yet saved. Once saved they
  // arrive back as lecture_submissions rows and are reconstructed from those.
  const [pendingAdhoc, setPendingAdhoc] = useState([])
  const [adhocForm, setAdhocForm] = useState(null)   // null = closed
  // Homework filing is two steps: name the item (chapter + what was set), then
  // tick who hasn't done it. `hwForm` is step 1, `hwItem` is step 2.
  const [hwForm, setHwForm] = useState(null)
  const [hwItem, setHwItem] = useState(null)
  const [homeworkRows, setHomeworkRows] = useState([])
  // Raw absence rows, kept so an ad-hoc card can recover the time it was given
  // (lecture_submissions has no time columns; lecture_absences does).
  const [absenceRows, setAbsenceRows] = useState([])

  const teacher = useMemo(() => findTeacherByEmail(teachers, email), [teachers, email])

  const timetabled = useMemo(
    () => getTeacherLecturesForDate({ teacherId: teacher?.id, timetables, mappings, date }),
    [teacher, timetables, mappings, date],
  )

  // Batches this teacher could hold an extra class for.
  const teacherBatches = useMemo(
    () => getTeacherBatches({ teacherId: teacher?.id, timetables, mappings }),
    [teacher, timetables, mappings],
  )

  // Impromptu lectures already filed today, rebuilt from the teacher's own
  // submissions. lecture_submissions is the right source here rather than
  // lecture_absences: it carries batch_name, and it exists even when nobody
  // was absent — which is exactly the case the absence log cannot express.
  const savedAdhoc = useMemo(() => {
    const timeBySlot = {}
    for (const r of absenceRows) {
      if (r.slot_id?.startsWith('adhoc_') && !timeBySlot[r.slot_id]) {
        timeBySlot[r.slot_id] = { startTime: r.start_time ?? null, endTime: r.end_time ?? null }
      }
    }
    return (submissions ?? [])
      .filter(s => s.slot_id?.startsWith('adhoc_') && s.teacher_id === teacher?.id)
      .map(s => ({
        slotId: s.slot_id,
        batchName: s.batch_name,
        subject: s.subject,
        adhoc: true,
        startTime: timeBySlot[s.slot_id]?.startTime ?? null,
        endTime: timeBySlot[s.slot_id]?.endTime ?? null,
      }))
  }, [submissions, absenceRows, teacher])

  const lectures = useMemo(() => {
    const savedIds = new Set(savedAdhoc.map(a => a.slotId))
    return [...timetabled, ...savedAdhoc, ...pendingAdhoc.filter(a => !savedIds.has(a.slotId))]
  }, [timetabled, savedAdhoc, pendingAdhoc])

  const lecturesWithStatus = useMemo(
    () => withFilingStatus(lectures, submissions),
    [lectures, submissions],
  )

  // Load the day's absentee rows + filings together so the cards render one
  // consistent picture. Keyed by (slotId|batch): slot ids are per-timetable.
  useEffect(() => {
    if (!date || !teacher) {
      setAbsencesBySlot({}); setSubmissions([]); setAbsenceRows([])
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
      setAbsenceRows(rows ?? [])
      setSubmissions(subs ?? [])
    })
    getHomeworkForDate(date).then(rows => { if (!cancelled) setHomeworkRows(rows ?? []) })
    return () => { cancelled = true }
  }, [date, teacher, getAbsencesForDate, getSubmissions, getHomeworkForDate, refresh])

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

  // Roster for the homework item's batch (same helper, different open modal).
  const hwRoster = useMemo(
    () => (hwItem ? buildOfflineRoster(studentProfiles, [hwItem.batchName]) : []),
    [studentProfiles, hwItem],
  )

  // Students already flagged for this exact item, so re-opening the modal shows
  // the current set rather than an empty one.
  const hwInitial = useMemo(() => {
    if (!hwItem) return []
    const inBatch = new Set(hwRoster.map(s => s.lwsId))
    return homeworkRows
      .filter(r => r.subject === hwItem.subject && r.chapter === hwItem.chapter
        && r.type === hwItem.type && inBatch.has(r.lws_id))
      .map(r => r.lws_id)
  }, [homeworkRows, hwItem, hwRoster])

  // How many open homework items this teacher has filed per period today.
  const hwCountBySubjectBatch = useMemo(() => {
    const counts = {}
    const rosterCache = {}
    for (const r of homeworkRows) {
      for (const lec of lectures) {
        if (lec.subject !== r.subject) continue
        const key = `${lec.subject}|${lec.batchName}`
        if (!rosterCache[key]) {
          rosterCache[key] = new Set(buildOfflineRoster(studentProfiles, [lec.batchName]).map(s => s.lwsId))
        }
        if (!rosterCache[key].has(r.lws_id)) continue
        counts[key] = (counts[key] ?? 0) + 1
      }
    }
    return counts
  }, [homeworkRows, lectures, studentProfiles])

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
      // Ad-hoc periods persist their entered time on the rows — there's no
      // timetable slot to re-derive it from later.
      const ok = lec.adhoc
        ? await setForPeriod(date, lec.slotId, lec.subject, lwsIds,
            { startTime: lec.startTime ?? null, endTime: lec.endTime ?? null })
        : await setForPeriod(date, lec.slotId, lec.subject, lwsIds)
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

  // Step 1 → step 2: name the item, then tick who hasn't done it.
  function openHomeworkDefaulters() {
    const chapter = (hwForm?.chapter || '').trim()
    const type = deriveHomeworkType(hwForm?.hw, hwForm?.notes)
    if (!chapter || !type) return
    setHwItem({ subject: hwForm.subject, batchName: hwForm.batchName, chapter, type })
    setHwForm(null)
  }

  // The teacher who set the work is the only person who knows who didn't do it —
  // the same argument that moved attendance filing off the office's desk.
  // Capture only: the parent send stays admin-side (send-homework-pending 403s
  // role='teacher'), so no send-history is ever touched from here.
  async function handleSaveHomework(lwsIds) {
    if (!hwItem) return
    const ok = await setHomeworkDefaulters(date, hwItem.subject, hwItem.chapter, hwItem.type, lwsIds)
    setHwItem(null)
    if (ok) setRefresh(n => n + 1)
  }

  // An extra / substitute class isn't in the timetable, so nothing else in the
  // system knows it happened — the admin filing board is timetable-derived and
  // will never list it. The teacher is the only person who can record it.
  function addAdhocLecture() {
    const subject = (adhocForm?.subject || '').trim()
    const batchName = adhocForm?.batchName || ''
    if (!subject || !batchName) return
    setPendingAdhoc(prev => [...prev, {
      slotId: mintAdhocId(),
      batchName,
      subject,
      adhoc: true,
      startTime: (adhocForm.start || '').trim() || null,
      endTime:   (adhocForm.end || '').trim() || null,
    }])
    setAdhocForm(null)
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
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="text-[12px] text-ink-3">
              {fmtDay(date)}
              {lecturesWithStatus.length > 0 && (
                <> · <span className="font-semibold text-ink-2">{filedCount}/{lecturesWithStatus.length}</span> filed</>
              )}
            </div>
            {/* Available even with nothing timetabled — a Sunday revision class
                is exactly the case nothing else in the system can record. */}
            <button
              type="button"
              onClick={() => setAdhocForm({ batchName: teacherBatches[0] ?? '', subject: '', start: '', end: '' })}
              disabled={teacherBatches.length === 0}
              className="btn text-[12px] min-h-[44px] px-3 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Add an extra class"
            >
              + Extra class
            </button>
          </div>

          {lecturesWithStatus.length === 0 && (
            <div className="card px-5 py-6 text-center">
              <div className="text-[15px] font-semibold text-ink mb-1">Nothing timetabled</div>
              <p className="text-[13px] text-ink-3">
                You have no scheduled periods on {fmtDay(date)}. If you took an extra class,
                add it above.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {lecturesWithStatus.map(lec => (
              <div key={`${lec.slotId}|${lec.batchName}`} className="card px-4 py-3.5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-ink truncate">
                      {lec.subject}
                      {lec.adhoc && (
                        <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-ink-3
                                         border border-border rounded-full px-2 py-0.5 align-middle">extra</span>
                      )}
                    </div>
                    <div className="text-[12px] text-ink-3 truncate">{lec.batchName}</div>
                    <div className="text-[11px] font-mono text-ink-3 mt-0.5">
                      {lec.startTime && lec.endTime
                        ? `${lec.startTime} – ${lec.endTime}`
                        : lec.adhoc ? 'Extra class' : `${lec.startTime ?? ''} – ${lec.endTime ?? ''}`}
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
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setHwForm({
                        subject: lec.subject, batchName: lec.batchName, chapter: '', hw: true, notes: false,
                      })}
                      className="btn text-[13px] min-h-[44px] px-3"
                      aria-label={`Homework for ${lec.subject} ${lec.batchName}`}
                    >
                      Homework
                      {hwCountBySubjectBatch[`${lec.subject}|${lec.batchName}`] > 0 && (
                        <span className="ml-1.5 text-red-400 font-mono">
                          {hwCountBySubjectBatch[`${lec.subject}|${lec.batchName}`]}
                        </span>
                      )}
                    </button>
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

      {hwForm && (
        <ModalShell
          title={`Homework — ${hwForm.subject} · ${hwForm.batchName}`}
          onClose={() => setHwForm(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHwForm(null)}
                className="btn text-[13px] min-h-[44px] px-4"
              >Cancel</button>
              <button
                type="button"
                onClick={openHomeworkDefaulters}
                disabled={!hwForm.chapter.trim() || !deriveHomeworkType(hwForm.hw, hwForm.notes)}
                className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >Next — who hasn't done it</button>
            </div>
          }
        >
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Chapter / topic</span>
            <input
              type="text"
              value={hwForm.chapter}
              onChange={e => setHwForm(f => ({ ...f, chapter: e.target.value }))}
              placeholder="e.g. Trigonometry"
              aria-label="Chapter or topic"
              className="form-input text-[13px] min-h-[44px] px-3"
            />
          </label>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={hwForm.hw}
                onChange={e => setHwForm(f => ({ ...f, hw: e.target.checked }))}
                className="w-4 h-4"
                aria-label="Homework"
              />
              Homework
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={hwForm.notes}
                onChange={e => setHwForm(f => ({ ...f, notes: e.target.checked }))}
                className="w-4 h-4"
                aria-label="Notes"
              />
              Notes
            </label>
          </div>
          <p className="text-[11px] text-ink-3">
            Filing this records who hasn't completed it. The office sends any message to
            parents — nothing goes out from here.
          </p>
        </ModalShell>
      )}

      <MarkDefaultersModal
        open={hwItem !== null}
        subject={hwItem ? `${hwItem.subject} · ${hwItem.batchName}` : ''}
        chapter={hwItem ? `${hwItem.chapter} (${homeworkTypeLabel(hwItem.type)})` : ''}
        studentsInBatch={hwRoster}
        initialDefaulters={hwInitial}
        onSave={handleSaveHomework}
        onClose={() => setHwItem(null)}
      />

      {adhocForm && (
        <ModalShell
          title="Add an extra class"
          onClose={() => setAdhocForm(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdhocForm(null)}
                className="btn text-[13px] min-h-[44px] px-4"
              >Cancel</button>
              <button
                type="button"
                onClick={addAdhocLecture}
                disabled={!adhocForm.subject.trim() || !adhocForm.batchName}
                className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >Add class</button>
            </div>
          }
        >
          <p className="text-[12px] text-ink-3">
            For a class that isn't on the timetable — a substitute, a doubt session, extra
            revision. It won't appear anywhere until you file its attendance.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Batch</span>
            <select
              value={adhocForm.batchName}
              onChange={e => setAdhocForm(f => ({ ...f, batchName: e.target.value }))}
              aria-label="Batch"
              className="form-input text-[13px] min-h-[44px] px-3"
            >
              {teacherBatches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Subject</span>
            <input
              type="text"
              value={adhocForm.subject}
              onChange={e => setAdhocForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="e.g. Extra Maths revision"
              aria-label="Subject"
              className="form-input text-[13px] min-h-[44px] px-3"
            />
          </label>
          <div className="flex gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Start (optional)</span>
              <input
                type="text"
                value={adhocForm.start}
                onChange={e => setAdhocForm(f => ({ ...f, start: e.target.value }))}
                placeholder="3:00 PM"
                aria-label="Start time"
                className="form-input text-[13px] min-h-[44px] px-3 w-32"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">End (optional)</span>
              <input
                type="text"
                value={adhocForm.end}
                onChange={e => setAdhocForm(f => ({ ...f, end: e.target.value }))}
                placeholder="4:00 PM"
                aria-label="End time"
                className="form-input text-[13px] min-h-[44px] px-3 w-32"
              />
            </label>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
