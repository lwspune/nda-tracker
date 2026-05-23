import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'

// Joins exam_absences rows with studentProfiles to produce the editable list.
// Each row carries name, mobile, parent_mobiles (for editing) + notified_at
// (for display only — drives the "Notified" badge).
function joinRows(absenceRows, studentProfiles) {
  // Build lwsId → profile lookup once. studentProfiles is keyed by name (and
  // every name_variant); collapse by lwsId so we don't hit a profile twice.
  const byLwsId = {}
  for (const p of Object.values(studentProfiles || {})) {
    if (p?.lwsId && !byLwsId[p.lwsId]) byLwsId[p.lwsId] = p
  }
  return (absenceRows || []).map(r => {
    const p = byLwsId[r.lws_id]
    return {
      lwsId:         r.lws_id,
      name:          p?.name ?? r.lws_id,
      mobile:        p?.mobile ?? '',
      parentMobiles: (p?.parentMobiles ?? []).join(', '),
      notifiedAt:    r.notified_at ?? null,
    }
  })
}

// failedNames: string[] from previous send; null = first send.
export default function ExamAbsencePreviewModal({
  exam,
  onConfirm,
  onClose,
  failedNames = null,
  sending = false,
}) {
  const studentProfiles           = useStore(s => s.studentProfiles)
  const bulkUpdateStudentContacts = useStore(s => s.bulkUpdateStudentContacts)
  const getExamAbsencesForExam    = useStore(s => s.getExamAbsencesForExam)
  const syncExamAbsences          = useStore(s => s.syncExamAbsences)

  const [rows, setRows]             = useState([])
  const [loaded, setLoaded]         = useState(false)
  const [redirectTo, setRedirectTo] = useState('')

  // On mount: read absentees from the slice. If empty (legacy exam never synced),
  // run a one-time sync and re-fetch. Self-heals without manual backfill.
  useEffect(() => {
    let cancelled = false
    let synced    = false
    async function load() {
      let data = await getExamAbsencesForExam?.(exam.id) ?? []
      if (data.length === 0 && !synced && typeof syncExamAbsences === 'function') {
        synced = true
        await syncExamAbsences(exam.id)
        data = await getExamAbsencesForExam?.(exam.id) ?? []
      }
      if (cancelled) return
      setRows(joinRows(data, studentProfiles))
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
    // Intentional: re-run when exam id changes, not when profiles tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id])

  const isResend = failedNames !== null && failedNames !== undefined
  const failedSet = useMemo(() => new Set(failedNames || []), [failedNames])
  const [scopeAll, setScopeAll] = useState(!isResend)

  const failedRows  = useMemo(() => rows.filter(r => failedSet.has(r.name)), [rows, failedSet])
  const visibleRows = scopeAll ? rows : failedRows
  const empty = loaded && visibleRows.length === 0

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  function handleConfirm() {
    const cleaned = visibleRows.map(r => ({
      lwsId: r.lwsId,
      name:  r.name,
      mobile: r.mobile.replace(/\D/g, '').slice(-10),
      parentMobiles: r.parentMobiles
        .split(',').map(p => p.trim().replace(/\D/g, '').slice(-10)).filter(Boolean),
    }))
    if (cleaned.length > 0 && typeof bulkUpdateStudentContacts === 'function') {
      bulkUpdateStudentContacts(cleaned)
    }
    onConfirm?.(cleaned, redirectTo.trim())
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl flex flex-col overflow-hidden w-full"
        style={{ maxWidth: '720px', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div>
            <div className="text-[15px] font-bold text-ink">
              {isResend ? 'Resend Exam Absence Alert' : 'Send Exam Absence Alert'}
            </div>
            <div className="text-[12px] text-ink-3 mt-0.5 truncate max-w-[560px]">{exam.name}</div>
          </div>
          <button onClick={onClose} disabled={sending} className="text-ink-3 hover:text-ink text-[20px] leading-none">×</button>
        </div>

        {isResend && (
          <div className="px-5 py-3 bg-amber-50 border-b border-border flex-shrink-0 flex items-center gap-4 flex-wrap">
            <span className="text-[12px] text-amber-800 font-medium">Resend to:</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px]">
              <input
                type="radio"
                checked={!scopeAll}
                onChange={() => setScopeAll(false)}
                disabled={sending}
                aria-label={`Failed & skipped only (${failedRows.length})`}
                className="accent-amber-600"
              />
              <span className="text-amber-900 font-medium">
                Failed &amp; skipped only ({failedRows.length})
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px]">
              <input
                type="radio"
                checked={scopeAll}
                onChange={() => setScopeAll(true)}
                disabled={sending}
                aria-label={`All students (${rows.length})`}
                className="accent-amber-600"
              />
              <span className="text-amber-900 font-medium">
                All students ({rows.length})
              </span>
            </label>
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {empty ? (
            <div className="text-[13px] text-ink-3 italic py-6 text-center">No absentees detected.</div>
          ) : !loaded ? (
            <div className="text-[13px] text-ink-3 italic py-6 text-center">Loading absentees…</div>
          ) : (
            <div className="space-y-2">
              {visibleRows.map((r) => {
                const idx = rows.indexOf(r)
                return (
                  <div key={r.lwsId || r.name} className="card px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="font-semibold text-[13px] text-ink">{r.name}</div>
                      {r.notifiedAt && (
                        <span className="text-[10px] font-mono bg-green-50 text-success border border-green-200 rounded-full px-2 py-0.5">
                          Notified
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                      <label className="flex flex-col gap-1">
                        <span className="text-ink-3 font-mono uppercase tracking-widest text-[10px]">Mobile</span>
                        <input
                          type="text"
                          value={r.mobile}
                          onChange={e => updateRow(idx, 'mobile', e.target.value)}
                          className="form-input text-[12px] min-h-[40px] px-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-ink-3 font-mono uppercase tracking-widest text-[10px]">Parent mobiles (comma-separated)</span>
                        <input
                          type="text"
                          value={r.parentMobiles}
                          onChange={e => updateRow(idx, 'parentMobiles', e.target.value)}
                          className="form-input text-[12px] min-h-[40px] px-2"
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <label className="flex items-center gap-2 mt-4">
            <span className="text-[11px] text-ink-3 font-mono uppercase tracking-widest">Redirect all to (test)</span>
            <input
              type="text"
              value={redirectTo}
              onChange={e => setRedirectTo(e.target.value)}
              aria-label="Redirect all to"
              placeholder="10-digit mobile"
              className="form-input text-[12px] min-h-[40px] px-2 w-44"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
          <button type="button" onClick={onClose} disabled={sending} className="btn text-[13px] min-h-[44px] px-4">Cancel</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={empty || !loaded || sending}
            className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending…' : 'Confirm send'}
          </button>
        </div>
      </div>
    </div>
  )
}
