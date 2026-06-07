import { useState, useEffect } from 'react'
import { Card, CardTitle, Badge } from '../../components/ui'
import { buildAttendanceLeaders } from '../../lib/analytics/attendanceLeaders'

// Date N days ago as YYYY-MM-DD (local). Window options for the leaderboards.
function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WINDOWS = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }]

const BOARDS = [
  { key: 'absentees',    title: '🚫 Most Absent',              unit: 'days' },
  { key: 'late',         title: '⏰ Most Late',                unit: 'days' },
  { key: 'lectureMiss',  title: '📚 Most Lectures Missed',     unit: 'lectures' },
  { key: 'homeworkMiss', title: '📝 Most Homework/Notes Missed', unit: 'items' },
]

/**
 * Dashboard "attendance leaders" — top-5 students per category over a rolling
 * window. Class-wide + Active-only (ignores the page's subject/branch/batch
 * filter chain, like the roll-up). Fetch-on-demand; not stored.
 */
export default function AttendanceLeaders({ studentProfiles, fetchAttendanceLeadersData, setActiveStudent }) {
  const [windowDays, setWindowDays] = useState(30)
  const [rows, setRows] = useState({ attendanceRows: [], lectureRows: [], homeworkRows: [] })

  useEffect(() => {
    if (typeof fetchAttendanceLeadersData !== 'function') return
    let cancelled = false
    fetchAttendanceLeadersData(isoDaysAgo(windowDays)).then(r => {
      if (!cancelled) setRows(r || { attendanceRows: [], lectureRows: [], homeworkRows: [] })
    })
    return () => { cancelled = true }
  }, [windowDays, fetchAttendanceLeadersData])

  const leaders = buildAttendanceLeaders({ ...rows, studentProfiles })

  return (
    <div className="mb-4 md:mb-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 className="text-[13px] font-bold uppercase tracking-[1px] text-ink-3">
          Attendance Leaders
          <span className="ml-2 normal-case tracking-normal font-normal text-ink-3/70">last {windowDays} days</span>
        </h2>
        <div className="flex rounded-lg bg-surface-2 border border-border p-0.5 gap-0.5">
          {WINDOWS.map(w => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all
                ${windowDays === w.days ? 'bg-accent text-white' : 'text-ink-3 hover:text-ink'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        {BOARDS.map(board => (
          <Card key={board.key}>
            <CardTitle>{board.title}</CardTitle>
            {leaders[board.key].length === 0 ? (
              <p className="text-[12px] text-ink-3 py-3">No records in this window.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {leaders[board.key].map((s, i) => (
                  <button
                    key={s.lwsId}
                    type="button"
                    onClick={() => setActiveStudent?.(s.name)}
                    className="flex items-center justify-between gap-2 py-2 text-left hover:bg-surface-2 rounded
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label={`Open ${s.name} — ${s.count} ${board.unit}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-mono text-ink-3 w-4 flex-shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-ink truncate">{s.name}</div>
                        {s.branch && <div className="text-[10px] font-mono text-ink-3">{s.branch}</div>}
                      </div>
                    </div>
                    <Badge variant="red">{s.count} {board.unit}</Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
