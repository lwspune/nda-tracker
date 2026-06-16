import { useState } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'

// Admin-only editor for the WhatsApp-result monitoring numbers. On every real
// result blast a copy of one random student's message is sent to each of these
// numbers (see api/send-whatsapp.js). Stored in `monitorMobiles` via
// `setMonitorMobiles` (configSlice). Test sends (redirect-to) never trigger a
// monitoring copy.
export default function MonitoringTab() {
  const monitorMobiles    = useStore(s => s.monitorMobiles)
  const setMonitorMobiles = useStore(s => s.setMonitorMobiles)

  const [newNumber, setNewNumber] = useState('')
  const [error, setError]         = useState('')

  function handleAdd() {
    const digits = newNumber.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) { setError('Enter a valid 10-digit mobile number'); return }
    if (monitorMobiles.includes(digits)) { setError(`${digits} is already on the list`); return }
    setMonitorMobiles([...monitorMobiles, digits])
    setNewNumber('')
    setError('')
  }

  function handleRemove(num) {
    setMonitorMobiles(monitorMobiles.filter(n => n !== num))
    setError('')
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add monitoring number</div>
        <div className="flex gap-2">
          <input
            className="input flex-1 text-[13px] font-mono"
            placeholder="10-digit mobile"
            value={newNumber}
            onChange={e => { setNewNumber(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newNumber.trim()}
          >Add</button>
        </div>
        {error && <div className="text-[12px] text-red-500 mt-2">{error}</div>}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">
          Monitoring numbers ({monitorMobiles.length})
        </div>
        {monitorMobiles.length === 0 ? (
          <p className="text-[13px] text-ink-3 italic">
            No monitoring numbers — result blasts go out with no monitoring copy.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {monitorMobiles.map(num => (
              <span
                key={num}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-surface-2 border border-border text-[13px] font-mono"
              >
                {num}
                <button
                  className="text-ink-3 hover:text-red-500 text-[14px] leading-none w-5 h-5 rounded-full hover:bg-red-50 flex items-center justify-center"
                  onClick={() => handleRemove(num)}
                  aria-label={`Remove ${num}`}
                  title="Remove"
                >×</button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">About</div>
        <p className="text-[12px] text-ink-3 leading-relaxed">
          When you send WhatsApp exam results, a copy of <strong>one random student's</strong> result message is
          also delivered to every number listed here. This is purely to monitor that the send pipeline is working —
          it does not affect what students or parents receive. Test sends (using the “redirect all to” field) never
          trigger a monitoring copy.
        </p>
      </Card>
    </div>
  )
}
