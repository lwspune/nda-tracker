// @vitest-environment node
// The Gmail API mailer behind the marked-paper report email (2026-10-16).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildMimeMessage, gmailApiMailer } from '../_gmail.js'

const PDF = Buffer.from('%PDF-1.7\nhello\n%%EOF')
const msg = (over = {}) => ({
  to: 'student@example.com', subject: 'Your marked homework: Limits (15/20)',
  text: 'Plain body', html: '<p>Rich body</p>', filename: 'Marked - Limits.pdf', pdf: PDF, ...over,
})

// Undo the transfer encoding of one MIME part: base64 lines → bytes.
const decodePart = (mime, contentType) => {
  const start = mime.indexOf(`Content-Type: ${contentType}`)
  const body = mime.slice(mime.indexOf('\r\n\r\n', start) + 4, mime.indexOf('\r\n--', start))
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64')
}

describe('buildMimeMessage', () => {
  it('carries the recipient, sender, text, html and the PDF attachment', () => {
    const mime = buildMimeMessage({ ...msg(), from: 'connect.lwspune@gmail.com' })
    expect(mime).toMatch(/^From: LWS Pune <connect\.lwspune@gmail\.com>\r\n/m)
    expect(mime).toMatch(/^To: student@example\.com\r\n/m)
    expect(mime).toMatch(/^MIME-Version: 1\.0\r\n/m)
    expect(decodePart(mime, 'text/plain').toString('utf8')).toBe('Plain body')
    expect(decodePart(mime, 'text/html').toString('utf8')).toBe('<p>Rich body</p>')
    expect(decodePart(mime, 'application/pdf').equals(PDF)).toBe(true)
    expect(mime).toContain('filename="Marked - Limits.pdf"')
  })

  it('leaves From out when no sender is given (Gmail fills in the account)', () => {
    expect(buildMimeMessage(msg())).not.toMatch(/^From:/m)
  })

  it('encodes a subject and body that are not plain ASCII', () => {
    const mime = buildMimeMessage(msg({ subject: 'Δu ≠ 0 — Q1', text: 'θ = nπ/3' }))
    const encoded = mime.match(/^Subject: (.*)\r\n/m)[1]
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/)
    expect(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8')).toBe('Δu ≠ 0 — Q1')
    expect(decodePart(mime, 'text/plain').toString('utf8')).toBe('θ = nπ/3')
  })

  it('keeps every line within the 998-character limit', () => {
    const mime = buildMimeMessage(msg({ pdf: Buffer.alloc(200_000, 7), html: 'x'.repeat(5000) }))
    expect(Math.max(...mime.split('\r\n').map(l => l.length))).toBeLessThanOrEqual(998)
  })

  it('refuses a header that would smuggle in another header', () => {
    expect(() => buildMimeMessage(msg({ to: 'a@x.com\r\nBcc: b@y.com' }))).toThrow(/line break/)
    expect(() => buildMimeMessage(msg({ subject: 'Hi\nBcc: b@y.com' }))).toThrow(/line break/)
  })
})

describe('gmailApiMailer', () => {
  const creds = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh', sender: 'connect.lwspune@gmail.com' }
  let calls
  beforeEach(() => { calls = [] })
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = ({ token = { access_token: 'tok' }, send = { status: 200, body: { id: 'm1' } } } = {}) =>
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push([url, init])
      if (url.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => token }
      return { ok: send.status === 200, status: send.status, json: async () => send.body, text: async () => JSON.stringify(send.body) }
    }))

  it('uploads the message to Gmail with a fresh access token, once per batch', async () => {
    stubFetch()
    const mail = gmailApiMailer(creds)
    await mail(msg())
    await mail(msg({ to: 'other@example.com' }))
    const tokenCalls = calls.filter(([u]) => u.includes('oauth2'))
    const sends = calls.filter(([u]) => u.includes('gmail.googleapis.com'))
    expect(tokenCalls).toHaveLength(1)
    expect(sends).toHaveLength(2)
    const [url, init] = sends[0]
    expect(url).toBe('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'message/rfc822' })
    expect(String(init.body)).toMatch(/^To: student@example\.com\r\n/m)
  })

  it('throws Gmail\'s reason when the send is refused', async () => {
    stubFetch({ send: { status: 403, body: { error: { message: 'Request had insufficient authentication scopes.' } } } })
    await expect(gmailApiMailer(creds)(msg())).rejects.toThrow(/insufficient authentication scopes.*get_google_refresh_token/s)
  })

  it('throws when the refresh token is rejected', async () => {
    stubFetch({ token: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } })
    await expect(gmailApiMailer(creds)(msg())).rejects.toThrow(/expired or revoked/)
  })

  it('refuses to build without credentials', () => {
    expect(() => gmailApiMailer({ ...creds, refreshToken: '' })).toThrow(/GOOGLE_OAUTH_REFRESH_TOKEN/)
  })
})
