import { useState } from 'react'

// Per-student card in the Monthly Reports preview list. Owns the transient
// remark text (not persisted — re-typed if the user re-generates). Calls
// onDownload(profile, remark) when the user clicks Download.
//
// `report` is the sections object from buildMonthlyReport — used here only
// for the small at-a-glance summary (counts). The full report is re-passed
// to the PDF lib on download.
export default function ReportRow({ profile, report, onDownload }) {
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)

  const examCount = report.examTable.filter(r => r.attended).length
  const absentCount = report.examTable.filter(r => !r.attended).length
  const attendance = report.attendance

  async function handleDownload() {
    setBusy(true)
    try {
      await onDownload(profile, remark)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card px-4 py-3 mb-2">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-ink truncate">{profile.name}</div>
          <div className="text-[11px] text-ink-3 font-mono">{profile.lwsId}</div>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          className="btn btn-primary text-[12px] min-h-[40px] px-3 flex-shrink-0
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-[11px]">
        <Stat label="Exams taken" value={examCount} />
        <Stat label="Missed exams" value={absentCount} tone={absentCount > 0 ? 'danger' : 'ink'} />
        <Stat
          label="Attendance"
          value={attendance.totalWorkingDays > 0 ? `${attendance.attendancePercentage}%` : '—'}
          tone={attendance.totalWorkingDays === 0 ? 'ink-3' : (attendance.attendancePercentage >= 90 ? 'success' : 'warning')}
        />
        <Stat
          label="Late days"
          value={attendance.late}
          tone={attendance.late > 0 ? 'warning' : 'ink'}
        />
      </div>

      <label className="block text-[11px] text-ink-3 font-mono uppercase tracking-widest mb-1">
        Faculty remark <span className="text-ink-3 normal-case font-sans">(optional, not saved)</span>
      </label>
      <textarea
        value={remark}
        onChange={e => setRemark(e.target.value)}
        placeholder="One-line note included in the PDF…"
        rows={2}
        className="form-input text-[12px] w-full resize-none"
        aria-label={`Remark for ${profile.name}`}
      />
    </div>
  )
}

function Stat({ label, value, tone = 'ink' }) {
  const toneClass = {
    ink:      'text-ink',
    'ink-3':  'text-ink-3',
    success:  'text-success',
    warning:  'text-warning',
    danger:   'text-danger',
  }[tone] || 'text-ink'
  return (
    <div>
      <div className="text-ink-3 font-mono uppercase tracking-widest text-[9.5px]">{label}</div>
      <div className={`font-bold text-[13px] ${toneClass}`}>{value}</div>
    </div>
  )
}
