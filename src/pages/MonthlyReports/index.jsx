import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { buildMonthlyReport, getMonthlyReportCohort } from '../../lib/monthlyReportBuilder'
import { downloadMonthlyReportPdf } from '../../lib/monthlyReportPdf'
import { downloadMonthlyReportsZip, zipFilename } from '../../lib/monthlyReportZip'
import ReportRow from './ReportRow'

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// 'YYYY-MM-DD' for a date object.
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// First & last calendar day of the previous month — the default range the page
// opens with (keeps parity with the old "previous calendar month" default).
function previousMonthRange(today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth()               // 0–11 of current month
  const from = new Date(y, m - 1, 1)        // 1st of previous month
  const to   = new Date(y, m, 0)            // day 0 of this month → last of previous
  return { from: iso(from), to: iso(to) }
}

// Range → human label, mirroring monthlyReportBuilder.rangeLabel: a whole
// calendar month collapses to 'Jan 2026', otherwise a spanning label. Used only
// for the ZIP archive filename (per-PDF filenames come from the builder).
function rangeLabel(from, to) {
  if (!from || !to) return ''
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const lastOfFrom = new Date(fy, fm, 0).getDate()
  if (fy === ty && fm === tm && fd === 1 && td === lastOfFrom) {
    return `${SHORT_MONTHS[fm - 1]} ${fy}`
  }
  const left = fy === ty ? `${fd} ${SHORT_MONTHS[fm - 1]}` : `${fd} ${SHORT_MONTHS[fm - 1]} ${fy}`
  return `${left} - ${td} ${SHORT_MONTHS[tm - 1]} ${ty}`
}

export default function MonthlyReportsPage() {
  const exams                  = useStore(s => s.exams)
  const studentProfiles        = useStore(s => s.studentProfiles)
  // Raw store references (referentially stable from Zustand) — coalesce nullish
  // at point of use so they stay stable useMemo/useState deps.
  const syllabusBatches        = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches  = useStore(s => s.syllabusBatchBranches)
  const branches               = useStore(s => s.branches)
  const syllabusPrograms       = useStore(s => s.syllabusPrograms)
  const batchChapterTimelines  = useStore(s => s.batchChapterTimelines)
  const fetchMonthlyReportData = useStore(s => s.fetchMonthlyReportData)

  const defaultRange = previousMonthRange()
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [branch, setBranch] = useState('')          // '' = all branches
  // Batches visible in the dropdown, narrowed by the selected branch.
  const batchOptions = useMemo(() => {
    const all = syllabusBatches || []
    const map = syllabusBatchBranches || {}
    return branch ? all.filter(b => map[b] === branch) : all
  }, [syllabusBatches, syllabusBatchBranches, branch])
  const [batch, setBatch] = useState((syllabusBatches || [])[0] || '')
  const [generated, setGenerated] = useState(null)   // { dataByLwsId } | null
  const [generating, setGenerating] = useState(false)
  const [remarks, setRemarks] = useState({})        // { [lwsId]: string }, transient
  const [bulkBusy, setBulkBusy] = useState(false)
  const [error, setError] = useState('')

  const rangeInvalid = !from || !to || from > to

  const cohort = useMemo(() =>
    batch && !rangeInvalid ? getMonthlyReportCohort(studentProfiles, batch, to) : []
  , [studentProfiles, batch, to, rangeInvalid])

  async function handleGenerate() {
    if (!batch || rangeInvalid || cohort.length === 0) return
    setGenerating(true)
    setError('')
    setGenerated(null)
    try {
      const lwsIds = cohort.map(p => p.lwsId).filter(Boolean)
      const data = await fetchMonthlyReportData(from, to, lwsIds)
      if (data === null) {
        setError('Failed to load attendance / absence data. Try again.')
        return
      }
      setGenerated({
        attendanceByLwsId:      data.attendanceByLwsId,
        lectureAbsencesByLwsId: data.lectureAbsencesByLwsId,
        examAbsencesByLwsId:    data.examAbsencesByLwsId,
        homeworkByLwsId:        data.homeworkByLwsId,
      })
    } finally {
      setGenerating(false)
    }
  }

  function reportFor(profile) {
    const lwsId = profile.lwsId
    return buildMonthlyReport({
      profile,
      from,
      to,
      exams,
      attendance:      generated?.attendanceByLwsId?.[lwsId]      || [],
      lectureAbsences: generated?.lectureAbsencesByLwsId?.[lwsId] || [],
      examAbsences:    generated?.examAbsencesByLwsId?.[lwsId]    || [],
      homework:        generated?.homeworkByLwsId?.[lwsId]        || [],
      batchChapterTimelines,
      syllabusPrograms,
    })
  }

  async function handleDownload(profile) {
    const report = reportFor(profile)
    await downloadMonthlyReportPdf(report, { remark: remarks[profile.lwsId] || '' })
  }

  function safeFile(s) {
    return (s || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  }

  async function handleBulkZip() {
    if (!generated || cohort.length === 0) return
    setBulkBusy(true)
    setError('')
    try {
      const label = rangeLabel(from, to)
      const items = cohort.map(profile => {
        const report = reportFor(profile)
        return {
          report,
          remark: remarks[profile.lwsId] || '',
          filename: `${safeFile(profile.name)}_${safeFile(label)}_Report.pdf`,
        }
      })
      await downloadMonthlyReportsZip(items, zipFilename(batch, label))
    } catch (e) {
      console.error(e)
      setError('Failed to build the ZIP archive. Try again.')
    } finally {
      setBulkBusy(false)
    }
  }

  // Reset preview when controls change so users don't see mismatched data.
  function clearPreview() { setGenerated(null); setRemarks({}) }
  function setFromAndClear(v) { setFrom(v); clearPreview() }
  function setToAndClear(v) { setTo(v); clearPreview() }
  function setBatchAndClear(v) { setBatch(v); clearPreview() }
  // Changing branch narrows the batch list — drop a now-hidden batch selection.
  function setBranchAndClear(v) {
    setBranch(v)
    if (v && batch && (syllabusBatchBranches || {})[batch] !== v) setBatch('')
    clearPreview()
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-extrabold text-ink mb-1">Monthly Reports</h1>
        <p className="text-[12px] text-ink-3">
          Generate per-student PDF report cards for parents. Defaults to the previous calendar month — adjust the date range for any window.
        </p>
      </div>

      {/* Controls */}
      <div className="card p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="from-input" className="form-label mb-1.5">From</label>
            <input
              id="from-input"
              type="date"
              value={from}
              max={to || undefined}
              onChange={e => setFromAndClear(e.target.value)}
              className="form-input text-[13px]"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="to-input" className="form-label mb-1.5">To</label>
            <input
              id="to-input"
              type="date"
              value={to}
              min={from || undefined}
              onChange={e => setToAndClear(e.target.value)}
              className="form-input text-[13px]"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="branch-select" className="form-label mb-1.5">Branch</label>
            <select
              id="branch-select"
              value={branch}
              onChange={e => setBranchAndClear(e.target.value)}
              className="form-input text-[13px]"
            >
              <option value="">All branches</option>
              {(branches || []).map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="batch-select" className="form-label mb-1.5">Batch</label>
            <select
              id="batch-select"
              value={batch}
              onChange={e => setBatchAndClear(e.target.value)}
              className="form-input text-[13px]"
            >
              <option value="">— select —</option>
              {batchOptions.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!batch || rangeInvalid || cohort.length === 0 || generating}
            className="btn btn-primary text-[13px] min-h-[44px] px-5
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? 'Loading…' : 'Generate'}
          </button>
        </div>

        <div className="mt-3 text-[12px] text-ink-3">
          {rangeInvalid
            ? <span className="text-danger">Pick a valid date range — the “From” date must be on or before “To”.</span>
            : batch
              ? <>Cohort: <span className="font-semibold text-ink">{cohort.length}</span> student{cohort.length !== 1 ? 's' : ''}</>
              : <>Pick a batch to see the cohort.</>}
        </div>

        {error && (
          <div className="mt-3 text-[12px] text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Preview list */}
      {generated && cohort.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[11px] font-mono uppercase tracking-[1.5px] text-ink-3">
              Preview · {cohort.length} report{cohort.length !== 1 ? 's' : ''}
            </div>
            <button
              type="button"
              onClick={handleBulkZip}
              disabled={bulkBusy}
              className="btn btn-primary text-[12px] min-h-[40px] px-4
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {bulkBusy ? `Building ZIP… (${cohort.length} files)` : `Download all as ZIP (${cohort.length})`}
            </button>
          </div>
          {cohort.map(profile => (
            <ReportRow
              key={profile.lwsId}
              profile={profile}
              report={reportFor(profile)}
              remark={remarks[profile.lwsId] || ''}
              onRemarkChange={(value) => setRemarks(r => ({ ...r, [profile.lwsId]: value }))}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {generated && cohort.length === 0 && (
        <div className="card px-4 py-8 text-center text-[13px] text-ink-3 italic">
          No active students in this batch are registered on or before {to}.
        </div>
      )}

      {!generated && batch && cohort.length > 0 && (
        <div className="card px-4 py-6 text-center text-[13px] text-ink-3">
          Click <span className="font-semibold text-ink">Generate</span> to load attendance and absence data for {cohort.length} student{cohort.length !== 1 ? 's' : ''}.
        </div>
      )}
    </div>
  )
}
