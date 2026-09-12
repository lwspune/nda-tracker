// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWabridge, fmtDate, WABRIDGE_URL, MONTHS } from '../_wabridge.js'

// The single Wabridge dispatcher, shared by all six sending endpoints.
//
// It existed as six copies (five byte-identical, one differing only in
// whitespace) until 2026-09-12. Every WhatsApp rule since — positional
// variables, ASCII-only text, the blocked-contact gate — had to be reasoned
// about six times. These cases pin the wire shape and, above all, the
// never-throw contract: each endpoint loops over recipients and a thrown error
// would abandon the rest of the batch mid-send.

const okBody = { status: true, data: { messageid: 'MID-123' } }

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

function stubFetch(impl) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('sendWabridge', () => {
  it('POSTs the positional payload Wabridge expects', async () => {
    const spy = stubFetch(async () => ({ json: async () => okBody }))

    await sendWabridge('APP', 'AUTH', 'DEV', 'TPL', '919876543210', ['Asha', '5 Sep 2026'])

    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe(WABRIDGE_URL)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      'app-key': 'APP',
      'auth-key': 'AUTH',
      'destination_number': '919876543210',
      'device_id': 'DEV',
      'template_id': 'TPL',
      variables: ['Asha', '5 Sep 2026'],
    })
  })

  it('reports ok with the message id on success', async () => {
    stubFetch(async () => ({ json: async () => okBody }))
    expect(await sendWabridge('a', 'b', 'c', 'd', '919876543210', []))
      .toEqual({ ok: true, detail: 'MID-123' })
  })

  it('falls back to "ok" when the response carries no message id', async () => {
    stubFetch(async () => ({ json: async () => ({ status: true }) }))
    expect(await sendWabridge('a', 'b', 'c', 'd', '919876543210', []))
      .toEqual({ ok: true, detail: 'ok' })
  })

  it('reports not-ok with the provider message when status is false', async () => {
    stubFetch(async () => ({ json: async () => ({ status: false, message: 'template not approved' }) }))
    expect(await sendWabridge('a', 'b', 'c', 'd', '919876543210', []))
      .toEqual({ ok: false, detail: 'template not approved' })
  })

  it('reports not-ok with a placeholder when the provider gives no message', async () => {
    stubFetch(async () => ({ json: async () => ({ status: false }) }))
    expect(await sendWabridge('a', 'b', 'c', 'd', '919876543210', []))
      .toEqual({ ok: false, detail: 'Unknown error' })
  })

  // Load-bearing: every caller runs this inside a `for (const row of students)`
  // loop and turns the result into one FAIL/OK log line. A throw here would
  // abandon every recipient after the first network blip.
  it('never throws — a network failure resolves to not-ok', async () => {
    stubFetch(async () => { throw new Error('ECONNRESET') })
    const r = await sendWabridge('a', 'b', 'c', 'd', '919876543210', [])
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('ECONNRESET')
  })

  it('never throws when the response body is not JSON', async () => {
    stubFetch(async () => ({ json: async () => { throw new SyntaxError('Unexpected token A') } }))
    const r = await sendWabridge('a', 'b', 'c', 'd', '919876543210', [])
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('Unexpected token A')
  })
})

describe('fmtDate', () => {
  it('renders an ISO date as the ASCII long form the templates carry', () => {
    expect(fmtDate('2026-09-05')).toBe('5 September 2026')
    expect(fmtDate('2026-01-31')).toBe('31 January 2026')
  })

  // Meta drops template variables that look like rich formatting, so the month
  // name must stay plain ASCII — never a locale-formatted string, which is why
  // these endpoints do not use toLocaleDateString.
  it('emits ASCII only', () => {
    expect(/^[\x20-\x7E]+$/.test(fmtDate('2026-09-05'))).toBe(true)
    expect(MONTHS).toHaveLength(12)
  })

  it('returns the input unchanged when it is not a 3-part numeric date', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date')
    expect(fmtDate('2026-09')).toBe('2026-09')
  })

  it('returns an empty string for empty input', () => {
    expect(fmtDate('')).toBe('')
    expect(fmtDate(null)).toBe('')
    expect(fmtDate(undefined)).toBe('')
  })
})
