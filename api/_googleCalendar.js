// Thin Google Calendar REST client for the sync endpoint.
// OAuth2 refresh-token flow on the institute account (connect.lwspune@gmail.com).
// All event writes use sendUpdates=none so the first ~360-event sync does NOT
// blast the teachers with invite emails (the event still lands on their calendar).

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars'

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
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody),
  })
  const data = await r.json().catch(() => ({}))
  if (r.status >= 300 || !data.id) return { ok: false, error: data.error?.message || `HTTP ${r.status}` }
  return { ok: true, id: data.id }
}

export async function patchEvent(token, calendarId, eventId, eventBody) {
  const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody),
  })
  const data = await r.json().catch(() => ({}))
  if (r.status >= 300) return { ok: false, error: data.error?.message || `HTTP ${r.status}` }
  return { ok: true, id: data.id || eventId }
}

export async function deleteEvent(token, calendarId, eventId) {
  const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`
  const r = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  // 200/204 = deleted; 410 Gone = already deleted (treat as success — ledger can drop it)
  if (r.status === 204 || r.status === 200 || r.status === 410) return { ok: true }
  const data = await r.json().catch(() => ({}))
  return { ok: false, error: data.error?.message || `HTTP ${r.status}` }
}
