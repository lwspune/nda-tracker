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
  const { default: handler } = await import('../send-exam-absence.js')
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
  process.env.WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID = 'exam-absence-template'
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

describe('send-exam-absence', () => {
  it('returns 405 for non-POST', async () => {
    const { res } = await call({}, { method: 'GET' })
    expect(res.statusCode).toBe(405)
  })

  it('returns 500 when exam-absence template is not configured', async () => {
    setAuthOk()
    const { res } = await call({ examName: 'Mock #5', students: [] })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/exam-absence|template/i)
  })

  it('returns 401 when no JWT', async () => {
    setEnv()
    const { res } = await call({ examName: 'Mock #5', students: [] }, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when JWT is invalid', async () => {
    setEnv()
    createClient.mockImplementation(() => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    }))
    const { res } = await call({ examName: 'Mock #5', students: [] })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when examName or students[] missing', async () => {
    setEnv(); setAuthOk()
    expect((await call({})).res.statusCode).toBe(400)
    expect((await call({ examName: 'Mock #5' })).res.statusCode).toBe(400)
    expect((await call({ students: [] })).res.statusCode).toBe(400)
  })

  it('sends to parents only (NOT to students themselves) — "Your ward" template', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      examName: 'Mock #5',
      students: [
        { name: 'Arjun Sharma', mobile: '9876543210', parentMobiles: ['9876543211', '9876543299'] },
        { name: 'Ravi Kumar',   mobile: '9876543212', parentMobiles: ['9876543213'] },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.sent).toBe(3) // 2 parents for Arjun + 1 for Ravi; NO student sends
    expect(fetch).toHaveBeenCalledTimes(3)
    // None of the calls should be to the students' own mobiles
    for (const [, init] of fetch.mock.calls) {
      const payload = JSON.parse(init.body)
      expect(payload.destination_number).not.toBe('919876543210')
      expect(payload.destination_number).not.toBe('919876543212')
    }
  })

  it('sends template variables as positional [name, examName]', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      examName: 'Mock #5',
      students: [{ name: 'Arjun Sharma', parentMobiles: ['9876543211'] }],
    })
    const [, init] = fetch.mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.variables).toEqual(['Arjun Sharma', 'Mock #5'])
    expect(payload.template_id).toBe('exam-absence-template')
  })

  it('sanitises examName to ASCII (strips en-dash, em-dash, collapses whitespace)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      examName: 'Mock–#5—final  test\n2026',  // en-dash + em-dash + double space + newline
      students: [{ name: 'Arjun', parentMobiles: ['9876543211'] }],
    })
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    // en-dash + em-dash → '-', whitespace collapsed to single space
    expect(payload.variables[1]).toBe('Mock-#5-final test 2026')
  })

  it('redirectTo overrides parent destinations', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    await call({
      examName: 'Mock #5',
      redirectTo: '7777777777',
      students: [
        { name: 'Arjun', parentMobiles: ['9876543211', '9876543299'] },
      ],
    })
    for (const [, init] of fetch.mock.calls) {
      const payload = JSON.parse(init.body)
      expect(payload.destination_number).toBe('917777777777')
    }
  })

  it('skips students with no parent mobiles (logs SKIP)', async () => {
    setEnv(); setAuthOk(); mockWabridge(true)
    const { res } = await call({
      examName: 'Mock #5',
      students: [
        { name: 'Arjun', parentMobiles: [] },
        { name: 'Ravi',  parentMobiles: ['9876543213'] },
      ],
    })
    expect(res.body.sent).toBe(1)
    expect(res.body.skipped).toBe(1)
    expect(res.body.lines.some(l => /SKIP.*Arjun/i.test(l))).toBe(true)
  })

  it('counts Wabridge failures as skipped and logs FAIL with parent destination', async () => {
    setEnv(); setAuthOk(); mockWabridge(false)
    const { res } = await call({
      examName: 'Mock #5',
      students: [{ name: 'Arjun', parentMobiles: ['9876543211'] }],
    })
    expect(res.body.sent).toBe(0)
    expect(res.body.skipped).toBe(1)
    expect(res.body.lines.some(l => /FAIL.*Arjun.*parent/i.test(l))).toBe(true)
  })

  it('log lines match the parseFailedNames regex (FAIL → / SKIP)', async () => {
    setEnv(); setAuthOk(); mockWabridge(false)
    const { res } = await call({
      examName: 'Mock #5',
      students: [
        { name: 'Arjun', parentMobiles: ['9876543211'] }, // FAIL → Arjun (parent → ...)
        { name: 'Ravi',  parentMobiles: [] },             // SKIP Ravi — no parent mobile
      ],
    })
    expect(res.body.lines.some(l => l.includes('FAIL → Arjun'))).toBe(true)
    expect(res.body.lines.some(l => /SKIP Ravi/.test(l))).toBe(true)
  })
})
