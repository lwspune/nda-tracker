import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { buildMonthlyReport, getMonthlyReportCohort } from '../../lib/monthlyReportBuilder'
import { downloadMonthlyReportPdf } from '../../lib/monthlyReportPdf'
import ReportRow from './ReportRow'

// 'YYYY-MM' for the previous calendar month — the default when the page opens.
function previousMonth(today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth()     // 0–11 of current month
  const prev = new Date(y, m - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthlyReportsPage() {
  const exams                  = useStore(s => s.exams)
  const studentProfiles        = useStore(s => s.studentProfiles)
  const syllabusBatches        = useStore(s => s.syllabusBatches) || []
  const syllabusPrograms       = useStore(s => s.syllabusPrograms)
  const batchChapterTimelines  = useStore(s => s.batchChapterTimelines)
  const fetchMonthlyReportData = useStore(s => s.fetchMonthlyReportData)

  const [month, setMonth] = useState(previousMonth())
  const [batch, setBatch] = useState(syllabusBatches[0] || '')
  const [generated, setGenerated] = useState(null)   // { dataByLwsId } | null
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const cohort = useMemo(() =>
    batch ? getMonthlyReportCohort(studentProfiles, batch, month) : []
  , [studentProfiles, batch, month])

  async function handleGenerate() {
    if (!batch || cohort.length === 0) return
    setGenerating(true)
    setError('')
    setGenerated(null)
    try {
      const lwsIds = cohort.map(p => p.lwsId).filter(Boolean)
      const data = await fetchMonthlyReportData(month, lwsIds)
      if (data === null) {
        setError('Failed to load attendance / absence data. Try again.')
        return
      }
      setGenerated({
        attendanceByLwsId:      data.attendanceByLwsId,
        lectureAbsencesByLwsId: data.lectureAbsencesByLwsId,
        examAbsencesByLwsId:    data.examAbsencesByLwsId,
      })
    } finally {
      setGenerating(false)
    }
  }

  function reportFor(profile) {
    const lwsId = profile.lwsId
    return buildMonthlyReport({
      profile,
      month,
      exams,
      attendance:      generated?.attendanceByLwsId?.[lwsId]      || [],
      lectureAbsences: generated?.lectureAbsencesByLwsId?.[lwsId] || [],
      examAbsences:    generated?.examAbsencesByLwsId?.[lwsId]    || [],
      batchChapterTimelines,
      syllabusPrograms,
    })
  }

  async function handleDownload(profile, remark) {
    const report = reportFor(profile)
    await downloadMonthlyReportPdf(report, { remark })
  }

  // Reset preview when controls change so users don't see mismatched data.
  function setMonthAndClear(v) { setMonth(v); setGenerated(null) }
  function setBatchAndClear(v) { setBatch(v); setGenerated(null) }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-extrabold text-ink mb-1">Monthly Reports</h1>
        <p className="text-[12px] text-ink-3">
          Generate per-student PDF report cards for parents. Default month is the previous calendar month.
        </p>
      </div>

      {/* Controls */}
      <div className="card p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="month-input" className="form-label mb-1.5">Month</label>
            <input
              id="month-input"
              type="month"
              value={month}
              onChange={e => setMonthAndClear(e.target.value)}
              className="form-input text-[13px]"
            />
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
              {syllabusBatches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!batch || cohort.length === 0 || generating}
            className="btn btn-primary text-[13px] min-h-[44px] px-5
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? 'Loading…' : 'Generate'}
          </button>
        </div>

        <div className="mt-3 text-[12px] text-ink-3">
          {batch
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
          <div className="text-[11px] font-mono uppercase tracking-[1.5px] text-ink-3 mb-2">
            Preview · {cohort.length} report{cohort.length !== 1 ? 's' : ''}
          </div>
          {cohort.map(profile => (
            <ReportRow
              key={profile.lwsId}
              profile={profile}
              report={reportFor(profile)}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {generated && cohort.length === 0 && (
        <div className="card px-4 py-8 text-center text-[13px] text-ink-3 italic">
          No active students in this batch are registered before {month}.
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
