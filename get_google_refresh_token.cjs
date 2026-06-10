/*
 * get_google_refresh_token.js — one-time helper to mint a durable Google
 * Calendar refresh token for the institute account (connect.lwspune@gmail.com).
 *
 * Prereqs (do these in Google Cloud Console first):
 *   - Google Calendar API enabled
 *   - OAuth consent screen: External, PUBLISHED to Production, scope .../auth/calendar
 *   - An OAuth client of type "Desktop app"
 *
 * Setup: add these two lines to .env.local (the secret stays out of chat / git):
 *   GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
 *   GOOGLE_OAUTH_CLIENT_SECRET=xxxx
 *
 * Run:  node get_google_refresh_token.js
 *   → opens a consent URL; sign in as connect.lwspune@gmail.com, click through the
 *     "unverified app" warning, allow Calendar access. The script prints the
 *     refresh_token. Paste it into .env.local as GOOGLE_OAUTH_REFRESH_TOKEN.
 *
 * Zero npm deps — uses only Node's http/https.
 */
const http = require('http')
const https = require('https')
const { readFileSync, writeFileSync, existsSync } = require('fs')
const { URL, URLSearchParams } = require('url')

const PORT = 53682
const REDIRECT = `http://localhost:${PORT}`
const SCOPE = 'https://www.googleapis.com/auth/calendar'

function readEnvLocal() {
  const out = {}
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no file */ }
  return out
}

const env = { ...readEnvLocal(), ...process.env }
const CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = env.GOOGLE_OAUTH_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local')
  process.exit(1)
}

function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  }).toString()
  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://oauth2.googleapis.com/token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token every run
}).toString()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT)
  const code = url.searchParams.get('code')
  if (!code) { res.writeHead(400); res.end('No code'); return }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<h2>Done — you can close this tab and return to the terminal.</h2>')
  server.close()
  try {
    const tok = await exchangeCode(code)
    if (tok.refresh_token) {
      // Write straight into .env.local (replace existing line if present) — no copy-paste.
      let body = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
      const line = `GOOGLE_OAUTH_REFRESH_TOKEN=${tok.refresh_token}`
      if (/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(body)) {
        body = body.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, line)
      } else {
        body = body.replace(/\s*$/, '') + '\n' + line + '\n'
      }
      writeFileSync('.env.local', body)
      const masked = tok.refresh_token.slice(0, 6) + '…' + tok.refresh_token.slice(-4)
      console.log(`\n✅ SUCCESS. Wrote GOOGLE_OAUTH_REFRESH_TOKEN (${masked}) to .env.local`)
      console.log('   (also add it to Vercel env for production)\n')
    } else {
      console.error('\n⚠️ No refresh_token returned. Response:\n', tok)
      console.error('Tip: revoke prior access at https://myaccount.google.com/permissions then re-run.')
    }
  } catch (e) {
    console.error('Token exchange failed:', e)
  }
})

server.listen(PORT, () => {
  console.log('\n1. Open this URL in your browser (sign in as connect.lwspune@gmail.com):\n')
  console.log(authUrl + '\n')
  console.log(`2. After allowing, you'll be redirected to ${REDIRECT} and the token prints here.\n`)
})
