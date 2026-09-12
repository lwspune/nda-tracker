// The single reader of local dev environment variables.
//
// Extracted 2026-09-12 from eleven identical private copies — one at the top of
// every endpoint.
//
// `.env.local` wins over `process.env`: locally that file IS the override, and
// on Vercel it does not exist, so every value comes from `process.env` and the
// read is a silent no-op. A missing key reads as '' rather than undefined
// because every call site tests it with a plain falsy check before failing
// closed with a 500 config error.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative
// imports here need their file extensions.

import { readFileSync } from 'fs'

export function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf-8')
        .split('\n')
        // [A-Z0-9_] — digits allowed. The eleven private copies disagreed here:
        // eight used [A-Z_], three (sync-calendar, send-mentor-nudges,
        // send-attendance-alerts) allowed digits. No key in use today carries
        // one, so the two behaved identically, but the permissive pattern is the
        // strict superset — the narrow one can only ever fail to read a key.
        .map(l => l.match(/^([A-Z0-9_]+)=(.*)/))
        .filter(Boolean)
        .map(m => [m[1], m[2].trim()])
    )
  } catch { return {} }
}

// `const pick = envReader()` then `pick('WABRIDGE_APP_KEY')`. Reads the file
// once per reader, not once per key — build it at the top of a handler and
// reuse it.
export function envReader() {
  const env = readEnvLocal()
  return k => env[k] || process.env[k] || ''
}
