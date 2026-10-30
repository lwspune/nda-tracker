import { useMemo, useRef, useState } from 'react'
import useStore from '../../store/useStore'
import useHolidays from '../../store/useHolidays'
import { supabase } from '../../lib/supabase'
import { parsePunchReportExcel } from '../../lib/excel'
import { matchPunchRows, punchAttendanceRecords, ATTENDANCE_REPORT_BRANCH } from '../../lib/punchReport'
import { dayOffReason } from '../../lib/holidays'
import { isFlowEnabled, flowOffMessage } from '../../lib/whatsappFlows'
import { fmtDate, fmtDateShort } from '../../lib/dates'
import { Alert } from '../../components/ui'
import FlowOffNote from '../../components/ui/FlowOffNote'

// Students per request. Each student is about three messages (student plus
// parents), so ten keeps one call well inside the function's time limit. The
// endpoint refuses more than ATTENDANCE_REPORT_GROUP.
const SEND_GROUP = 10

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The nightly attendance report (Attendance → Class metrics, admin only):
// upload EIS's Punch Monitor export, check the preview, save the day's P/A and
// send. Parsing, the register rows and the message values come from
// src/lib/punchReport.js; who may be messaged, and whether they already were,
// is decided again by the server.
export default function AttendanceReportCard({ today }) {
  const studentList = useStore(s => s.studentList)
  const saveAttendanceRecords = useStore(s => s.saveAttendanceRecords)
  const flowOff = useStore(s => !isFlowEnabled(s.whatsappFlows, 'attendanceReport'))
  const holidays = useHolidays()
  const inputRef = useRef(null)

  const [report, setReport]         = useState(null)   // parsePunchSheet() result
  const [parseError, setParseError] = useState(null)
  const [alreadySent, setAlreadySent] = useState(() => new Set())
  const [onFile, setOnFile]         = useState(() => new Set())   // student_attendance rows for the date
  const [ticks, setTicks]           = useState({})     // warning key → acknowledged
  const [testNumber, setTestNumber] = useState('')
  const [progress, setProgress]     = useState(null)   // { done, total }
  const [result, setResult]         = useState(null)   // { test?, sent, skipped, alreadySent, failures[], error? }
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(null)   // saveAttendanceRecords() result

  const match = useMemo(
    () => (report ? matchPunchRows(report.rows, studentList) : null),
    [report, studentList],
  )
  const register = useMemo(
    () => (match ? punchAttendanceRecords(match, report.date) : null),
    [match, report],
  )
  const replacing = register ? register.records.filter(r => onFile.has(r.lws_id)).length : 0
  const pending = useMemo(
    () => (match ? match.ready.filter(r => !alreadySent.has(r.lwsId)) : []),
    [match, alreadySent],
  )

  // Things that are usually a mistake, each needing a tick before a real send.
  const warnings = useMemo(() => {
    if (!report?.date || !match) return []
    const list = []
    if (report.date !== today) {
      list.push({ key: 'date', label: `This file is for ${fmtDate(report.date)}, not today. Continue anyway.` })
    }
    const byLwsId = new Map((studentList || []).map(s => [s.lws_id, s]))
    const reasons = new Map()
    for (const r of match.ready) {
      const s = byLwsId.get(r.lwsId)
      const why = dayOffReason(holidays, { branch: ATTENDANCE_REPORT_BRANCH, batches: s?.batches || [] }, report.date)
      if (why) reasons.set(why, (reasons.get(why) || 0) + 1)
    }
    for (const [why, n] of reasons) {
      list.push({
        key: `off:${why}`,
        label: why === 'Sunday'
          ? `${fmtDateShort(report.date)} is a Sunday. Continue anyway.`
          : `${why} is a holiday for ${plural(n, 'student')} on ${fmtDateShort(report.date)}. Continue anyway.`,
      })
    }
    return list
  }, [report, match, today, holidays, studentList])

  const sending = progress !== null || saving
  const unticked = warnings.some(w => !ticks[w.key])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReport(null); setParseError(null); setResult(null); setSaved(null); setTicks({})
    setAlreadySent(new Set()); setOnFile(new Set())
    try {
      const parsed = await parsePunchReportExcel(file)
      setReport(parsed)
      if (parsed.date) await Promise.all([loadAlreadySent(parsed.date), loadOnFile(parsed.date)])
    } catch (err) {
      setParseError(err.message || String(err))
    }
  }

  async function loadAlreadySent(date) {
    if (!supabase) return
    const { data, error } = await supabase.from('attendance_report_sends').select('lws_id').eq('date', date)
    if (error) {
      // The server still refuses a second send; this only shapes the preview.
      setParseError(`Could not check who was already sent: ${error.message}`)
      return
    }
    setAlreadySent(new Set((data || []).map(r => r.lws_id)))
  }

  async function loadOnFile(date) {
    if (!supabase) return
    const { data, error } = await supabase.from('student_attendance').select('lws_id').eq('date', date)
    // Only shapes the "already has attendance" note; saving reads Late marks itself.
    if (!error) setOnFile(new Set((data || []).map(r => r.lws_id)))
  }

  // The day's P/A, through the same write as the bulk import (Late marks kept).
  async function saveRegister() {
    setSaving(true)
    setSaved(null)
    try {
      const res = await saveAttendanceRecords(register.records)
      setSaved(res)
      if (!res.error) await loadOnFile(report.date)
      return !res.error
    } catch (err) {
      setSaved({ error: err.message || String(err) })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function post(students, redirectTo) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sign in as admin to send.')
    const r = await fetch('/api/send-attendance-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        kind: 'attendance-report',
        date: report.date,
        ...(redirectTo ? { redirectTo } : {}),
        students: students.map(s => ({ lwsId: s.lwsId, status: s.status, inTime: s.inTime, outTime: s.outTime })),
      }),
    })
    const data = await r.json()
    if (!r.ok || !data.ok) throw new Error(data.error || `Send failed (${r.status})`)
    return data
  }

  async function run(groups, { test = false, redirectTo = null } = {}) {
    if (!supabase) {
      setResult({ error: 'Supabase not configured locally — deploy to Vercel to send.' }); return
    }
    const total = groups.reduce((n, g) => n + g.length, 0)
    const tally = { test, sent: 0, skipped: 0, alreadySent: 0, failures: [] }
    setResult(null)
    setProgress({ done: 0, total })
    try {
      let done = 0
      for (const group of groups) {
        const data = await post(group, redirectTo)
        tally.sent += data.sent ?? 0
        tally.skipped += data.skipped ?? 0
        tally.alreadySent += data.alreadySent ?? 0
        tally.failures.push(...(data.lines || []).filter(l => /^\s*(FAIL|WARN)/.test(l)).map(l => l.trim()))
        done += group.length
        setProgress({ done, total })
      }
    } catch (err) {
      tally.error = err.message || String(err)
    } finally {
      setProgress(null)
      setResult(tally)
      if (!test) await loadAlreadySent(report.date)
    }
  }

  async function handleSend() {
    setResult(null)
    if (!(await saveRegister())) return
    const groups = []
    for (let i = 0; i < pending.length; i += SEND_GROUP) groups.push(pending.slice(i, i + SEND_GROUP))
    run(groups)
  }

  // One present and one absent student, so both message shapes are checked.
  function handleTest() {
    const sample = [
      match.ready.find(r => r.status === 'P'),
      match.ready.find(r => r.status !== 'P'),
    ].filter(Boolean)
    run([sample], { test: true, redirectTo: testNumber.trim() })
  }

  const left = match
    ? [
        { key: 'unmatched', label: 'Not in the tracker', rows: match.unmatched.map(r => `${r.name} (${r.regNo})${r.reason !== 'Not in the tracker' ? ` — ${r.reason}` : ''}`) },
        { key: 'other',     label: 'Other branch',       rows: match.otherBranch.map(r => `${r.name} (${r.branch || 'no branch'})`) },
        { key: 'blocked',   label: 'Blocked',            rows: match.blocked.map(r => r.name) },
        { key: 'dupes',     label: 'Repeated in the file, sent once', rows: report.duplicates },
      ].filter(g => g.rows.length)
    : []

  return (
    <div className="card px-5 py-4 mb-5">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-[12px] font-mono uppercase tracking-widest text-ink-3">Daily attendance report</h3>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={sending}
          className="btn btn-secondary text-[13px] min-h-[44px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Upload punch file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          aria-label="Punch Monitor file"
          className="sr-only"
          onChange={handleFile}
        />
      </div>
      <p className="text-[12px] text-ink-3 mb-3">
        After class, upload the day's Punch Monitor export from EIS. Saving records each {ATTENDANCE_REPORT_BRANCH} student
        present or absent for the day; sending gives each student and their parents the in and out times, or Absent.
      </p>
      {flowOff && <FlowOffNote flow="attendanceReport" className="block mb-3" />}

      {parseError && <div className="mb-3"><Alert type="error">{parseError}</Alert></div>}

      {report && !report.date && (
        <Alert type="error">Cannot read the report date from this file&apos;s title row, so it cannot be sent.</Alert>
      )}

      {report?.date && match && (
        <>
          <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap mb-3 text-[13px]">
            <span className="font-semibold text-ink">{fmtDate(report.date)}</span>
            <span className="text-ink-2">
              {plural(match.ready.length, 'student')} ·{' '}
              {match.ready.filter(r => r.status === 'P').length} present ·{' '}
              {match.ready.filter(r => r.status !== 'P').length} absent
            </span>
            {alreadySent.size > 0 && (
              <span className="text-ink-3">
                {match.ready.filter(r => alreadySent.has(r.lwsId)).length} already sent for this date
              </span>
            )}
          </div>

          {replacing > 0 && (
            <p className="mb-3 text-[12px] text-ink-2">
              {replacing} of these students already have attendance for this date. Saving replaces it with this
              file; Late marks are kept.
            </p>
          )}

          {match.ready.length > 0 && (
            <div className="max-h-72 overflow-auto border border-border rounded-lg mb-3">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-[10px] font-mono uppercase tracking-widest text-ink-3">
                    <th scope="col" className="px-3 py-2">Student</th>
                    <th scope="col" className="px-3 py-2">In time</th>
                    <th scope="col" className="px-3 py-2">Out time</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Status</span></th>
                  </tr>
                </thead>
                <tbody>
                  {match.ready.map(r => (
                    <tr key={r.lwsId} className="border-t border-border">
                      <td className="px-3 py-1.5 text-ink">{r.name}</td>
                      <td className={`px-3 py-1.5 ${r.status === 'P' ? 'text-ink' : 'text-red-700'}`}>{r.inText}</td>
                      <td className={`px-3 py-1.5 ${r.status === 'P' ? 'text-ink' : 'text-red-700'}`}>{r.outText}</td>
                      <td className="px-3 py-1.5 text-ink-3 text-[11px]">{alreadySent.has(r.lwsId) ? '✓ sent' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {left.length > 0 && (
            <div className="mb-3 space-y-1.5 text-[12px]">
              <div className="text-ink-3">Not sent:</div>
              {left.map(g => (
                <div key={g.key}>
                  <span className="font-semibold text-ink-2">{g.label} ({g.rows.length}): </span>
                  <span className="text-ink-3">{g.rows.join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {register.skipped.length > 0 && (
            <div className="mb-3 text-[12px]">
              <span className="font-semibold text-ink-2">Not saved — status is not P or A ({register.skipped.length}): </span>
              <span className="text-ink-3">{register.skipped.map(r => `${r.name} (${r.status || 'blank'})`).join(', ')}</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mb-3 space-y-2">
              {warnings.map(w => (
                <label key={w.key} className="flex items-start gap-2 px-3 py-2 rounded-lg border border-yellow-200 bg-yellow-50 text-[12.5px] text-yellow-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!ticks[w.key]}
                    onChange={e => setTicks(t => ({ ...t, [w.key]: e.target.checked }))}
                    disabled={sending}
                    className="mt-0.5 accent-yellow-700"
                  />
                  <span>{w.label}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-ink-3 font-mono uppercase tracking-widest">Test number</span>
              <input
                type="tel"
                value={testNumber}
                onChange={e => setTestNumber(e.target.value)}
                placeholder="10-digit mobile"
                disabled={sending}
                className="form-input text-[12px] min-h-[44px] px-2 w-40"
              />
            </label>
            <button
              type="button"
              onClick={handleTest}
              disabled={sending || !testNumber.trim() || match.ready.length === 0}
              className="btn btn-secondary text-[13px] min-h-[44px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send test
            </button>
            <div className="flex items-end gap-3 flex-wrap ml-auto">
              <button
                type="button"
                onClick={saveRegister}
                disabled={sending || unticked || register.records.length === 0}
                className="btn btn-secondary text-[13px] min-h-[44px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save attendance only
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || flowOff || unticked || pending.length === 0}
                title={flowOff ? flowOffMessage('attendanceReport') : undefined}
                className="btn btn-primary text-[13px] min-h-[44px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pending.length === 0 && match.ready.length > 0
                  ? 'All sent for this date'
                  : `Save & send to ${plural(pending.length, 'student')}`}
              </button>
            </div>
          </div>
        </>
      )}

      {saving && (
        <div className="mt-3 text-[12px] text-ink-2" role="status">Saving attendance…</div>
      )}

      {saved && (
        <div className="mt-3">
          <Alert type={saved.error ? 'error' : 'success'}>
            {saved.error
              ? saved.error
              : <>
                  Attendance saved for {plural(saved.upserted, 'student')}
                  {saved.lateProtected > 0 && ` · ${plural(saved.lateProtected, 'Late mark')} kept`}
                </>}
          </Alert>
        </div>
      )}

      {progress && (
        <div className="mt-3 text-[12px] text-ink-2" role="status">
          Sending… {progress.done} of {plural(progress.total, 'student')}
        </div>
      )}

      {result && (
        <div className="mt-3">
          <Alert type={result.error ? 'error' : result.failures?.length ? 'warning' : 'success'}>
            <div>
              {result.error && <div className="font-semibold">{result.error}</div>}
              {(result.sent > 0 || !result.error) && (
                <div>
                  {result.test ? 'Test: ' : ''}Sent {result.sent} message{result.sent === 1 ? '' : 's'}
                  {result.skipped > 0 && ` · ${result.skipped} not sent`}
                  {result.alreadySent > 0 && ` · ${result.alreadySent} already sent earlier`}
                </div>
              )}
              {result.failures?.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {result.failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
            </div>
          </Alert>
        </div>
      )}
    </div>
  )
}
