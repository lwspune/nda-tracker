const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function parseTimeToMinutes(str) {
  if (!str) return null
  const s = str.trim().toUpperCase()
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = parseInt(m12[2], 10)
    if (min >= 60 || h < 1 || h > 12) return null
    if (m12[3] === 'PM' && h !== 12) h += 12
    if (m12[3] === 'AM' && h === 12) h = 0
    return h * 60 + min
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10), min = parseInt(m24[2], 10)
    if (h > 23 || min >= 60) return null
    return h * 60 + min
  }
  return null
}

export default function TimetableGrid({ timetable, mappings, teachers = [], onCellClick, readOnly = false }) {
  if (!timetable) return null

  const { grid } = timetable
  const timeSlots = [...timetable.timeSlots].sort(
    (a, b) => (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0)
  )

  function getMapping(mappingId) {
    return mappings.find(m => m.id === mappingId) ?? null
  }

  function getTeacherName(teacherId) {
    if (!teacherId) return null
    return teachers.find(t => t.id === teacherId)?.name ?? null
  }

  function cellContent(slotId, day) {
    const cell = grid[slotId]?.[day]
    if (!cell) return null
    if (cell.type === 'class') {
      const m = getMapping(cell.mappingId)
      if (!m) return { kind: 'class', subject: '—', teacher: null }
      return {
        kind: 'class',
        subject: m.subject || m.label,
        teacher: getTeacherName(m.teacherId),
      }
    }
    if (cell.type === 'break') return { kind: 'break', label: cell.label || 'Break' }
    return null
  }

  function cellStyle(slotId, day) {
    const cell = grid[slotId]?.[day]
    if (!cell) return 'bg-surface hover:bg-surface-2'
    if (cell.type === 'break') return 'bg-yellow-50/60 text-yellow-700'
    return 'bg-accent-soft text-accent'
  }

  if (timeSlots.length === 0) {
    return (
      <div className="text-center py-10 text-[13px] text-ink-3 italic">
        No time slots yet.{!readOnly && ' Add a slot below.'}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-collapse text-[12px] min-w-[640px]">
        <thead>
          <tr>
            <th className="border border-border bg-surface-2 px-3 py-2 text-left font-bold text-ink-2 text-[11px] uppercase tracking-wide w-[130px]">
              Time
            </th>
            {DAYS.map(day => (
              <th key={day} className="border border-border bg-surface-2 px-2 py-2 font-bold text-ink-2 text-[11px] uppercase tracking-wide text-center">
                {day.slice(0, 3)}
              </th>
            ))}
            {!readOnly && (
              <th className="border border-border bg-surface-2 w-6" />
            )}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map(slot => {
            const span = grid[slot.id]?.['__span']
            return (
              <tr key={slot.id}>
                <td className="border border-border px-3 py-2 font-semibold text-ink-2 whitespace-nowrap bg-surface-2/50">
                  <div className="text-[11px]">{slot.startTime}</div>
                  <div className="text-[10px] text-ink-3">to {slot.endTime}</div>
                </td>

                {span ? (
                  <td
                    colSpan={DAYS.length}
                    className={`border border-border px-3 py-2 text-center font-semibold text-[12px]
                      ${!readOnly ? 'cursor-pointer hover:opacity-80' : ''}
                      bg-slate-100 text-slate-600`}
                    onClick={!readOnly ? () => onCellClick?.(slot.id, '__span', span) : undefined}
                  >
                    {span.label || 'Break'}
                  </td>
                ) : (
                  DAYS.map(day => {
                    const content = cellContent(slot.id, day)
                    return (
                      <td
                        key={day}
                        className={`border border-border px-2 py-2 text-center transition-colors
                          ${cellStyle(slot.id, day)}
                          ${!readOnly ? 'cursor-pointer' : ''}
                        `}
                        onClick={!readOnly ? () => onCellClick?.(slot.id, day, grid[slot.id]?.[day]) : undefined}
                      >
                        {content?.kind === 'class' && (
                          <>
                            <div className="text-[11px] font-medium leading-snug">{content.subject}</div>
                            {content.teacher && (
                              <div className="text-[10px] text-ink-3 leading-snug mt-0.5">{content.teacher}</div>
                            )}
                          </>
                        )}
                        {content?.kind === 'break' && (
                          <span className="text-[11px] font-medium leading-snug">{content.label}</span>
                        )}
                      </td>
                    )
                  })
                )}

                {!readOnly && (
                  <td className="border border-border px-1 text-center">
                    {/* slot delete handled by parent */}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
