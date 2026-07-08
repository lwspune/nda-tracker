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
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this },
  }
}

// send-hostel-alert was folded into send-attendance-alerts.js (dispatched by
// body.kind==='hostel') to stay under Vercel's 12-function Hobby cap.
async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-attendance-alerts.js')
  const req = { method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: { kind: 'hostel', ...body } }
  const res = makeRes()
  await handler(req, res)
  return res
}

function setEnv({ template = false } = {}) {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.WABRIDGE_APP_KEY = 'app'
  process.env.WABRIDGE_AUTH_KEY = 'auth'
  process.env.WABRIDGE_DEVICE_ID = 'device'
  if (template) process.env.WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID = 'hostel-template'
}

function mockDb({ roster = [], attendance = [], checkpoints = [], leaves = [], hostelAlertMobiles = [], role = null } = {}) {
  const resultFor = t =>
    t === 'students' ? { data: roster, error: null }
    : t === 'student_attendance' ? { data: attendance, error: null }
    : t === 'checkpoint_absences' ? { data: checkpoints, error: null }
    : t === 'leaves' ? { data: leaves, error: null }
    : t === 'faculty_state' ? { data: { data: { hostelAlertMobiles } }, error: null }
    : { data: null, error: null }
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u', user_metadata: role ? { role } : {} } } }) },
    from: t => {
      const result = resultFor(t)
      const b = {
        select: () => b, eq: () => b, lte: () => b, gte: () => b,
        single: () => Promise.resolve(result),
        then: r => r(result),
      }
      return b
    },
  }))
}

function mockWabridge(ok = true) {
  const fetchSpy = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(ok ? { status: 1, data: { messageid: 'm1' } } : { status: 0, message: 'fail' }),
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

const ROSTER = [
  { lws_id: 'APJ-1', canonical_name: 'Aarav Nair' },
  { lws_id: 'APJ-2', canonical_name: 'Bhavya Rao' },
]

describe('send-hostel-alert — auth', () => {
  it('401 without a token', async () => {
    setEnv({ template: true }); mockDb()
    const res = await call({ date: '08-07-2026' }, { jwt: null })
    expect(res.statusCode).toBe(401)
  })

  it('403 for a teacher role', async () => {
    setEnv({ template: true }); mockDb({ role: 'teacher' })
    const res = await call({ date: '08-07-2026' })
    expect(res.statusCode).toBe(403)
  })
})

describe('send-hostel-alert — fail-closed on missing template', () => {
  it('500 when a real send is requested without the template env', async () => {
    setEnv({ template: false }); mockDb({ roster: ROSTER })
    const res = await call({ date: '08-07-2026' })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID/)
  })

  it('dry run previews the alert even without the template env', async () => {
    setEnv({ template: false })
    mockDb({ roster: ROSTER, checkpoints: [{ lws_id: 'APJ-1', checkpoint: 'dinner', status: 'absent' }], hostelAlertMobiles: ['9021869427'] })
    const res = await call({ date: '08-07-2026', dryRun: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.dryRun).toBe(true)
    expect(res.body.count).toBe(1)
    expect(res.body.listText).toBe('Aarav Nair - Dinner')
    expect(res.body.recipients).toBe(1)
  })
})

describe('send-hostel-alert — send', () => {
  it('recomputes the chain and sends one message per warden number', async () => {
    setEnv({ template: true })
    mockDb({ roster: ROSTER, checkpoints: [{ lws_id: 'APJ-1', checkpoint: 'dinner', status: 'absent' }], hostelAlertMobiles: ['9021869427', '9876543210'] })
    const fetchSpy = mockWabridge(true)
    const res = await call({ date: '08-07-2026' })
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(2)
    // Positional vars: [date, list]
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(payload.variables).toEqual(['08-07-2026', 'Aarav Nair - Dinner'])
  })

  it('sends nothing when every boarder is accounted for', async () => {
    setEnv({ template: true })
    mockDb({ roster: ROSTER, hostelAlertMobiles: ['9021869427'] })
    const fetchSpy = mockWabridge(true)
    const res = await call({ date: '08-07-2026' })
    expect(res.body.count).toBe(0)
    expect(res.body.sent).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports when there are anomalies but no warden numbers configured', async () => {
    setEnv({ template: true })
    mockDb({ roster: ROSTER, checkpoints: [{ lws_id: 'APJ-1', checkpoint: 'dinner', status: 'absent' }], hostelAlertMobiles: [] })
    const fetchSpy = mockWabridge(true)
    const res = await call({ date: '08-07-2026' })
    expect(res.body.sent).toBe(0)
    expect(res.body.message).toMatch(/No warden alert numbers/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a redirectTo test send goes only to the test number', async () => {
    setEnv({ template: true })
    mockDb({ roster: ROSTER, checkpoints: [{ lws_id: 'APJ-1', checkpoint: 'dinner', status: 'absent' }], hostelAlertMobiles: ['9021869427'] })
    const fetchSpy = mockWabridge(true)
    const res = await call({ date: '08-07-2026', redirectTo: '9999988888' })
    expect(res.body.sent).toBe(1)
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(payload.destination_number).toBe('919999988888')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
