// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

function makeRes() {
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
  return res
}

async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-late-notifications.js')
  const req = {
    method,
    headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
    body,
  }
  const res = makeRes()
  await handler(req, res)
  return { req, res }
}

function setEnv() {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  process.env.WABRIDGE_APP_KEY = 'app'
  process.env.WABRIDGE_AUTH_KEY = 'auth'
  process.env.WABRIDGE_DEVICE_ID = 'device'
  process.env.WABRIDGE_LATE_TEMPLATE_ID = 'late-template'
}

function setAuthOk() {
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-uid' } } }) },
  }))
}

function mockWabridge(ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(
      ok ? { status: 1, data: { messageid: 'msg1' } }
         : { status: 0, message: 'send failed' }
    ),
  }))
}

// Teachers hold real Supabase sessions and now have write UI at
// /school-attendance — so "authenticated" alone stops being a proxy for
// "admin". They capture; the office sends.
function setAuthTeacher() {
  createClient.mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'teacher-uid', app_metadata: { role: 'teacher' } } },
      }),
    },
  }))
}

describe('send-late-notifications', () => {
  it('returns 403 for a teacher session', async () => {
    setEnv(); setAuthTeacher()
    const { res } = await call({ date: '2026-05-21', students: [{ name: 'A', mobile: '9000000000' }] })
    expect(res.statusCode).toBe(403)
    expect(res.body.ok).toBe(false)
  })

  it('returns 405 for non-POST', async () => {
    const { res } = await call({}, { method: 'GET' })
    expect(res.statusCode).toBe(405)
  })

  it('returns 500 when Wabridge late template not configured', async () => {
    setAuthOk()
    const { res } = await call({ date: '2026-05-21', students: [] })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/late-template/i)
  })

  it('returns 401 when no JWT is provided', async () => {
    setEnv()
    const { res } = await call({ date: '2026-05-21', students: [] }, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when JWT is invalid', async () => {
    setEnv()
    createClient.mockImplementation(() => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    }))
    const { res } = await call({ date: '2026-05-21', students: [] })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when date or students missing', async () => {
    setEnv(); setAuthOk()
    const r1 = await call({})
    expect(r1.res.statusCode).toBe(400)
    const r2 = await call({ date: '2026-05-21' })
    expect(r2.res.statusCode).toBe(400)
  })

  it('sends to student + parents and returns a summary on happy path', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      date: '2026-05-21',
      students: [
        { name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: ['9876543211', '9876543299'] },
        { name: 'Ravi Kumar',   mobile: '9876543212', parentMobiles: [] },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.sent).toBe(4) // 2 students + 2 parents for Arjun
    expect(res.body.skipped).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('redirectTo overrides student + parent destinations', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      date: '2026-05-21',
      redirectTo: '7777777777',
      students: [
        { name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: ['9876543211'] },
      ],
    })
    const calls = fetch.mock.calls
    for (const [, init] of calls) {
      const payload = JSON.parse(init.body)
      expect(payload.destination_number).toBe('917777777777')
    }
  })

  it('counts Wabridge failures as skipped', async () => {
    setEnv(); setAuthOk(); mockWabridge(false)
    const { res } = await call({
      date: '2026-05-21',
      students: [{ name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [] }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
  })
})

// ── server-side blocked-contact gate (2026-09-12) ────────────────────────────
//
// Before this, the handler looped straight over req.body.students[] and never
// read the students table, so the preview modal's filter was the ONLY thing
// between a Block/Quit/Inactive family and a message. These pin the floor.
//
// Note the fixtures below carry `lwsId`. The pre-existing cases in this file do
// not, which is why they never reached the gate at all — a payload with no ids
// short-circuits before any query.

function setAuthWithStudents(rows, { error = null } = {}) {
  createClient.mockImplementation((_url, _key, opts) => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-uid' } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({ data: error ? null : rows, error }),
      })),
    })),
    _opts: opts,
  }))
}

describe('blocked-contact gate (server-side)', () => {
  it('does not message a Block / Quit / Inactive student even when the client asks', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents([
      { lws_id: 'LWS-1', account_status: 'Active' },
      { lws_id: 'LWS-2', account_status: 'Block' },
      { lws_id: 'LWS-3', account_status: 'Quit' },
    ])
    const { res } = await call({
      date: '2026-09-12',
      students: [
        { lwsId: 'LWS-1', name: 'Asha',  mobile: '9876543210', parentMobiles: [] },
        { lwsId: 'LWS-2', name: 'Blocked One', mobile: '9876543211', parentMobiles: [] },
        { lwsId: 'LWS-3', name: 'Quit One',    mobile: '9876543212', parentMobiles: [] },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.blocked).toBe(2)
    const transcript = res.body.lines.join('\n')
    expect(transcript).toContain('Asha')
    expect(transcript).not.toContain('Blocked One')
    expect(transcript).not.toContain('Quit One')
    expect(transcript).toContain('Excluded 2 blocked/inactive student(s).')
  })

  it('still messages a student whose status is blank or legacy (fails open)', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents([{ lws_id: 'LWS-1', account_status: '' }])
    const { res } = await call({
      date: '2026-09-12',
      students: [{ lwsId: 'LWS-1', name: 'Legacy', mobile: '9876543210', parentMobiles: [] }],
    })
    expect(res.body.blocked).toBe(0)
    expect(res.body.lines.join('\n')).toContain('Legacy')
  })

  it('still messages a student with no profile row (fails open)', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents([])
    const { res } = await call({
      date: '2026-09-12',
      students: [{ lwsId: 'LWS-GHOST', name: 'Ghost', mobile: '9876543210', parentMobiles: [] }],
    })
    expect(res.body.blocked).toBe(0)
    expect(res.body.lines.join('\n')).toContain('Ghost')
  })

  // Fails CLOSED. A guard that evaporates on a database error is not a guard —
  // this is the defect that was found in send-whatsapp.js while writing this.
  it('refuses the whole send when the status read fails', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents(null, { error: { message: 'permission denied for table students' } })
    const { res } = await call({
      date: '2026-09-12',
      students: [{ lwsId: 'LWS-1', name: 'Asha', mobile: '9876543210', parentMobiles: [] }],
    })
    expect(res.statusCode).toBe(500)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/verify account status/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()   // nothing went out
  })

  it('reads the status through a JWT-scoped client so RLS still applies', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents([{ lws_id: 'LWS-1', account_status: 'Active' }])
    await call({
      date: '2026-09-12',
      students: [{ lwsId: 'LWS-1', name: 'Asha', mobile: '9876543210', parentMobiles: [] }],
    })
    const scoped = createClient.mock.calls.find(c => c[2]?.global?.headers?.Authorization)
    expect(scoped).toBeTruthy()
    expect(scoped[2].global.headers.Authorization).toBe('Bearer valid-jwt')
  })
})
