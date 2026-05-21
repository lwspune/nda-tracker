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

describe('send-late-notifications', () => {
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
