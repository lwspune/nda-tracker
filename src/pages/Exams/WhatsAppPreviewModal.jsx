import { useState, useMemo } from 'react'
import useStore from '../../store/useStore'

function useBranchOptions(studentProfiles) {
  return useMemo(() => {
    const set = new Set()
    Object.values(studentProfiles).forEach(p => { if (p.branch) set.add(p.branch) })
    return [...set].sort()
  }, [studentProfiles])
}

function buildRows(exam, studentProfiles) {
  return exam.students.map(s => {
    const profile = studentProfiles[s.name] || {}
    return {
      name:          s.name,
      lwsId:         profile.lwsId || '',
      branch:        profile.branch || '',
      mobile:        profile.mobile || '',
      parentMobiles: (profile.parentMobiles || []).join(', '),
    }
  })
}

// failedNames: string[] from previous send (SKIP + FAIL); null = first send
export default function WhatsAppPreviewModal({ exam, onClose, onConfirm, sending, failedNames }) {
  const studentProfiles = useStore(s => s.studentProfiles)
  const branchOptions   = useBranchOptions(studentProfiles)

  const isResend = failedNames !== null && failedNames !== undefined
  const failedSet = useMemo(() => new Set(failedNames || []), [failedNames])

  const [rows, setRows]         = useState(() => buildRows(exam, studentProfiles))
  const [redirectTo, setRedirectTo] = useState('')
  const [scopeAll, setScopeAll] = useState(!isResend)

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const visibleRows = scopeAll ? rows : rows.filter(r => failedSet.has(r.name))

  function handleConfirm() {
    const targetRows = visibleRows
    const edits = rows.map(r => ({
      lwsId:         r.lwsId,
      name:          r.name,
      branch:        r.branch,
      mobile:        r.mobile.replace(/\D/g, '').slice(-10),
      parentMobiles: r.parentMobiles
        .split(',')
        .map(p => p.trim().replace(/\D/g, '').slice(-10))
        .filter(Boolean),
    }))
    const studentNames = scopeAll ? null : targetRows.map(r => r.name)
    onConfirm(edits, redirectTo.trim(), studentNames)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl flex flex-col overflow-hidden"
        style={{ width: '100%', maxWidth: '860px', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div>
            <div className="text-[15px] font-bold text-ink">
              {isResend ? '💬 Resend WhatsApp Results' : '💬 Send WhatsApp Results'}
            </div>
            <div className="text-[12px] text-ink-3 mt-0.5 truncate max-w-[560px]">{exam.name}</div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none flex-shrink-0 mt-0.5"
            disabled={sending}
          >
            ×
          </button>
        </div>

        {/* Scope toggle — only shown on resend */}
        {isResend && (
          <div className="px-5 py-3 bg-amber-50 border-b border-border flex-shrink-0 flex items-center gap-4">
            <span className="text-[12px] text-amber-800 font-medium">Resend to:</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px]">
              <input
                type="radio"
                checked={!scopeAll}
                onChange={() => setScopeAll(false)}
                disabled={sending}
                className="accent-amber-600"
              />
              <span className="text-amber-900 font-medium">
                Failed &amp; skipped only ({failedNames.length})
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px]">
              <input
                type="radio"
                checked={scopeAll}
                onChange={() => setScopeAll(true)}
                disabled={sending}
                className="accent-amber-600"
              />
              <span className="text-ink">All students ({rows.length})</span>
            </label>
          </div>
        )}

        {/* Helper text */}
        {!isResend && (
          <div className="px-5 py-2.5 bg-surface-2 border-b border-border flex-shrink-0 text-[12px] text-ink-3">
            Review and edit branch, mobile, and parent numbers before sending. Changes are saved when you confirm.
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto min-h-0">
          {visibleRows.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-ink-3">
              No failed or skipped students from the previous send.
            </div>
          ) : (
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-surface-2 z-10">
                <tr>
                  {['#', 'Name', 'Branch', 'Mobile', 'Parent Mobiles (comma-separated)'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-ink-3 font-semibold border-b border-border whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, idx) => (
                  <tr
                    key={row.name}
                    className={`${idx % 2 === 0 ? '' : 'bg-surface-2'} ${!scopeAll && failedSet.has(row.name) ? 'ring-1 ring-inset ring-amber-300' : ''}`}
                  >
                    <td className="px-3 py-1.5 text-ink-3 w-8">{idx + 1}</td>
                    <td className="px-3 py-1.5 text-ink font-medium whitespace-nowrap">{row.name}</td>
                    <td className="px-3 py-1.5 w-28">
                      <select
                        value={row.branch}
                        onChange={e => updateRow(rows.indexOf(row), 'branch', e.target.value)}
                        disabled={sending}
                        className="form-input w-full text-[12px] py-1 px-2"
                      >
                        <option value="">—</option>
                        {branchOptions.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 w-36">
                      <input
                        type="text"
                        value={row.mobile}
                        onChange={e => updateRow(rows.indexOf(row), 'mobile', e.target.value)}
                        disabled={sending}
                        placeholder="10-digit"
                        className="form-input w-full text-[12px] py-1 px-2 font-mono"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={row.parentMobiles}
                        onChange={e => updateRow(rows.indexOf(row), 'parentMobiles', e.target.value)}
                        disabled={sending}
                        placeholder="e.g. 9876543210, 9123456789"
                        className="form-input w-full text-[12px] py-1 px-2 font-mono"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-ink-3 whitespace-nowrap">{visibleRows.length} students</span>
            <span className="text-ink-3 text-[11px]">·</span>
            <label className="text-[12px] text-ink-3 whitespace-nowrap">Test — redirect all to:</label>
            <input
              type="text"
              value={redirectTo}
              onChange={e => setRedirectTo(e.target.value)}
              disabled={sending}
              placeholder="10-digit mobile (optional)"
              className="form-input text-[12px] py-1 px-2 font-mono w-44"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={sending} className="btn btn-secondary text-[13px]">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={sending || visibleRows.length === 0}
              className="btn btn-primary text-[13px]"
            >
              {sending ? 'Sending…' : 'Confirm Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
