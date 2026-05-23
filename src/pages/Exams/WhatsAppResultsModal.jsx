import { useRef, useEffect } from 'react'

function lineStyle(line) {
  if (line.startsWith('  SENT'))  return { icon: '✅', color: 'text-success', bg: 'bg-green-50' }
  if (line.startsWith('  SKIP'))  return { icon: '⏭',  color: 'text-warning', bg: 'bg-amber-50' }
  if (line.startsWith('  FAIL'))  return { icon: '❌', color: 'text-danger',  bg: 'bg-red-50'   }
  if (line.startsWith('ERR:'))    return { icon: '❌', color: 'text-danger',  bg: 'bg-red-50'   }
  return { icon: '', color: 'text-ink-3', bg: '' }
}

function LogLine({ line }) {
  const { icon, color, bg } = lineStyle(line)
  const text = line.replace(/^\s+/, '')
  if (!text) return null
  return (
    <div className={`flex items-start gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono ${bg}`}>
      {icon && <span className="flex-shrink-0 text-[11px] mt-0.5">{icon}</span>}
      <span className={`${color} break-all`}>{text}</span>
    </div>
  )
}

export default function WhatsAppResultsModal({ result, onClose, recipientLabel = 'students + parents' }) {
  const logRef = useRef(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0
  }, [result])

  const visibleLines = (result.lines || []).filter(l => {
    const t = l.trim()
    return t && !t.startsWith('Exam:') && !t.startsWith('Mode:')
  })

  const isSummaryLine = l => l.trim().startsWith('Done.')
  const logLines      = visibleLines.filter(l => !isSummaryLine(l))

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden"
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border">
          <div>
            <div className="text-[15px] font-bold text-ink">
              {result.ok ? '💬 WhatsApp Sent' : '❌ Send Failed'}
            </div>
            <div className="text-[12px] text-ink-3 mt-0.5 truncate max-w-[280px]">
              {result.examName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none flex-shrink-0 mt-0.5"
          >
            ×
          </button>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-4 px-5 py-3 bg-surface-2 border-b border-border">
          {result.ok ? (
            <>
              <div className="text-center">
                <div className="text-[11px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Sent</div>
                <div className="text-[22px] font-extrabold font-mono text-success">{result.sent}</div>
              </div>
              <div className="text-ink-3 text-[18px]">·</div>
              <div className="text-center">
                <div className="text-[11px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Skipped</div>
                <div className="text-[22px] font-extrabold font-mono text-ink-3">{result.skipped}</div>
              </div>
              <div className="ml-auto text-[11px] text-ink-3">
                {recipientLabel}
              </div>
            </>
          ) : (
            <div className="text-[13px] text-danger font-medium">
              {result.error || 'Script exited with an error.'}
            </div>
          )}
        </div>

        {/* Log */}
        {logLines.length > 0 && (
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-1 min-h-0"
          >
            {logLines.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <button onClick={onClose} className="w-full btn btn-secondary text-[13px]">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
