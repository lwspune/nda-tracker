// The single Wabridge dispatcher, shared by all six sending endpoints.
//
// Extracted 2026-09-12 from six copies — five byte-identical, one differing
// only in whitespace. Every WhatsApp rule added since the first send flow
// shipped (positional {{N}} variables, ASCII-only variable text, the
// blocked-contact gate) had to be reasoned about six times over.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative
// imports here need their file extensions.

export const WABRIDGE_URL = 'https://web.wabridge.com/api/createmessage'

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ISO date -> "5 September 2026".
//
// Deliberately NOT toLocaleDateString: this string goes into a template
// variable, and Meta drops variables that look like rich formatting. Plain
// ASCII, no punctuation, no parentheses. Node's ICU data also varies by
// runtime, which would make the wire format depend on the deploy target.
export function fmtDate(d) {
  if (!d) return ''
  const parts = String(d).split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return d
  const [y, m, day] = parts
  return `${day} ${MONTHS[m - 1]} ${y}`
}

// Send one message. Resolves to { ok, detail } and NEVER throws — every caller
// runs this inside a per-recipient loop and turns the result into one FAIL/OK
// log line, so a throw would abandon the rest of the batch on a single network
// blip.
export async function sendWabridge(appKey, authKey, deviceId, templateId, destination, variables) {
  const payload = {
    'app-key':            appKey,
    'auth-key':           authKey,
    'destination_number': destination,
    'device_id':          deviceId,
    'template_id':        templateId,
    variables,
  }
  try {
    const r = await fetch(WABRIDGE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await r.json()
    if (data.status) return { ok: true,  detail: String(data.data?.messageid || 'ok') }
    return { ok: false, detail: data.message || 'Unknown error' }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
}
