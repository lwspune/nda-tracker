import { useState } from 'react'
import { Card } from '../../components/ui'
import { supabase } from '../../lib/supabase'

// Calls the admin POST path of /api/send-mentor-nudges with the current session.
async function callNudges(body) {
  if (!supabase) return { ok: false, error: 'Supabase not configured locally — run via Vercel or npm run dev with .env.local.' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'Sign in as admin first.' }
  try {
    const r = await fetch('/api/send-mentor-nudges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    return await r.json()
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

export default function MentorshipTab() {
  const [busy, setBusy] = useState(false)
  const [testMobile, setTestMobile] = useState('')
  const [result, setResult] = useState(null) // { kind, data }

  async function run(body, kind) {
    setBusy(true)
    setResult(null)
    const data = await callNudges(body)
    setBusy(false)
    setResult({ kind, data })
  }

  // force:true bypasses the Mon–Fri gate so you can preview/test any day.
  const dryRun   = () => run({ dryRun: true, force: true }, 'dry')
  const testSend = () => {
    if (testMobile.replace(/\D/g, '').length < 10) return
    run({ redirectTo: testMobile, force: true }, 'test')
  }

  const data = result?.data

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Mentorship nudges</div>
        <p className="text-[13px] text-ink-2 leading-relaxed mb-3">
          Each weekday morning every mentor is sent 3 mentees to check in with, rotating so everyone is
          covered before anyone repeats. This runs automatically (Mon–Fri). Use the tools below to preview
          today's picks or send yourself a test — neither advances the live rotation.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={dryRun}
            disabled={busy}
          >{busy ? 'Working…' : 'Preview today’s picks'}</button>

          <span className="text-ink-3 text-[12px] mx-1">or send a real test message to:</span>
          <input
            className="input text-[13px] w-40"
            placeholder="10-digit mobile"
            type="tel"
            inputMode="numeric"
            value={testMobile}
            onChange={e => setTestMobile(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && testSend()}
          />
          <button
            className="btn px-4 text-[12px] min-h-[36px] border border-border disabled:opacity-40"
            onClick={testSend}
            disabled={busy || testMobile.replace(/\D/g, '').length < 10}
          >Send test</button>
        </div>
      </Card>

      {result && (
        <Card>
          {!data?.ok ? (
            <div className="text-[13px] text-red-600">{data?.error || 'Request failed'}</div>
          ) : data.skipped === 'weekend' ? (
            <div className="text-[13px] text-ink-2">{data.lines?.[0]}</div>
          ) : (
            <>
              <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">
                {result.kind === 'dry'
                  ? `Today’s picks — ${data.today}`
                  : `Test send — ${data.today} (redirected, rotation untouched)`}
              </div>

              {result.kind === 'dry' && Array.isArray(data.planned) && (
                data.planned.length === 0
                  ? <p className="text-[13px] text-ink-3 italic">No picks — every mentor's round is already complete for today, or no active mentees.</p>
                  : (
                    <div className="divide-y divide-border mb-3">
                      {data.planned.map((p, i) => (
                        <div key={i} className="py-2 flex items-baseline gap-3">
                          <div className="text-[13px] font-medium w-32 shrink-0">{p.teacher}</div>
                          <div className="text-[13px] text-ink-2">{p.students.join(', ')}</div>
                        </div>
                      ))}
                    </div>
                  )
              )}

              {Array.isArray(data.lines) && (
                <pre className="text-[11px] text-ink-3 bg-surface-2 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                  {data.lines.join('\n')}
                </pre>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  )
}
