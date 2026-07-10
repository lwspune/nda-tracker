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

// send-lecture-absences was merged into send-attendance-alerts.js (dispatched by
// body.kind==='lecture') to stay under Vercel's 12-function Hobby cap.
async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-attendance-alerts.js')
  const req = { method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: { kind: 'lecture', ...body } }
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
  process.env.WABRIDGE_LECTURE_MISS_TEMPLATE_ID = 'lecture-template'
}

// `leaveRows` = rows the leaves query returns (each { lws_id }); default none.
// The handler reads leaves via `.from('leaves').select('lws_id').lte(...).or(...)`.
function setAuthOk(leaveRows = []) {
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-uid' } } }) },
    from: () => ({
      select: () => ({
        lte: () => ({ or: () => Promise.resolve({ data: leaveRows, error: null }) }),
      }),
    }),
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

describe('send-lecture-absences', () => {
  it('returns 500 when WABRIDGE_LECTURE_MISS_TEMPLATE_ID missing', async () => {
    setAuthOk()
    const { res } = await call({ date: '2026-05-21', students: [] })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/lecture-miss/i)
  })

  it('returns 401 without a JWT', async () => {
    setEnv()
    const { res } = await call({ date: '2026-05-21', students: [] }, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('skips students with empty subjects', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      date: '2026-05-21',
      students: [{ name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [], subjects: [] }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
    expect(res.body.lines.some(l => /no subjects/i.test(l))).toBe(true)
  })

  it('sends one message per parent with subjects in variables', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      date: '2026-05-21',
      students: [
        {
          name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: ['9876543211'],
          subjects: [
            { subject: 'Maths',   startTime: '9:00 AM',  endTime: '10:00 AM' },
            { subject: 'Physics', startTime: '10:00 AM', endTime: '11:00 AM' },
          ],
        },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(2) // student + 1 parent
    const lastCall = fetch.mock.calls.at(-1)
    const payload = JSON.parse(lastCall[1].body)
    // Multiple subjects → comma-joined, single line. Meta drops messages
    // whose template variables contain newlines or paren+colon patterns.
    expect(payload.variables).toEqual([
      'Arjun Sharma',
      '21 May 2026',
      'Maths 9:00 AM to 10:00 AM, Physics 10:00 AM to 11:00 AM',
    ])
  })

  it('renders a single subject inline (no dashed list)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      date: '2026-05-21',
      students: [
        {
          name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [],
          subjects: [{ subject: 'Maths', startTime: '9:00 AM', endTime: '10:00 AM' }],
        },
      ],
    })
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload.variables[2]).toBe('Maths 9:00 AM to 10:00 AM')
  })

  it('falls back to the bare subject when time info is missing (drift case)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      date: '2026-05-21',
      students: [
        {
          name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [],
          subjects: [{ subject: 'English' }], // no times
        },
      ],
    })
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload.variables[2]).toBe('English')
  })

  it('accepts legacy string subjects without breaking (no time, inline)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      date: '2026-05-21',
      students: [
        { name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [], subjects: ['English'] },
      ],
    })
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload.variables[2]).toBe('English')
  })

  it('skips a student who is on leave for the date (no student or parent alert)', async () => {
    setEnv(); setAuthOk([{ lws_id: 'S1' }]); mockWabridge(true)
    const { res } = await call({
      date: '2026-07-10',
      students: [
        { lwsId: 'S1', name: 'On Leave Kid', mobile: '9876500001', parentMobiles: ['9876500002'], subjects: ['Maths'] },
        { lwsId: 'S2', name: 'Present Kid',  mobile: '9876500003', parentMobiles: [], subjects: ['Maths'] },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(1)                 // only the present kid
    expect(res.body.onLeaveSkipped).toBe(1)
    expect(res.body.lines.some(l => /On Leave Kid.*on leave/i.test(l))).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)        // no message for the on-leave kid
  })

  it('fails closed (500) when the leaves lookup errors', async () => {
    setEnv(); mockWabridge(true)
    createClient.mockImplementation(() => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-uid' } } }) },
      from: () => ({ select: () => ({ lte: () => ({ or: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }),
    }))
    const { res } = await call({
      date: '2026-07-10',
      students: [{ lwsId: 'S1', name: 'Kid', mobile: '9876500001', parentMobiles: [], subjects: ['Maths'] }],
    })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/leaves/i)
  })

  it('counts Wabridge failures as skipped', async () => {
    setEnv(); setAuthOk(); mockWabridge(false)
    const { res } = await call({
      date: '2026-05-21',
      students: [{ name: 'Arjun', mobile: '9876543210', parentMobiles: [], subjects: ['Maths'] }],
    })
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
  })
})
