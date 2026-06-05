import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'

// Top-of-Attendance widget. Faculty marks "late to first lecture" students in the
// morning. Each add/remove writes/deletes a status='L' row in student_attendance.
// "Send Morning Late Notifications" hands the list of lws_ids back to the parent.
export default function LateMarkingWidget({ date, onSend }) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const markLate = useStore(s => s.markLate)
  const unmarkLate = useStore(s => s.unmarkLate)
  const getLateStudentsForDate = useStore(s => s.getLateStudentsForDate)
  const history = useStore(s => s.lateSendHistory?.[date] ?? null)

  const [lateIds, setLateIds] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  // Unique profile list (studentProfiles is keyed by canonical + variants)
  const uniqueProfiles = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const p of Object.values(studentProfiles)) {
      if (!p?.lwsId || seen.has(p.lwsId)) continue
      seen.add(p.lwsId)
      out.push(p)
    }
    return out
  }, [studentProfiles])

  const lwsIdToProfile = useMemo(() => {
    const map = {}
    for (const p of uniqueProfiles) map[p.lwsId] = p
    return map
  }, [uniqueProfiles])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    getLateStudentsForDate(date).then(ids => {
      if (!cancelled) {
        setLateIds(ids)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [date, getLateStudentsForDate])

  const lateSet = useMemo(() => new Set(lateIds), [lateIds])

  // Who has already been notified today (persisted from prior sends). "Pending" =
  // marked-late chips that haven't been successfully notified yet — covers both
  // never-sent (added after a send) and previously-failed students.
  const notifiedSet = useMemo(() => new Set(history?.notifiedLwsIds || []), [history])
  const pendingIds = useMemo(() => lateIds.filter(id => !notifiedSet.has(id)), [lateIds, notifiedSet])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return uniqueProfiles
      .filter(p => !lateSet.has(p.lwsId))
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, uniqueProfiles, lateSet])

  async function handleAdd(lwsId) {
    const ok = await markLate(lwsId, date)
    if (ok) {
      setLateIds(prev => [...prev, lwsId])
      setQuery('')
    }
  }

  async function handleRemove(lwsId) {
    const ok = await unmarkLate(lwsId, date)
    if (ok) setLateIds(prev => prev.filter(id => id !== lwsId))
  }

  return (
    <div className="card px-5 py-4 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-[12px] font-mono uppercase tracking-widest text-ink-3">
          Today's late arrivals
        </h3>
        {(() => {
          // No send yet today → first-send button.
          if (!history) {
            return (
              <button
                type="button"
                onClick={() => onSend?.(lateIds)}
                disabled={lateIds.length === 0 || loading}
                className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send Morning Late Notifications"
              >
                Send Morning Late Notifications
                {lateIds.length > 0 && <span className="ml-2 opacity-80">({lateIds.length})</span>}
              </button>
            )
          }
          // A send happened, but some marked-late students aren't notified yet
          // (added afterwards, or a leg failed) → primary "Notify N pending".
          if (pendingIds.length > 0) {
            return (
              <button
                type="button"
                onClick={() => onSend?.(lateIds)}
                disabled={loading}
                className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Notify ${pendingIds.length} pending`}
              >
                Notify {pendingIds.length} pending
              </button>
            )
          }
          // Everyone currently marked late has been notified.
          return (
            <button
              type="button"
              onClick={() => onSend?.(lateIds)}
              disabled={lateIds.length === 0 || loading}
              className="btn text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="All notified · Resend all"
            >
              ✓ All {lateIds.length} notified · Resend all
            </button>
          )
        })()}
      </div>

      {/* Search box */}
      <div className="relative mb-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search student by name…"
          aria-label="Search student to mark late"
          className="form-input w-full text-[13px] min-h-[44px] px-3"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-64 overflow-auto">
            {matches.map(p => (
              <button
                key={p.lwsId}
                type="button"
                onClick={() => handleAdd(p.lwsId)}
                aria-label={`Add ${p.name}`}
                className="block w-full text-left px-4 py-2.5 text-[13px] hover:bg-accent-soft transition-colors min-h-[44px]"
              >
                <span className="font-medium text-ink">{p.name}</span>
                <span className="text-[11px] text-ink-3 font-mono ml-2">{p.lwsId}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chips */}
      {loading ? (
        <div className="text-[12px] text-ink-3 italic">Loading…</div>
      ) : lateIds.length === 0 ? (
        <div className="text-[12px] text-ink-3 italic">No students marked late.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {lateIds.map(id => {
            const p = lwsIdToProfile[id]
            const name = p?.name ?? id
            const notified = notifiedSet.has(id)
            return (
              <span
                key={id}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-300"
                title={notified ? 'Notified' : 'Not notified yet'}
              >
                {notified && <span className="text-[12px] text-green-600" aria-label="notified">✓</span>}
                <span className="text-[13px] font-semibold text-ink">{name}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(id)}
                  aria-label={`Remove ${name}`}
                  className="text-[16px] leading-none text-ink-3 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded min-w-[24px] min-h-[24px]"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
