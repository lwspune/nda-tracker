// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))
// The Google side is irrelevant to the door and needs real OAuth; stub it so a
// 200 path cannot reach the network.
vi.mock('../_googleCalendar.js', () => ({
  getAccessToken: vi.fn().mockResolvedValue('gtoken'),
  insertEvent:    vi.fn().mockResolvedValue({ id: 'evt' }),
  patchEvent:     vi.fn().mockResolvedValue({ id: 'evt' }),
  deleteEvent:    vi.fn().mockResolvedValue({}),
  isRateLimit:    vi.fn().mockReturnValue(false),
}))

// sync-calendar had NO test file at all before 2026-09-12 — it was one of nine
// endpoints hand-maintaining the same auth preamble, and on a sibling
// (send-whatsapp) the missing teacher 403 turned out to be a real gap. Each door
// gets its 401 and its 403 asserted separately, because "the feature works" has
// never been evidence that the door is locked.

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

function makeRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this },
    json(p)   { this.body = p; return this },
    setHeader() {},
  }
}

async function call(body = {}, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../sync-calendar.js')
  const req = { method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body }
  const res = makeRes()
  await handler(req, res)
  return { res }
}

function setEnv() {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret'
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN = 'rtoken'
  process.env.FACULTY_CALENDAR_ID = 'cal@group.calendar.google.com'
}

// Enough of the query builder for the handler to get PAST the door; the sync
// itself is not what these tests are about. `.single()` returns an empty
// faculty_state blob, which the handler reads as "no timetables to sync".
function setAuthAs(user) {
  const eq = () => ({
    single: () => Promise.resolve({ data: { data: {} }, error: null }),
    then: r => Promise.resolve({ data: [], error: null }).then(r),
  })
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: () => ({
      select: () => ({ eq, single: () => Promise.resolve({ data: { data: {} }, error: null }) }),
      upsert: () => Promise.resolve({ data: [], error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    }),
  }))
}

describe('sync-calendar — the auth door', () => {
  it('405s a non-POST', async () => {
    setEnv(); setAuthAs({ id: 'admin-uid' })
    const { res } = await call({}, { method: 'GET' })
    expect(res.statusCode).toBe(405)
  })

  it('401s with no session token', async () => {
    setEnv(); setAuthAs({ id: 'admin-uid' })
    const { res } = await call({}, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('401s when the token resolves to no user', async () => {
    setEnv(); setAuthAs(null)
    const { res } = await call()
    expect(res.statusCode).toBe(401)
  })

  // Calendar sync writes to the shared faculty calendar and to the
  // teacher_calendar_blocks ledger — office work, not capture.
  it('403s a teacher', async () => {
    setEnv(); setAuthAs({ id: 't-uid', app_metadata: { role: 'teacher' } })
    const { res } = await call()
    expect(res.statusCode).toBe(403)
  })

  // app_metadata only — user_metadata is writable by the account holder, so a
  // teacher must not be able to relabel their way through.
  it('403s a teacher who relabelled their own user_metadata', async () => {
    setEnv()
    setAuthAs({ id: 't-uid', app_metadata: { role: 'teacher' }, user_metadata: { role: 'admin' } })
    const { res } = await call()
    expect(res.statusCode).toBe(403)
  })

  it('does not 401 or 403 an admin session', async () => {
    setEnv(); setAuthAs({ id: 'admin-uid', app_metadata: {} })
    const { res } = await call()
    expect(res.statusCode).not.toBe(401)
    expect(res.statusCode).not.toBe(403)
  })
})
