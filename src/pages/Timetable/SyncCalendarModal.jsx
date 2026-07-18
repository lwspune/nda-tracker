import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import ModalShell from './ModalShell'
import { sortTeachersByName } from '../../lib/timetable'

// Calls /api/sync-calendar with the admin session JWT.
async function callSync(body) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  const headers = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
  const res = await fetch('/api/sync-calendar', { method: 'POST', headers, body: JSON.stringify(body) })
  return res.json()
}

function Stat({ label, value, tone }) {
  const color = tone === 'add' ? 'text-accent' : tone === 'del' ? 'text-red-400' : 'text-ink'
  return (
    <div>
      <div className="text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-[24px] font-bold leading-none ${color}`}>{value}</div>
    </div>
  )
}

export default function SyncCalendarModal({ onClose, teachers = [] }) {
  const [phase, setPhase] = useState('loading')   // loading | preview | applying | done | error
  const [teacherId, setTeacherId] = useState('')  // '' = all teachers
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const scopeBody = useCallback((extra) => (teacherId ? { ...extra, teacherId } : extra), [teacherId])

  const loadPreview = useCallback(async () => {
    setPhase('loading'); setError(''); setResult(null)
    try {
      const r = await callSync(scopeBody({ dryRun: true }))
      if (!r.ok) { setError(r.error || 'Dry-run failed'); setPhase('error'); return }
      setPreview(r.summary); setPhase('preview')
    } catch (e) { setError(String(e)); setPhase('error') }
  }, [scopeBody])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: run dry-run on open / scope change
  useEffect(() => { loadPreview() }, [loadPreview])

  async function apply() {
    setPhase('applying'); setError('')
    try {
      const r = await callSync(scopeBody({ dryRun: false }))
      if (!r.ok) { setError(r.error || 'Sync failed'); setPhase('error'); return }
      setResult(r); setPhase('done')
    } catch (e) { setError(String(e)); setPhase('error') }
  }

  const nothingToDo = preview && preview.create === 0 && preview.update === 0 && preview.delete === 0

  return (
    <ModalShell title="Sync teacher calendars" onClose={onClose}>
      <p className="text-[12px] text-ink-3 mb-4">
        Pushes each teacher's current teaching periods to the shared Google calendar as weekly
        busy-blocks (teacher = attendee). Releases blocks that no longer exist and adds new ones.
      </p>

      <div className="mb-4">
        <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Scope</label>
        <select
          className="input w-full text-[12px]"
          value={teacherId}
          onChange={e => setTeacherId(e.target.value)}
          disabled={phase === 'applying'}
        >
          <option value="">All teachers</option>
          {sortTeachersByName(teachers).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {!teacherId && (
          <p className="text-[10px] text-ink-3 mt-1">Tip: sync one teacher first and confirm it lands on their calendar before the full run.</p>
        )}
      </div>

      {phase === 'loading' && <div className="text-[13px] text-ink-3 py-6 text-center">Computing changes…</div>}

      {phase === 'error' && (
        <div className="space-y-3">
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-400/25 text-[12px] text-red-400">{error}</div>
          <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={loadPreview}>Retry</button>
        </div>
      )}

      {(phase === 'preview' || phase === 'applying') && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-6 px-5 py-3 rounded-lg bg-surface-2 border border-border">
            <Stat label="To add" value={preview.create} tone="add" />
            <Stat label="To update" value={preview.update} />
            <Stat label="To release" value={preview.delete} tone="del" />
          </div>
          <div className="text-[11px] text-ink-3">
            {preview.desired} teaching blocks in the timetable · {preview.ledger} currently on the calendar.
          </div>
          {nothingToDo ? (
            <div className="text-[13px] text-ink-2">✓ Calendars are already in sync — nothing to do.</div>
          ) : (
            <button
              className="btn btn-primary text-[13px] px-4 py-2 disabled:opacity-50"
              onClick={apply}
              disabled={phase === 'applying'}
            >
              {phase === 'applying' ? 'Syncing… (may take a moment)' : `Apply — add ${preview.create}, update ${preview.update}, release ${preview.delete}`}
            </button>
          )}
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-6 px-5 py-3 rounded-lg bg-surface-2 border border-border">
            <Stat label="Added" value={result.created} tone="add" />
            <Stat label="Updated" value={result.updated} />
            <Stat label="Released" value={result.deleted} tone="del" />
          </div>
          {result.errorCount > 0 ? (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-400/25">
              <div className="text-[12px] font-bold text-red-400 mb-1">{result.errorCount} error{result.errorCount !== 1 ? 's' : ''}</div>
              <ul className="text-[11px] text-red-400/80 space-y-0.5 max-h-40 overflow-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          ) : (
            <div className="text-[13px] text-ink-2">✓ Done — all changes applied cleanly.</div>
          )}
          <button className="btn text-[12px] px-3 py-1.5 border border-border" onClick={onClose}>Close</button>
        </div>
      )}
    </ModalShell>
  )
}
