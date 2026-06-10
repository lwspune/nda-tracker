/*
 * create_faculty_calendar.cjs — create (or reuse) the "LWS Faculty Timetable"
 * secondary calendar on connect.lwspune@gmail.com and write its id to .env.local
 * as FACULTY_CALENDAR_ID. Idempotent: reuses an existing calendar of that name.
 *
 * Needs GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN in .env.local.
 * Run:  node create_faculty_calendar.cjs
 */
const https = require('https')
const { readFileSync, writeFileSync, existsSync } = require('fs')
const { URLSearchParams } = require('url')

const CAL_NAME = 'LWS Faculty Timetable'

function readEnvLocal() {
  const out = {}
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* none */ }
  return out
}
const env = { ...readEnvLocal(), ...process.env }
for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']) {
  if (!env[k]) { console.error(`Missing ${k} in .env.local`); process.exit(1) }
}

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, { method, headers }, res => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: d ? JSON.parse(d) : {} }) }
        catch { resolve({ status: res.statusCode, json: {}, raw: d }) }
      })
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }).toString()
  const { json } = await req('POST', 'https://oauth2.googleapis.com/token',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body)
  if (!json.access_token) throw new Error('No access_token: ' + JSON.stringify(json))
  return json.access_token
}

function writeEnv(id) {
  let body = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
  const line = `FACULTY_CALENDAR_ID=${id}`
  if (/^FACULTY_CALENDAR_ID=.*$/m.test(body)) body = body.replace(/^FACULTY_CALENDAR_ID=.*$/m, line)
  else body = body.replace(/\s*$/, '') + '\n' + line + '\n'
  writeFileSync('.env.local', body)
}

;(async () => {
  const token = await getAccessToken()
  const auth = { Authorization: `Bearer ${token}` }

  // Reuse if a calendar of this name already exists (idempotent re-runs).
  const list = await req('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList', auth)
  const existing = (list.json.items || []).find(c => c.summary === CAL_NAME)
  if (existing) {
    writeEnv(existing.id)
    console.log(`✅ Reused existing "${CAL_NAME}". Wrote FACULTY_CALENDAR_ID to .env.local\n   id: ${existing.id}`)
    return
  }

  const body = JSON.stringify({ summary: CAL_NAME, timeZone: 'Asia/Kolkata' })
  const created = await req('POST', 'https://www.googleapis.com/calendar/v3/calendars',
    { ...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body)
  if (created.status >= 300 || !created.json.id) {
    console.error('Failed to create calendar:', created.status, created.json); process.exit(1)
  }
  writeEnv(created.json.id)
  console.log(`✅ Created "${CAL_NAME}". Wrote FACULTY_CALENDAR_ID to .env.local\n   id: ${created.json.id}`)
})().catch(e => { console.error(e); process.exit(1) })
