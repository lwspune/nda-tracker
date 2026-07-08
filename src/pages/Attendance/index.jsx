import { useState, useEffect, useRef, useMemo } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { supabase } from '../../lib/supabase'
import { parseAttendanceExcel } from '../../lib/excel'
import { homeworkNotifyKey } from '../../lib/homework'
import { EmptyState, PageHeader, Spinner, Alert } from '../../components/ui'
import { buildConsecutiveAbsent } from './consecutiveAbsent'
import LateMarkingWidget from './LateMarkingWidget'
import LectureLogTab from './LectureLogTab'
import HomeworkLogTab from './HomeworkLogTab'
import HostelTab from './HostelTab'
import LateNotificationPreviewModal from './LateNotificationPreviewModal'
import LectureMissPreviewModal from './LectureMissPreviewModal'
import HomeworkPreviewModal from './HomeworkPreviewModal'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// ── helpers ──────────────────────────────────────────────────

function pctColor(pct) {
  if (pct < 75)  return 'text-red-400'
  if (pct < 85)  return 'text-yellow-400'
  return 'text-green-400'
}

function pctBg(pct) {
  if (pct < 75)  return 'bg-red-400/10 border-red-400/20'
  if (pct < 85)  return 'bg-yellow-400/10 border-yellow-400/20'
  return 'bg-green-400/10 border-green-400/20'
}

function buildStudentStats(records, lwsIdToName) {
  const byLwsId = {}
  for (const r of records) {
    if (!byLwsId[r.lws_id]) byLwsId[r.lws_id] = { p: 0, a: 0 }
    if (r.status === 'P') byLwsId[r.lws_id].p++
    else if (r.status === 'A') byLwsId[r.lws_id].a++
  }
  return Object.entries(byLwsId)
    .map(([lwsId, { p, a }]) => {
      const total = p + a
      return {
        lwsId,
        name: lwsIdToName[lwsId] || lwsId,
        p, a,
        pct: total > 0 ? Math.round((p / total) * 100) : 0,
        total,
      }
    })
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name))
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-')
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── page ─────────────────────────────────────────────────────

// Extract names that failed or were skipped from the endpoint's log lines.
// Lines come in formats:
//   "  FAIL → Name (student → 9123…): error"
//   "  FAIL → Name (parent → 9123…): error"
//   "  SKIP Name — no mobile"
//   "  SKIP Name parent 9123 — unrecognised format"
// Format owned by api/send-late-notifications.js; keep this in sync if that
// log shape ever changes.
export function parseFailedNames(lines) {
  if (!Array.isArray(lines)) return []
  const out = new Set()
  for (const raw of lines) {
    const line = String(raw)
    let m = line.match(/^\s*FAIL → (.+?) \((?:student|parent)/)
    if (m) { out.add(m[1].trim()); continue }
    m = line.match(/^\s*SKIP (.+?) (?:—|parent )/)
    if (m) { out.add(m[1].trim()); continue }
  }
  return [...out]
}

export default function AttendancePage() {
  const studentProfiles  = useStore(s => s.studentProfiles)
  const importAttendance = useStore(s => s.importAttendance)
  const setActiveStudent = useStore(s => s.setActiveStudent)
  const lateSendHistory  = useStore(s => s.lateSendHistory)
  const setLateSendHistory = useStore(s => s.setLateSendHistory)
  const lectureMissSendHistory  = useStore(s => s.lectureMissSendHistory)
  const setLectureMissSendHistory = useStore(s => s.setLectureMissSendHistory)
  const homeworkSendHistory     = useStore(s => s.homeworkSendHistory)
  const setHomeworkSendHistory  = useStore(s => s.setHomeworkSendHistory)
  const markHomeworkNotified    = useStore(s => s.markHomeworkNotified)
  const getHomeworkForDate      = useStore(s => s.getHomeworkForDate)
  const mode = useMode()

  const [consecutiveDays, setConsecutiveDays] = useState(3)
  const [records,         setRecords]         = useState([])
  const [loading,         setLoading]         = useState(false)
  const [refreshKey,      setRefreshKey]      = useState(0)
  const [importing,       setImporting]       = useState(false)
  const [importResult,    setImportResult]    = useState(null)
  const [activeTab,       setActiveTab]       = useState('class-metrics')
  const fileInputRef = useRef(null)

  const today = useMemo(todayIso, [])

  const [lateModal,     setLateModal]     = useState(null) // { date, lwsIds[] }
  const [lectureModal,  setLectureModal]  = useState(null) // { date, absencesByLwsId }
  const [homeworkModal, setHomeworkModal] = useState(null) // { date, batchName, itemsByLwsId }
  const [sending,       setSending]       = useState(false)
  const [sendResult,    setSendResult]    = useState(null) // { kind, ok, sent, skipped, error? }

  function handleSendLate(lwsIds) {
    if (!lwsIds?.length) return
    const prior = lateSendHistory?.[today] ?? null
    setLateModal({
      date: today,
      lwsIds,
      notifiedLwsIds: prior ? (prior.notifiedLwsIds ?? []) : null,
    })
  }

  function handleSendLectureMiss(absencesByLwsId, date, batchName) {
    if (!absencesByLwsId || !Object.keys(absencesByLwsId).length) return
    const key = batchName ? `${date}|${batchName}` : null
    const prior = key ? lectureMissSendHistory?.[key] : null
    setLectureModal({
      date,
      batchName,
      absencesByLwsId,
      notifiedLwsIds: prior ? (prior.notifiedLwsIds ?? []) : null,
    })
  }

  function handleSendHomework(itemsByLwsId, date, batchName) {
    if (!itemsByLwsId || !Object.keys(itemsByLwsId).length) return
    const key = batchName ? `${date}|${batchName}` : null
    const prior = key ? homeworkSendHistory?.[key] : null
    setHomeworkModal({
      date,
      batchName,
      itemsByLwsId,
      notifiedItemKeys: prior ? (prior.notifiedItemKeys ?? []) : null,
    })
  }

  async function confirmSend(endpoint, payload, kind) {
    if (!supabase) {
      setSendResult({ kind, error: 'Supabase not configured locally — deploy to Vercel to send.' })
      return
    }
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in as admin to send notifications.')
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      // Surface the first interesting line from data.lines so we can see the
      // actual destination / Wabridge error without digging into runtime logs.
      let detail = data.error
      let preview = null
      if (Array.isArray(data.lines)) {
        if (!detail && data.sent === 0 && data.skipped > 0) {
          const fail = data.lines.find(l => /^\s*FAIL/.test(l)) || data.lines.find(l => /^\s*SKIP/.test(l))
          if (fail) detail = fail.trim()
        }
        if (data.sent > 0) {
          const sentLine = data.lines.find(l => /^\s*SENT/.test(l))
          if (sentLine) preview = sentLine.trim()
        }
      }
      setSendResult({ kind, ok: r.ok && data.ok && data.sent > 0, sent: data.sent, skipped: data.skipped, error: detail, preview })

      // Persist per-day send summary for the late flow so the widget can
      // surface "Resend N failed" on subsequent opens.
      if (kind === 'late' && lateModal?.date && r.ok) {
        const failedNames = parseFailedNames(data.lines)
        const failedSet = new Set(failedNames)
        // Students reached on this send (no failed leg), merged with prior sends so
        // the widget can show who's still pending.
        const newlyNotified = (payload.students || [])
          .filter(s => !failedSet.has(s.name))
          .map(s => s.lwsId)
        const prior = lateSendHistory?.[lateModal.date]
        const notifiedLwsIds = [...new Set([...(prior?.notifiedLwsIds || []), ...newlyNotified])]
        setLateSendHistory(lateModal.date, {
          sentAt: Date.now(),
          sent: data.sent ?? 0,
          skipped: data.skipped ?? 0,
          failedNames,
          notifiedLwsIds,
        })
      }
      // Same for lecture-miss, keyed by compound (date|batchName) so two
      // batches sent on the same day stay independent.
      if (kind === 'lecture-miss' && lectureModal?.date && lectureModal?.batchName && r.ok) {
        const failedNames = parseFailedNames(data.lines)
        const failedSet = new Set(failedNames)
        const newlyNotified = (payload.students || [])
          .filter(s => !failedSet.has(s.name))
          .map(s => s.lwsId)
        const key = `${lectureModal.date}|${lectureModal.batchName}`
        const prior = lectureMissSendHistory?.[key]
        const notifiedLwsIds = [...new Set([...(prior?.notifiedLwsIds || []), ...newlyNotified])]
        setLectureMissSendHistory(key, {
          sentAt: Date.now(),
          sent: data.sent ?? 0,
          skipped: data.skipped ?? 0,
          failedNames,
          notifiedLwsIds,
        })
      }
      // Homework: persist send summary + stamp notified_at on the rows whose
      // student (and not a failed leg) was actually reached.
      if (kind === 'homework' && homeworkModal?.date && homeworkModal?.batchName && r.ok) {
        const failedNames = parseFailedNames(data.lines)
        const failedSet = new Set(failedNames)
        // Per-(student, item) keys reached on this send (no failed leg), merged with
        // prior sends so the tab can show item-level pending.
        const newlyNotifiedKeys = []
        const notifiedLwsIds = new Set()
        for (const s of (payload.students || [])) {
          if (failedSet.has(s.name)) continue
          notifiedLwsIds.add(s.lwsId)
          for (const it of (s.items || [])) {
            newlyNotifiedKeys.push(homeworkNotifyKey(s.lwsId, it.subject, it.chapter, it.type))
          }
        }
        const key = `${homeworkModal.date}|${homeworkModal.batchName}`
        const prior = homeworkSendHistory?.[key]
        const notifiedItemKeys = [...new Set([...(prior?.notifiedItemKeys || []), ...newlyNotifiedKeys])]
        setHomeworkSendHistory(key, {
          sentAt: Date.now(),
          sent: data.sent ?? 0,
          skipped: data.skipped ?? 0,
          failedNames,
          notifiedItemKeys,
        })
        // Also stamp the server-side notified_at audit on the reached rows.
        if (notifiedLwsIds.size) {
          const rows = await getHomeworkForDate(homeworkModal.date)
          const ids = rows
            .filter(row => !row.resolved_at && notifiedLwsIds.has(row.lws_id))
            .map(row => row.id)
          if (ids.length) markHomeworkNotified(ids)
        }
      }
    } catch (e) {
      setSendResult({ kind, error: e.message })
    } finally {
      setSending(false)
      setLateModal(null)
      setLectureModal(null)
      setHomeworkModal(null)
    }
  }

  // lws_id → canonical name
  const lwsIdToName = useMemo(() => {
    const map = {}
    for (const p of Object.values(studentProfiles)) {
      if (p.lwsId && !map[p.lwsId]) map[p.lwsId] = p.name
    }
    return map
  }, [studentProfiles])

  // Fetch all attendance records with pagination (Supabase caps bare select at 1000 rows)
  useEffect(() => {
    if (!supabase) { setRecords([]); return }
    let cancelled = false
    setLoading(true)
    async function fetchAll() {
      const PAGE = 1000
      let from = 0
      const all = []
      while (true) {
        const { data, error } = await supabase
          .from('student_attendance')
          .select('lws_id, date, status')
          .range(from, from + PAGE - 1)
        if (error || !data?.length) break
        all.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      if (!cancelled) { setRecords(all); setLoading(false) }
    }
    fetchAll()
    return () => { cancelled = true }
  }, [refreshKey])

  const studentStats = useMemo(
    () => buildStudentStats(records, lwsIdToName),
    [records, lwsIdToName]
  )

  const consecutiveAbsent = useMemo(
    () => buildConsecutiveAbsent(records, lwsIdToName, consecutiveDays),
    [records, lwsIdToName, consecutiveDays]
  )

  const classAvg = studentStats.length
    ? Math.round(studentStats.reduce((s, r) => s + r.pct, 0) / studentStats.length)
    : null

  const atRisk = studentStats.filter(r => r.pct < 75).length

  const allDates  = [...new Set(records.map(r => r.date))].sort()
  const dateRange = allDates.length
    ? `${allDates[0]} – ${allDates[allDates.length - 1]}`
    : null

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const parsed = await parseAttendanceExcel(file)
      const result = await importAttendance(parsed)
      setImportResult(result)
      setRefreshKey(k => k + 1)
    } catch (err) {
      setImportResult({ error: err.message })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl">
      <PageHeader
        title="Attendance"
        sub={dateRange ? `Data: ${dateRange}` : 'No attendance data imported yet'}
        actions={
          mode === 'admin' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={handleImport}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="btn btn-primary flex items-center gap-2 min-h-[44px] px-4"
              >
                {importing ? <Spinner size="sm" /> : '📥'}
                {importing ? 'Importing…' : 'Import XLS'}
              </button>
            </>
          )
        }
      />

      {/* Import result banner */}
      {importResult && (
        <div className="mb-5">
          {importResult.error
            ? <Alert type="error">❌ {importResult.error}</Alert>
            : (
              <Alert type="success">
                ✓ Matched {importResult.matched} students
                ({importResult.upserted} records saved
                {importResult.lateProtected > 0 && `, ${importResult.lateProtected} late marks preserved`})
                {importResult.unmatched > 0 && ` · ${importResult.unmatched} not found in profiles`}
              </Alert>
            )
          }
        </div>
      )}

      {/* Tab strip */}
      <div className="border-b border-border mb-5 flex gap-1">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'class-metrics'}
          onClick={() => setActiveTab('class-metrics')}
          className={`px-4 py-2.5 text-[13px] font-semibold min-h-[44px] border-b-2 transition-colors
            ${activeTab === 'class-metrics' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
        >
          Class metrics
        </button>
        {mode === 'admin' && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'lecture-log'}
            onClick={() => setActiveTab('lecture-log')}
            className={`px-4 py-2.5 text-[13px] font-semibold min-h-[44px] border-b-2 transition-colors
              ${activeTab === 'lecture-log' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            Lecture log
          </button>
        )}
        {mode === 'admin' && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'homework-log'}
            onClick={() => setActiveTab('homework-log')}
            className={`px-4 py-2.5 text-[13px] font-semibold min-h-[44px] border-b-2 transition-colors
              ${activeTab === 'homework-log' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            Homework / Notes
          </button>
        )}
        {mode === 'admin' && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'hostel'}
            onClick={() => setActiveTab('hostel')}
            className={`px-4 py-2.5 text-[13px] font-semibold min-h-[44px] border-b-2 transition-colors
              ${activeTab === 'hostel' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            Hostel &amp; Mess
          </button>
        )}
      </div>

      {activeTab === 'lecture-log' && mode === 'admin' ? (
        <LectureLogTab onSend={handleSendLectureMiss} />
      ) : activeTab === 'homework-log' && mode === 'admin' ? (
        <HomeworkLogTab onSend={handleSendHomework} />
      ) : activeTab === 'hostel' && mode === 'admin' ? (
        <HostelTab />
      ) : (
        <>
          {mode === 'admin' && (
            <LateMarkingWidget date={today} onSend={handleSendLate} />
          )}

      {/* Consecutive absences alert */}
      {records.length > 0 && (
        <div className="card px-5 py-4 mb-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[12px] font-mono uppercase tracking-widest text-ink-3">Absent last</span>
            <input
              type="number"
              min={1}
              max={30}
              value={consecutiveDays}
              onChange={e => setConsecutiveDays(Math.max(1, Math.min(30, +e.target.value || 1)))}
              className="form-input w-14 text-center text-[13px] min-h-[44px] px-2"
            />
            <span className="text-[12px] font-mono uppercase tracking-widest text-ink-3">
              consecutive days (excl. Sundays)
            </span>
            {consecutiveAbsent.length > 0 && (
              <span className="ml-auto text-[12px] font-semibold text-danger">
                {consecutiveAbsent.length} student{consecutiveAbsent.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {consecutiveAbsent.length === 0 ? (
            <div className="text-[13px] text-success font-semibold">✓ No consecutive absences</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {consecutiveAbsent.map(s => {
                const hasProfile = !!studentProfiles[s.name]
                const content = (
                  <>
                    <span className="text-[13px] font-semibold text-ink">{s.name}</span>
                    <span className="text-[11px] font-mono text-danger">
                      since {fmtDate(s.since)} ({s.count} day{s.count !== 1 ? 's' : ''})
                    </span>
                  </>
                )
                const baseCls = 'flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200'
                return hasProfile ? (
                  <button
                    key={s.lwsId}
                    type="button"
                    onClick={() => setActiveStudent(s.name)}
                    className={`${baseCls} hover:bg-red-100 focus:outline-none
                                focus-visible:ring-2 focus-visible:ring-accent/40`}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={s.lwsId} className={baseCls}>{content}</div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Summary bar */}
      {studentStats.length > 0 && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">Class avg</span>
            <span className={`text-[22px] font-extrabold ${pctColor(classAvg)}`}>{classAvg}%</span>
          </div>
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">At risk</span>
            <span className="text-[22px] font-extrabold text-red-400">{atRisk}</span>
            <span className="text-[11px] text-ink-3">below 75%</span>
          </div>
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">Students</span>
            <span className="text-[22px] font-extrabold text-ink-2">{studentStats.length}</span>
          </div>
        </div>
      )}

      {/* Table */}
      {loading
        ? (
          <div className="flex items-center gap-3 py-16 justify-center text-ink-3">
            <Spinner /> Loading attendance…
          </div>
        )
        : studentStats.length === 0
          ? (
            <EmptyState
              icon="📋"
              title="No attendance data"
              sub={mode === 'admin'
                ? 'Import an attendance XLS file to get started.'
                : 'No attendance records available.'}
            />
          )
          : (
            <div className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[10.5px] font-mono uppercase tracking-widest text-ink-3">
                    <th className="text-left px-4 py-3">Student</th>
                    <th className="text-right px-4 py-3">Present</th>
                    <th className="text-right px-4 py-3">Absent</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-right px-4 py-3 pr-5">Avg %</th>
                  </tr>
                </thead>
                <tbody>
                  {studentStats.map((s, i) => (
                    <tr
                      key={s.lwsId}
                      className={`border-b border-border hover:bg-accent-soft/30 transition-colors
                        ${i % 2 === 0 ? '' : 'bg-surface-2/40'}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">
                        {studentProfiles[s.name] ? (
                          <button
                            type="button"
                            onClick={() => setActiveStudent(s.name)}
                            className="text-left hover:text-accent hover:underline
                                       focus:outline-none focus-visible:ring-2
                                       focus-visible:ring-accent/40 rounded"
                          >
                            {s.name}
                          </button>
                        ) : s.name}
                      </td>
                      <td className="px-4 py-2.5 text-right text-green-500 font-mono">{s.p}</td>
                      <td className="px-4 py-2.5 text-right text-red-400 font-mono">{s.a}</td>
                      <td className="px-4 py-2.5 text-right text-ink-3 font-mono">{s.total}</td>
                      <td className="px-4 py-2.5 text-right pr-5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono border
                          ${pctBg(s.pct)} ${pctColor(s.pct)}`}>
                          {s.pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      }
        </>
      )}

      {/* Send-result alert */}
      {sendResult && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-8 md:max-w-md z-[900]">
          {sendResult.error ? (
            <Alert type="error">
              ❌ {sendResult.kind === 'late' ? 'Late' : sendResult.kind === 'homework' ? 'Homework' : 'Lecture-miss'} send failed: {sendResult.error}
              <button onClick={() => setSendResult(null)} className="ml-3 text-[12px] underline">dismiss</button>
            </Alert>
          ) : (
            <Alert type="success">
              ✓ {sendResult.kind === 'late' ? 'Late notifications' : sendResult.kind === 'homework' ? 'Homework notifications' : 'Lecture-miss notifications'} sent: {sendResult.sent ?? 0} · skipped: {sendResult.skipped ?? 0}
              {sendResult.preview && (
                <div className="mt-1 text-[11px] font-mono opacity-75 break-all">{sendResult.preview}</div>
              )}
              <button onClick={() => setSendResult(null)} className="ml-3 text-[12px] underline">dismiss</button>
            </Alert>
          )}
        </div>
      )}

      {/* Preview modals */}
      {lateModal && (
        <LateNotificationPreviewModal
          date={lateModal.date}
          lateLwsIds={lateModal.lwsIds}
          notifiedLwsIds={lateModal.notifiedLwsIds}
          sending={sending}
          onClose={() => !sending && setLateModal(null)}
          onConfirm={(students, redirectTo) =>
            confirmSend(
              '/api/send-late-notifications',
              { date: lateModal.date, redirectTo, students },
              'late'
            )
          }
        />
      )}
      {lectureModal && (
        <LectureMissPreviewModal
          date={lectureModal.date}
          absencesByLwsId={lectureModal.absencesByLwsId}
          notifiedLwsIds={lectureModal.notifiedLwsIds}
          sending={sending}
          onClose={() => !sending && setLectureModal(null)}
          onConfirm={(students, redirectTo) =>
            confirmSend(
              '/api/send-lecture-absences',
              { date: lectureModal.date, redirectTo, students },
              'lecture-miss'
            )
          }
        />
      )}
      {homeworkModal && (
        <HomeworkPreviewModal
          date={homeworkModal.date}
          itemsByLwsId={homeworkModal.itemsByLwsId}
          notifiedItemKeys={homeworkModal.notifiedItemKeys}
          sending={sending}
          onClose={() => !sending && setHomeworkModal(null)}
          onConfirm={(students, redirectTo) =>
            confirmSend(
              '/api/send-homework-pending',
              { date: homeworkModal.date, redirectTo, students },
              'homework'
            )
          }
        />
      )}
    </div>
  )
}
