import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'

function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildRows(lateLwsIds, studentProfiles) {
  const byLwsId = {}
  for (const p of Object.values(studentProfiles)) {
    if (p?.lwsId && !byLwsId[p.lwsId]) byLwsId[p.lwsId] = p
  }
  return lateLwsIds.map(id => {
    const p = byLwsId[id]
    return {
      lwsId:         id,
      name:          p?.name ?? id,
      mobile:        p?.mobile ?? '',
      parentMobiles: (p?.parentMobiles ?? []).join(', '),
    }
  })
}

// notifiedLwsIds: string[] of already-notified students from prior sends; null = first send.
export default function LateNotificationPreviewModal({
  date,
  lateLwsIds,
  notifiedLwsIds = null,
  onConfirm,
  onClose,
  sending = false,
}) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const bulkUpdateStudentContacts = useStore(s => s.bulkUpdateStudentContacts)

  const isResend = notifiedLwsIds !== null && notifiedLwsIds !== undefined
  const notifiedSet = useMemo(() => new Set(notifiedLwsIds || []), [notifiedLwsIds])

  const [rows, setRows] = useState(() => buildRows(lateLwsIds, studentProfiles))
  const [redirectTo, setRedirectTo] = useState('')
  // On a resend, default to the pending (un-notified) students only — so students
  // added after the morning send go out with one click and nobody gets a duplicate.
  const [scopeAll, setScopeAll] = useState(!isResend)

  const pendingRows = useMemo(() => rows.filter(r => !notifiedSet.has(r.lwsId)), [rows, notifiedSet])
  const visibleRows = scopeAll ? rows : pendingRows
  const empty = visibleRows.length === 0

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
    // Persist contact edits back to the student profile so future sends use
    // the corrected numbers — mirrors WhatsAppPreviewModal's flow.
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
              {isResend ? 'Resend Morning Late Notifications' : 'Send Morning Late Notifications'}
            </div>
            <div className="text-[12px] text-ink-3 mt-0.5">{fmtDate(date)}</div>
          </div>
          <button onClick={onClose} disabled={sending} className="text-ink-3 hover:text-ink text-[20px] leading-none">×</button>
        </div>

        {/* Scope toggle — only shown on resend */}
        {isResend && (
          <div className="px-5 py-3 bg-amber-50 border-b border-border flex-shrink-0 flex items-center gap-4 flex-wrap">
            <span className="text-[12px] text-amber-800 font-medium">Send to:</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px]">
              <input
                type="radio"
                checked={!scopeAll}
                onChange={() => setScopeAll(false)}
                disabled={sending}
                aria-label={`Pending only (${pendingRows.length})`}
                className="accent-amber-600"
              />
              <span className="text-amber-900 font-medium">
                Pending only ({pendingRows.length})
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
            <div className="text-[13px] text-ink-3 italic py-6 text-center">No students to notify.</div>
          ) : (
            <div className="space-y-2">
              {visibleRows.map((r) => {
                const idx = rows.indexOf(r)
                return (
                  <div key={r.lwsId} className="card px-4 py-3">
                    <div className="font-semibold text-[13px] text-ink mb-2">{r.name}</div>
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
            disabled={empty || sending}
            className="btn btn-primary text-[13px] min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending…' : 'Confirm send'}
          </button>
        </div>
      </div>
    </div>
  )
}
