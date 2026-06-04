// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

function makeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this },
    json(p)   { this.body = p; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
}

async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-homework-pending.js')
  const req = { method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body }
  const res = makeRes()
  await handler(req, res)
  return { res }
}

function setEnv() {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  process.env.WABRIDGE_APP_KEY = 'app'
  process.env.WABRIDGE_AUTH_KEY = 'auth'
  process.env.WABRIDGE_DEVICE_ID = 'device'
  process.env.WABRIDGE_HOMEWORK_TEMPLATE_ID = 'homework-template'
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

describe('send-homework-pending', () => {
  it('returns 500 when WABRIDGE_HOMEWORK_TEMPLATE_ID missing', async () => {
    setAuthOk()
    const { res } = await call({ date: '2026-06-04', students: [] })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/homework/i)
  })

  it('returns 401 without a JWT', async () => {
    setEnv()
    const { res } = await call({ date: '2026-06-04', students: [] }, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when date or students missing', async () => {
    setEnv(); setAuthOk()
    const { res } = await call({ students: [] })
    expect(res.statusCode).toBe(400)
  })

  it('skips students with no items', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      date: '2026-06-04',
      students: [{ name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [], items: [] }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
    expect(res.body.lines.some(l => /no items/i.test(l))).toBe(true)
  })

  it('sends one message per (item × destination) with 4 positional variables', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      date: '2026-06-04',
      students: [
        {
          name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: ['9876543211'],
          items: [
            { subject: 'Maths',   chapter: 'Trigonometry', type: 'both' },
            { subject: 'Physics', chapter: 'Kinematics',   type: 'notes' },
          ],
        },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(4) // 2 items × (student + 1 parent)
    // Last message: item 2 → parent. Variables: [name, subject, topic, type]
    const payload = JSON.parse(fetch.mock.calls.at(-1)[1].body)
    expect(payload.variables).toEqual(['Arjun Sharma', 'Physics', 'Kinematics', 'Notes'])
  })

  it('renders Homework / Notes / both type labels', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      date: '2026-06-04',
      students: [
        { name: 'A', mobile: '9876543210', parentMobiles: [], items: [
          { subject: 'Maths', chapter: 'Circles', type: 'homework' },
          { subject: 'Maths', chapter: 'Lines',   type: 'notes' },
          { subject: 'Maths', chapter: 'Sets',    type: 'both' },
        ] },
      ],
    })
    expect(JSON.parse(fetch.mock.calls[0][1].body).variables).toEqual(['A', 'Maths', 'Circles', 'Homework'])
    expect(JSON.parse(fetch.mock.calls[1][1].body).variables).toEqual(['A', 'Maths', 'Lines', 'Notes'])
    expect(JSON.parse(fetch.mock.calls[2][1].body).variables).toEqual(['A', 'Maths', 'Sets', 'Homework and Notes'])
  })

  it('sanitises unicode dashes and newlines in free-text fields to ASCII', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      date: '2026-06-04',
      students: [
        { name: 'A', mobile: '9876543210', parentMobiles: [], items: [{ subject: 'Maths', chapter: 'Limits — and\nContinuity', type: 'notes' }] },
      ],
    })
    const topic = JSON.parse(fetch.mock.calls[0][1].body).variables[2]
    expect(topic).toBe('Limits - and Continuity')
    expect(topic).not.toMatch(/[\n—]/)
  })

  it('counts Wabridge failures as skipped', async () => {
    setEnv(); setAuthOk(); mockWabridge(false)
    const { res } = await call({
      date: '2026-06-04',
      students: [{ name: 'A', mobile: '9876543210', parentMobiles: [], items: [{ subject: 'Maths', chapter: 'X', type: 'both' }] }],
    })
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
  })
})
