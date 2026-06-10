// Thin Google Calendar REST client for the sync endpoint.
// OAuth2 refresh-token flow on the institute account (connect.lwspune@gmail.com).
// All event writes use sendUpdates=none so a bulk sync does NOT blast teachers
// with invite emails (the event still lands on their calendar).
// Writes retry rate-limit responses with exponential backoff — the weekly window
// roll patches all ~165 events at once and Google throttles bursts.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Google rate-limit signals: HTTP 429, or 403 with a rateLimitExceeded reason.
export function isRateLimit(status, data) {
  if (status === 429) return true
  if (status !== 403) return false
  const reason = data?.error?.errors?.[0]?.reason || ''
  const msg = data?.error?.message || ''
  // Matches both the API reason `rateLimitExceeded` / `userRateLimitExceeded`
  // and the human message "Rate Limit Exceeded" (spaces).
  return /rate\s*limit\s*exceeded/i.test(`${reason} ${msg}`)
}

// Run a thunk returning {status, data}, retrying rate-limit responses with
// exponential backoff + jitter (~0.4s → 6.4s, up to 6 attempts total).
async function withRetry(doFetch) {
  let delay = 400
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch()
    if (attempt >= 5 || !isRateLimit(res.status, res.data)) return res
    await sleep(delay + Math.floor(Math.random() * delay))
    delay = Math.min(delay * 2, 8000)
  }
}

// Exchange the long-lived refresh token for a short-lived access token.
export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString()
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await r.json()
  if (!data.access_token) throw new Error('Token refresh failed: ' + (data.error_description || data.error || 'unknown'))
  return data.access_token
}

export async function insertEvent(token, calendarId, eventBody) {
  const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events?sendUpdates=none`
  const { status, data } = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  })
  if (status >= 300 || !data.id) return { ok: false, error: data.error?.message || `HTTP ${status}` }
  return { ok: true, id: data.id }
}

export async function patchEvent(token, calendarId, eventId, eventBody) {
  const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`
  const { status, data } = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  })
  if (status >= 300) return { ok: false, error: data.error?.message || `HTTP ${status}` }
  return { ok: true, id: data.id || eventId }
}

export async function deleteEvent(token, calendarId, eventId) {
  const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`
  const { status, data } = await withRetry(async () => {
    const r = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    return { status: r.status, data: r.status === 204 ? {} : await r.json().catch(() => ({})) }
  })
  // 200/204 = deleted; 410 Gone = already deleted (treat as success — ledger can drop it)
  if (status === 204 || status === 200 || status === 410) return { ok: true }
  return { ok: false, error: data.error?.message || `HTTP ${status}` }
}
