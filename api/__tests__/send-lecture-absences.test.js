// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { newFlowState, facultyStateTable } from './_flowState.js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ORIGINAL_ENV = { ...process.env }
// The per-flow WhatsApp switch (api/_flowGate.js) reads faculty_state before
// any send. Every client mock below serves it from here; on by default.
let flowState = newFlowState()
beforeEach(() => { vi.clearAllMocks(); flowState = newFlowState() })
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
    from: t => t === 'faculty_state' ? facultyStateTable(flowState) : ({
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
      from: t => t === 'faculty_state' ? facultyStateTable(flowState)
        : ({ select: () => ({ lte: () => ({ or: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }),
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

// ── the auth door (2026-09-12) ───────────────────────────────────────────────
// One test per door, 401 and 403 asserted SEPARATELY. The lecture path had no
// teacher test, and on a sibling endpoint (send-whatsapp) the missing 403 turned
// out to be a real gap — so "the other tests pass" is not evidence the door is
// locked.

function setAuthAs(user) {
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: t => t === 'faculty_state' ? facultyStateTable(flowState) : ({
      select: () => ({ lte: () => ({ or: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  }))
}

describe('send-attendance-alerts (lecture) — the auth door', () => {
  const BODY = { date: '2026-09-12', batchName: 'B1', students: [] }

  it('401s with no session token', async () => {
    setEnv(); setAuthOk()
    const { res } = await call(BODY, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('401s when the token resolves to no user', async () => {
    setEnv(); setAuthAs(null)
    const { res } = await call(BODY)
    expect(res.statusCode).toBe(401)
  })

  it('403s a teacher — parent-facing sends stay admin-side', async () => {
    setEnv(); mockWabridge(true)
    setAuthAs({ id: 't-uid', app_metadata: { role: 'teacher' } })
    const { res } = await call(BODY)
    expect(res.statusCode).toBe(403)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  // app_metadata only — user_metadata is writable by the account holder.
  it('403s a teacher who relabelled their own user_metadata', async () => {
    setEnv(); mockWabridge(true)
    setAuthAs({ id: 't-uid', app_metadata: { role: 'teacher' }, user_metadata: { role: 'admin' } })
    const { res } = await call(BODY)
    expect(res.statusCode).toBe(403)
  })

  it('lets an admin through', async () => {
    setEnv(); mockWabridge(true)
    setAuthAs({ id: 'admin-uid', app_metadata: {} })
    const { res } = await call(BODY)
    expect(res.statusCode).not.toBe(401)
    expect(res.statusCode).not.toBe(403)
  })
})

// ── Per-flow switch (Settings → WhatsApp) ────────────────────────────────────
describe('send-attendance-alerts (lecture) — flow switch', () => {
  const body = () => ({
    date: '2026-10-01',
    students: [{ lwsId: 'S1', name: 'Arjun', mobile: '9876543210', parentMobiles: [], subjects: ['Maths'] }],
  })

  it('sends normally when the flow has never been switched (absent = on)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call(body())
    expect(res.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalled()
  })

  it('refuses with 409 disabled:true and sends nothing when switched off', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { lectureMiss: { enabled: false } }
    const { res } = await call(body())
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ ok: false, disabled: true, flow: 'lectureMiss', sent: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets a redirected test send through while switched off', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { lectureMiss: { enabled: false } }
    const { res } = await call({ ...body(), redirectTo: '9000000001' })
    expect(res.statusCode).toBe(200)
    for (const [, init] of fetch.mock.calls) {
      expect(JSON.parse(init.body).destination_number).toBe('919000000001')
    }
  })

  it('does not treat an unparseable redirect as a test send', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { lectureMiss: { enabled: false } }
    const { res } = await call({ ...body(), redirectTo: '12' })
    expect(res.statusCode).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses with 500 and sends nothing when the switch cannot be read', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.error = { message: 'boom' }
    const { res } = await call(body())
    expect(res.statusCode).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is not switched off by the hostel alert sharing this endpoint', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { hostelAlert: { enabled: false } }
    const { res } = await call(body())
    expect(res.statusCode).toBe(200)
  })
})
