// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-22T02:00:00Z')) }) // Monday 07:30 IST
afterEach(() => { vi.useRealTimers(); process.env = { ...ORIGINAL_ENV } })

function makeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
}

async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-mentor-nudges.js')
  const req = { method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body }
  const res = makeRes()
  await handler(req, res)
  return { res }
}

function setEnv({ cronSecret } = {}) {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.WABRIDGE_APP_KEY = 'app'
  process.env.WABRIDGE_AUTH_KEY = 'auth'
  process.env.WABRIDGE_DEVICE_ID = 'device'
  process.env.WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID = 'mentor-template'
  if (cronSecret) process.env.CRON_SECRET = cronSecret
}

// One mock client serving both the anon (auth.getUser) and service (from) roles.
const insertSpy = vi.fn()
function mockDb({ assignments = [], students = [], nudges = [], teachers = [], role = null } = {}) {
  const resultFor = t =>
    t === 'mentor_assignments' ? { data: assignments, error: null }
    : t === 'students' ? { data: students, error: null }
    : t === 'mentor_nudges' ? { data: nudges, error: null }
    : t === 'faculty_state' ? { data: { data: { timetableTeachers: teachers } }, error: null }
    : { data: null, error: null }
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u', user_metadata: role ? { role } : {} } } }) },
    from: t => {
      const result = resultFor(t)
      const b = {
        select: () => b, in: () => b, eq: () => b,
        single: () => Promise.resolve(result),
        insert: rows => { insertSpy(t, rows); return Promise.resolve({ error: null }) },
        then: r => r(result),
      }
      return b
    },
  }))
}

function mockWabridge(ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(ok ? { status: 1, data: { messageid: 'm1' } } : { status: 0, message: 'fail' }),
  }))
}

const A = (lws, tid) => ({ lws_id: lws, teacher_id: tid })
const S = (lws, name, status = 'Active') => ({ lws_id: lws, canonical_name: name, account_status: status })

describe('send-mentor-nudges — gates', () => {
  it('405 for non GET/POST', async () => {
    const { res } = await call({}, { method: 'PUT' })
    expect(res.statusCode).toBe(405)
  })
  it('500 when service key missing', async () => {
    process.env = { ...ORIGINAL_ENV }
    const { res } = await call({})
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/SERVICE_ROLE/)
  })
  it('500 when template missing on a real send', async () => {
    setEnv(); delete process.env.WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID
    mockDb({})
    const { res } = await call({}) // not a dry run
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/mentor-nudge template/i)
  })

  it('dry run works without the Wabridge template configured', async () => {
    setEnv(); delete process.env.WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID
    mockDb({
      assignments: [A('LWS-1', 't1')],
      students: [S('LWS-1', 'Aaa')],
      teachers: [{ id: 't1', name: 'Vilas Sir' }],
    })
    const { res } = await call({ dryRun: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.planned[0].students).toEqual(['Aaa'])
  })
  it('401 when no bearer and not cron', async () => {
    setEnv()
    const { res } = await call({}, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })
  it('403 for a teacher JWT', async () => {
    setEnv(); mockDb({ role: 'teacher' })
    const { res } = await call({})
    expect(res.statusCode).toBe(403)
  })
})

describe('send-mentor-nudges — weekday gate', () => {
  it('skips on a weekend without force', async () => {
    vi.setSystemTime(new Date('2026-06-20T02:00:00Z')) // Saturday
    setEnv(); mockDb({})
    const { res } = await call({})
    expect(res.statusCode).toBe(200)
    expect(res.body.skipped).toBe('weekend')
    expect(res.body.sent).toBe(0)
  })
})

describe('send-mentor-nudges — rotation send', () => {
  it('dry run plans picks per teacher without sending or logging', async () => {
    setEnv(); mockWabridge(true)
    mockDb({
      assignments: [A('LWS-1', 't1'), A('LWS-2', 't1'), A('LWS-3', 't1'), A('LWS-4', 't1')],
      students: [S('LWS-1', 'Aaa'), S('LWS-2', 'Bbb'), S('LWS-3', 'Ccc'), S('LWS-4', 'Ddd')],
      teachers: [{ id: 't1', name: 'Vilas Sir', mobile: '9021869427' }],
    })
    const { res } = await call({ dryRun: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.dryRun).toBe(true)
    expect(res.body.planned).toHaveLength(1)
    expect(res.body.planned[0].teacher).toBe('Vilas Sir')
    expect(res.body.planned[0].students).toHaveLength(2) // n=2 of 4 active
    expect(fetch).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('excludes non-Active mentees', async () => {
    setEnv(); mockWabridge(true)
    mockDb({
      assignments: [A('LWS-1', 't1'), A('LWS-2', 't1')],
      students: [S('LWS-1', 'Aaa'), S('LWS-2', 'Blocked Bob', 'Block')],
      teachers: [{ id: 't1', name: 'Vilas Sir', mobile: '9021869427' }],
    })
    const { res } = await call({ dryRun: true })
    expect(res.body.planned[0].students).toEqual(['Aaa'])
  })

  it('sends to the teacher mobile and logs nudges only on success', async () => {
    setEnv(); mockWabridge(true)
    mockDb({
      assignments: [A('LWS-1', 't1'), A('LWS-2', 't1')],
      students: [S('LWS-1', 'Aaa'), S('LWS-2', 'Bbb')],
      teachers: [{ id: 't1', name: 'Vilas Sir', mobile: '9021869427' }],
    })
    const { res } = await call({})
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload.destination_number).toBe('919021869427')
    expect(payload.variables[0]).toBe('22nd June 2026') // {{1}} date
    // {{2}} = both names (intra-day order is random and immaterial)
    expect(payload.variables[1].split(', ').sort()).toEqual(['Aaa', 'Bbb'])
    const [table, rows] = insertSpy.mock.calls[0]
    expect(table).toBe('mentor_nudges')
    expect(rows.map(r => r.lws_id).sort()).toEqual(['LWS-1', 'LWS-2'])
    expect(rows.every(r => r.teacher_id === 't1' && r.date === '2026-06-22')).toBe(true)
  })

  it('redirectTo is a non-destructive test — sends but does NOT advance the rotation', async () => {
    setEnv(); mockWabridge(true)
    mockDb({
      assignments: [A('LWS-1', 't1'), A('LWS-2', 't1')],
      students: [S('LWS-1', 'Aaa'), S('LWS-2', 'Bbb')],
      teachers: [{ id: 't1', name: 'Vilas Sir', mobile: '9021869427' }],
    })
    const { res } = await call({ redirectTo: '7777777777' })
    expect(res.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body).destination_number).toBe('917777777777')
    expect(insertSpy).not.toHaveBeenCalled() // rotation untouched
  })

  it('does not log nudges when the send fails', async () => {
    setEnv(); mockWabridge(false)
    mockDb({
      assignments: [A('LWS-1', 't1')],
      students: [S('LWS-1', 'Aaa')],
      teachers: [{ id: 't1', name: 'Vilas Sir', mobile: '9021869427' }],
    })
    const { res } = await call({})
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('skips a teacher with no mobile on their record', async () => {
    setEnv(); mockWabridge(true)
    mockDb({
      assignments: [A('LWS-1', 't1')],
      students: [S('LWS-1', 'Aaa')],
      teachers: [{ id: 't1', name: 'No Mobile Sir' }],
    })
    const { res } = await call({})
    expect(res.body.sent).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts the cron secret (GET) and sends', async () => {
    setEnv({ cronSecret: 'topsecret' }); mockWabridge(true)
    mockDb({
      assignments: [A('LWS-1', 't1')],
      students: [S('LWS-1', 'Aaa')],
      teachers: [{ id: 't1', name: 'Vilas Sir', mobile: '9021869427' }],
    })
    const { res } = await call(null, { method: 'GET', jwt: 'topsecret' })
    expect(res.statusCode).toBe(200)
    expect(res.body.mode).toBe('cron')
    expect(res.body.sent).toBe(1)
  })
})
