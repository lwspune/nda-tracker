// Send email through the Gmail API (2026-10-16), as the institute account
// (connect.lwspune@gmail.com) whose OAuth refresh token the calendar sync
// already holds. The token must carry the gmail.send scope: mint it with
// get_google_refresh_token.cjs. No mail package: Node has no SMTP client, but
// Gmail's upload endpoint takes a raw RFC 5322 message over plain fetch.
//
// Underscore-prefixed, so Vercel does not count it against the function cap.
import { getAccessToken } from './_googleCalendar.js'

const SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media'
const SCOPE_HELP = 'Re-run node get_google_refresh_token.cjs (it asks for Gmail send access) and update GOOGLE_OAUTH_REFRESH_TOKEN in Vercel.'

function noBreaks(field, value) {
  const s = String(value ?? '')
  if (/[\r\n]/.test(s)) throw new Error(`The ${field} contains a line break`)
  return s
}

// RFC 2047: a header that is not plain ASCII travels base64-encoded.
function headerText(s) {
  return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`
}

// Base64, wrapped at 76 characters (RFC 2045) so no line nears the 998 limit.
function base64Lines(buf) {
  return buf.toString('base64').replace(/.{1,76}/g, '$&\r\n')
}

// { from?, to, subject, text, html, filename, pdf: Buffer } → the raw message.
export function buildMimeMessage({ from, to, subject, text, html, filename, pdf }) {
  const mixed = `mixed_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const alt = `alt_${mixed}`
  const head = [
    ...(from ? [`From: LWS Pune <${noBreaks('sender', from)}>`] : []),
    `To: ${noBreaks('recipient', to)}`,
    `Subject: ${headerText(noBreaks('subject', subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ]
  const part = (type, body) => [
    `Content-Type: ${type}`, 'Content-Transfer-Encoding: base64', '', base64Lines(body),
  ].join('\r\n')
  const name = noBreaks('file name', filename).replace(/"/g, '')
  return [
    ...head, '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, part('text/plain; charset=UTF-8', Buffer.from(String(text), 'utf8')),
    `--${alt}`, part('text/html; charset=UTF-8', Buffer.from(String(html), 'utf8')),
    `--${alt}--`, '',
    `--${mixed}`,
    `Content-Type: application/pdf; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64', '', base64Lines(pdf),
    `--${mixed}--`, '',
  ].join('\r\n')
}

// One mailer per batch: the access token is fetched once, on the first send.
// mail(message) resolves when Gmail accepts it and throws with Gmail's reason.
export function gmailApiMailer({ clientId, clientSecret, refreshToken, sender = '' }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Email is not configured: set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN.')
  }
  let token = null
  return async message => {
    token ??= getAccessToken({ clientId, clientSecret, refreshToken })
    const r = await fetch(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token}`, 'Content-Type': 'message/rfc822' },
      body: buildMimeMessage({ ...message, from: sender || undefined }),
    })
    if (r.ok) return
    let reason = `Gmail refused the message (HTTP ${r.status})`
    try { reason = (await r.json())?.error?.message || reason } catch { /* not JSON */ }
    throw new Error(r.status === 403 || r.status === 401 ? `${reason} ${SCOPE_HELP}` : reason)
  }
}
