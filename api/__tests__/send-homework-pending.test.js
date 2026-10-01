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
    from: vi.fn(t => t === 'faculty_state' ? facultyStateTable(flowState) : undefined),
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

// Teachers capture homework defaulters; the office sends to parents.
function setAuthTeacher() {
  createClient.mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'teacher-uid', app_metadata: { role: 'teacher' } } },
      }),
    },
  }))
}

describe('send-homework-pending', () => {
  it('returns 403 for a teacher session', async () => {
    setEnv(); setAuthTeacher()
    const { res } = await call({ date: '2026-06-04', students: [{ name: 'A', mobile: '9000000000', items: [] }] })
    expect(res.statusCode).toBe(403)
    expect(res.body.ok).toBe(false)
  })

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

// ── server-side blocked-contact gate (2026-09-12) ────────────────────────────
// Before this the handler looped straight over req.body.students[] and never
// read the students table. Fixtures here carry `lwsId`; the older cases above
// do not, which is why they never reach the gate.

function setAuthWithStudents(rows, { error = null } = {}) {
  createClient.mockImplementation((_url, _key, opts) => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-uid' } } }) },
    from: vi.fn(t => t === 'faculty_state' ? facultyStateTable(flowState) : ({
      select: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({ data: error ? null : rows, error }),
      })),
    })),
    _opts: opts,
  }))
}

const HW = [{ subject: 'Maths', chapter: 'Integration', type: 'homework' }]

describe('blocked-contact gate (server-side)', () => {
  it('does not message a Block / Quit / Inactive student even when the client asks', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents([
      { lws_id: 'LWS-1', account_status: 'Active' },
      { lws_id: 'LWS-2', account_status: 'Inactive' },
    ])
    const { res } = await call({
      date: '2026-09-12',
      students: [
        { lwsId: 'LWS-1', name: 'Asha', mobile: '9876543210', parentMobiles: [], items: HW },
        { lwsId: 'LWS-2', name: 'Inactive One', mobile: '9876543211', parentMobiles: [], items: HW },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.blocked).toBe(1)
    const transcript = res.body.lines.join('\n')
    expect(transcript).toContain('Asha')
    expect(transcript).not.toContain('Inactive One')
  })

  it('still messages a student with a blank status or no profile row (fails open)', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents([{ lws_id: 'LWS-1', account_status: '' }])
    const { res } = await call({
      date: '2026-09-12',
      students: [
        { lwsId: 'LWS-1', name: 'Legacy', mobile: '9876543210', parentMobiles: [], items: HW },
        { lwsId: 'LWS-GHOST', name: 'Ghost', mobile: '9876543211', parentMobiles: [], items: HW },
      ],
    })
    expect(res.body.blocked).toBe(0)
    expect(res.body.lines.join('\n')).toContain('Legacy')
    expect(res.body.lines.join('\n')).toContain('Ghost')
  })

  it('refuses the whole send when the status read fails', async () => {
    setEnv(); mockWabridge(true)
    setAuthWithStudents(null, { error: { message: 'permission denied for table students' } })
    const { res } = await call({
      date: '2026-09-12',
      students: [{ lwsId: 'LWS-1', name: 'Asha', mobile: '9876543210', parentMobiles: [], items: HW }],
    })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/verify account status/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

// ── Per-flow switch (Settings → WhatsApp) ────────────────────────────────────
describe('send-homework-pending — flow switch', () => {
  const body = () => ({ date: '2026-10-01', students: [{ name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: [], items: [{ subject: 'Maths', chapter: 'Trigonometry', type: 'homework' }] }] })

  it('sends normally when the flow has never been switched (absent = on)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call(body())
    expect(res.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalled()
  })

  it('refuses with 409 disabled:true and sends nothing when switched off', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { homework: { enabled: false } }
    const { res } = await call(body())
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ ok: false, disabled: true, flow: 'homework', sent: 0 })
    expect(res.body.error).toMatch(/switched off in Settings/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets a redirected test send through while switched off', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { homework: { enabled: false } }
    const { res } = await call({ ...body(), redirectTo: '9000000001' })
    expect(res.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalled()
    for (const [, init] of fetch.mock.calls) {
      expect(JSON.parse(init.body).destination_number).toBe('919000000001')
    }
  })

  // An unparseable redirect falls through to the REAL recipients, so it must
  // not count as a test send.
  it('does not treat an unparseable redirect as a test send', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { homework: { enabled: false } }
    const { res } = await call({ ...body(), redirectTo: '12' })
    expect(res.statusCode).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses with 500 and sends nothing when the switch cannot be read', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.error = { message: 'boom' }
    const { res } = await call(body())
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/boom/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is not switched off by another flow', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    flowState.flows = { mentorNudge: { enabled: false } }
    const { res } = await call(body())
    expect(res.statusCode).toBe(200)
  })
})
