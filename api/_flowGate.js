// The server-side floor for the per-flow WhatsApp switch (Settings → WhatsApp).
//
// The Settings toggle and the disabled trigger buttons are courtesies. This is
// the enforcement: every send path reads the LIVE faculty_state row before it
// dispatches anything, so a stale tab, a direct POST, or the mentorship cron
// (which has no browser in the path at all) cannot get past a switched-off flow.
//
// Two rules, matching api/_blockGate.js:
//   - Absent entry → ON. See src/lib/whatsappFlows.js for why.
//   - Read error → REFUSE (fail closed). A guard that evaporates when its read
//     fails is the exact defect _blockGate.js was written to stop.
//
// Callers skip the gate for a redirected test send (`redirectNorm` set) and a
// dry run: neither reaches a recipient, and faculty need both to verify a
// template before switching its flow on. Key the bypass on the PARSED redirect,
// never the raw `redirectTo` field — an unparseable number falls through to the
// real recipients in every endpoint.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative
// imports here need their file extensions.

import { isFlowEnabled, flowOffMessage } from '../src/lib/whatsappFlows.js'

export class FlowGateReadError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FlowGateReadError'
  }
}

/**
 * Is this flow switched on, according to the live faculty_state row?
 * Throws FlowGateReadError when the row cannot be read.
 *
 * @param {object} supabase any client that may read faculty_state (JWT-scoped
 *   for admin paths, service-role for the cron paths)
 * @param {string} key a WHATSAPP_FLOWS key
 */
export async function isFlowEnabledOnServer(supabase, key) {
  let result
  try {
    result = await supabase.from('faculty_state').select('data').eq('id', 1).single()
  } catch (e) {
    throw new FlowGateReadError(`Could not read the WhatsApp switch: ${e?.message ?? e}`)
  }
  const { data, error } = result ?? {}
  if (error) throw new FlowGateReadError(`Could not read the WhatsApp switch: ${error.message}`)
  if (!data) throw new FlowGateReadError('Could not read the WhatsApp switch: no faculty_state row')
  return isFlowEnabled(data.data?.whatsappFlows, key)
}

/**
 * Answer the request and return true when the flow must not send; return false
 * (writing nothing) when it may proceed.
 *
 *   enabled          → false, nothing written
 *   switched off     → 409 { ok:false, disabled:true, flow, error }   (a person pressed a button)
 *                      200 { ok:true, skipped:'disabled', flow }       (cron: an intended stop, not an outage)
 *   read error       → 500, for cron too — that one IS a fault
 *
 * Both refusals carry `sent: 0` and a `lines` array, so a client that reads
 * those fields unconditionally still renders. A refusal adds no FAIL/SKIP line:
 * `parseFailedNames` reads those as per-student failures.
 */
export async function refuseIfFlowOff(supabase, key, res, { cron = false } = {}) {
  let enabled
  try {
    enabled = await isFlowEnabledOnServer(supabase, key)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
    return true
  }
  if (enabled) return false

  const message = flowOffMessage(key)
  if (cron) {
    res.status(200).json({ ok: true, skipped: 'disabled', flow: key, sent: 0, lines: [`Skipped — ${message}.`] })
  } else {
    res.status(409).json({ ok: false, disabled: true, flow: key, sent: 0, lines: [], error: message })
  }
  return true
}
