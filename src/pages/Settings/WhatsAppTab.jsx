import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { WHATSAPP_FLOWS, isFlowEnabled } from '../../lib/whatsappFlows'

// Admin-only list of every WhatsApp send flow, with a per-flow on/off switch.
//
// The switch here is the RECORD; the enforcement is server-side
// (api/_flowGate.js), which re-reads the live faculty_state row before every
// send, the mentorship cron included. Template IDs are secrets held in Vercel,
// so this page only ever shows the env var NAME. Spec: WHATSAPP_FLOWS.md.

const RELATED_TAB = {
  monitoring: { label: 'Monitoring', hint: 'Monitoring numbers are set in the Monitoring tab.' },
  mentorship: { label: 'Mentorship', hint: 'Previews and test sends are in the Mentorship tab, and work while this is off.' },
}

const CRON_BADGE = {
  live:  { text: 'Runs automatically', tone: 'blue' },
  ready: { text: 'Schedule ready, not running', tone: 'gray' },
}

// Darker text than the shared <Badge>, whose amber and accent variants fall
// below WCAG AA contrast at this size.
const PILL_TONE = {
  green: 'bg-green-50 text-green-800 border-green-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  blue:  'bg-accent-soft text-indigo-800 border-indigo-200',
  gray:  'bg-surface-2 text-ink-2 border-border',
}

function Pill({ tone = 'gray', children }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${PILL_TONE[tone]}`}>
      {children}
    </span>
  )
}

// Is each flow's template ID set in Vercel? Only the server can tell; it answers
// with booleans (api/send-attendance-alerts.js, kind:'whatsapp-status'). Any
// failure resolves to null, rendered as "Status unknown" — never as "Not
// configured", which would be a claim the page cannot back.
async function fetchWhatsappStatus() {
  if (!supabase) return null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const r = await fetch('/api/send-attendance-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ kind: 'whatsapp-status' }),
    })
    const data = await r.json()
    return r.ok && data?.ok ? data : null
  } catch {
    return null
  }
}

function configPill(status, key) {
  if (status === 'checking') return { text: 'Checking…', tone: 'gray' }
  if (!status) return { text: 'Status unknown', tone: 'gray' }
  if (!status.configured?.[key]) return { text: 'Not configured', tone: 'amber' }
  if (!status.shared) return { text: 'Credentials missing', tone: 'amber' }
  return { text: 'Configured', tone: 'green' }
}

function variableText(variables) {
  return variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')
}

function FlowSwitch({ label, enabled, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${label} WhatsApp messages`}
      onClick={onToggle}
      className="inline-flex shrink-0 items-center gap-2 min-h-[44px] min-w-[44px] px-1 rounded-lg
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span className={`text-[12px] font-semibold ${enabled ? 'text-accent' : 'text-ink-2'}`}>
        {enabled ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-ink-2'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}

function Detail({ term, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="text-[11px] font-bold text-ink-2 uppercase tracking-wide sm:w-40 sm:flex-shrink-0 sm:pt-0.5">{term}</dt>
      {/* overflow-wrap:anywhere, not break-words: env var names have no break
          points, and break-words does not lower a flex item's min-content, so
          the card overflowed a 390px phone. */}
      <dd className="text-[13px] text-ink min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function FlowCard({ flow, enabled, onToggle, onSwitchTab, status }) {
  const titleId = `wa-flow-${flow.key}`
  const cron = CRON_BADGE[flow.cron]
  const related = RELATED_TAB[flow.settingsTab]
  const config = configPill(status, flow.key)

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className={enabled ? '' : 'bg-surface-2 border-dashed'}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[15px] font-bold text-ink">{flow.label}</h3>
          <p className="text-[13px] text-ink-2 mt-0.5">{flow.description}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone={config.tone}>{config.text}</Pill>
            {cron && <Pill tone={cron.tone}>{cron.text}</Pill>}
          </div>
        </div>
        <FlowSwitch label={flow.label} enabled={enabled} onToggle={onToggle} />
      </div>

      {!enabled && (
        <p className="text-[12px] text-red-700 font-semibold mb-3">
          {flow.cron === 'live'
            ? 'Switched off. Every send path refuses, including the automatic daily run.'
            : 'Switched off. Every send path refuses, and its send button is disabled.'}
        </p>
      )}

      <dl className="space-y-1.5">
        <Detail term="Sent to">{flow.recipients}</Detail>
        <Detail term="Triggered from">{flow.trigger}</Detail>
        <Detail term="Template variables">
          <span className="font-mono text-[12px]">{variableText(flow.variables)}</span>
        </Detail>
        <Detail term="Template ID env var">
          <span className="font-mono text-[12px]">{flow.envVar}</span>
        </Detail>
      </dl>

      {related && (
        <div className="mt-3 text-[12px] text-ink-2">
          {related.hint}{' '}
          {onSwitchTab && (
            <button
              type="button"
              onClick={() => onSwitchTab(flow.settingsTab)}
              className="underline text-accent hover:text-accent-hover rounded
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Open the {related.label} tab
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

export default function WhatsAppTab({ onSwitchTab }) {
  const whatsappFlows          = useStore(s => s.whatsappFlows)
  const setWhatsappFlowEnabled = useStore(s => s.setWhatsappFlowEnabled)

  const onCount = WHATSAPP_FLOWS.filter(f => isFlowEnabled(whatsappFlows, f.key)).length

  // 'checking' until the server answers; then its answer, or null for unknown.
  const [status, setStatus] = useState('checking')
  useEffect(() => {
    let live = true
    fetchWhatsappStatus().then(s => { if (live) setStatus(s) })
    return () => { live = false }
  }, [])

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="text-[15px] font-bold text-ink">WhatsApp messages</h2>
          <span className="text-[12px] text-ink-2">{onCount} of {WHATSAPP_FLOWS.length} on</span>
        </div>
        <p className="text-[13px] text-ink-2 leading-relaxed">
          Every WhatsApp message the tracker can send. Switching one off stops it on the server, so it
          holds for every open tab and for scheduled runs. Nothing is deleted, and switching it back on
          resumes normal sending.
        </p>
      </Card>

      {WHATSAPP_FLOWS.map(flow => {
        const enabled = isFlowEnabled(whatsappFlows, flow.key)
        return (
          <FlowCard
            key={flow.key}
            flow={flow}
            enabled={enabled}
            onToggle={() => setWhatsappFlowEnabled(flow.key, !enabled)}
            onSwitchTab={onSwitchTab}
            status={status}
          />
        )
      })}

      <Card>
        <div className="text-[11px] font-bold text-ink-2 uppercase tracking-wide mb-2">About</div>
        <ul className="text-[12px] text-ink-2 leading-relaxed list-disc pl-4 space-y-1">
          <li>Message wording is approved by Meta and kept in Wabridge, not here.</li>
          <li>To connect a flow, set its template ID env var in Vercel and redeploy.</li>
          <li>
            In local development the exam results switch is not enforced, because that path runs a
            Python script instead of the server code. The other six are enforced everywhere.
          </li>
        </ul>
      </Card>
    </div>
  )
}
