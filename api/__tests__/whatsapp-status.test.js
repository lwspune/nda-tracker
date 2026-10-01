// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

// kind:'whatsapp-status' on api/send-attendance-alerts.js — folded in rather than
// a new file because Vercel Hobby caps the deployment at 12 functions. Answers
// "is each flow's template ID set?" with booleans only: the IDs are secrets.

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

async function call({ jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-attendance-alerts.js')
  const req = { method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: { kind: 'whatsapp-status' } }
  const res = makeRes()
  await handler(req, res)
  return res
}

function setAuth(user = { id: 'admin-uid', app_metadata: {} }) {
  createClient.mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  }))
}

function setEnv(extra = {}) {
  for (const k of Object.keys(process.env)) if (k.startsWith('WABRIDGE_')) delete process.env[k]
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  Object.assign(process.env, extra)
}

const SHARED = { WABRIDGE_APP_KEY: 'app', WABRIDGE_AUTH_KEY: 'auth', WABRIDGE_DEVICE_ID: 'dev' }

describe('whatsapp-status — the auth door', () => {
  it('401 without a token', async () => {
    setEnv(SHARED); setAuth()
    expect((await call({ jwt: '' })).statusCode).toBe(401)
  })

  it('401 when the token resolves to no user', async () => {
    setEnv(SHARED); setAuth(null)
    expect((await call()).statusCode).toBe(401)
  })

  it('403 for a teacher', async () => {
    setEnv(SHARED); setAuth({ id: 't', app_metadata: { role: 'teacher' } })
    expect((await call()).statusCode).toBe(403)
  })

  it('405 for anything but POST', async () => {
    setEnv(SHARED); setAuth()
    const { default: handler } = await import('../send-attendance-alerts.js')
    const res = makeRes()
    await handler({ method: 'PUT', headers: { authorization: 'Bearer x' }, body: { kind: 'whatsapp-status' } }, res)
    expect(res.statusCode).toBe(405)
  })
})

describe('whatsapp-status — the answer', () => {
  it('reports each flow by whether its template env var is set', async () => {
    setEnv({ ...SHARED, WABRIDGE_TEMPLATE_ID: 'tpl-1', WABRIDGE_LATE_TEMPLATE_ID: 'tpl-2' })
    setAuth()
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      shared: true,
      configured: {
        examResults: true, late: true, lectureMiss: false, examAbsence: false,
        homework: false, mentorNudge: false, hostelAlert: false,
      },
    })
  })

  it('reports shared:false when any of the three shared credentials is missing', async () => {
    setEnv({ WABRIDGE_APP_KEY: 'app', WABRIDGE_AUTH_KEY: 'auth', WABRIDGE_TEMPLATE_ID: 'tpl-1' })
    setAuth()
    const res = await call()
    expect(res.body.shared).toBe(false)
    expect(res.body.configured.examResults).toBe(true)
  })

  it('never echoes a secret value', async () => {
    setEnv({ ...SHARED, WABRIDGE_TEMPLATE_ID: 'super-secret-template' })
    setAuth()
    const res = await call()
    const json = JSON.stringify(res.body)
    expect(json).not.toContain('super-secret-template')
    expect(json).not.toContain('"app"')
    expect(json).not.toContain('dev')
  })

  it('sends nothing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    setEnv({ ...SHARED, WABRIDGE_TEMPLATE_ID: 'tpl-1' })
    setAuth()
    await call()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
