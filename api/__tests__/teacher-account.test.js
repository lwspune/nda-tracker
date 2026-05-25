// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => {
  // mockReset drains the mockImplementationOnce queue across tests — needed
  // because setupClients queues two consecutive impls per test.
  createClient.mockReset()
})
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
}

async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../teacher-account.js')
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
  process.env.VITE_SUPABASE_URL        = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY   = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
}

// Two clients are created: anon (for verifying caller JWT) and service-role
// (for admin.* operations). Mock both via successive createClient invocations.
function setupClients({ caller = { id: 'admin-uid', user_metadata: {} }, adminOps = {} } = {}) {
  const anonClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: caller } }) },
  }
  const serviceClient = {
    auth: {
      admin: {
        listUsers:       adminOps.listUsers       || vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        createUser:      adminOps.createUser      || vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null }),
        deleteUser:      adminOps.deleteUser      || vi.fn().mockResolvedValue({ data: {}, error: null }),
        updateUserById:  adminOps.updateUserById  || vi.fn().mockResolvedValue({ data: { user: { id: 'updated-uid' } }, error: null }),
      },
    },
  }
  // First createClient call → anon, second → service. Handler must follow this order.
  createClient
    .mockImplementationOnce(() => anonClient)
    .mockImplementationOnce(() => serviceClient)
  return { anonClient, serviceClient }
}

describe('teacher-account — gate', () => {
  it('returns 405 for non-POST', async () => {
    const { res } = await call({}, { method: 'GET' })
    expect(res.statusCode).toBe(405)
  })

  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY missing', async () => {
    process.env.VITE_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'anon'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { res } = await call({ action: 'list' })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/service.role/i)
  })

  it('returns 401 when no JWT is provided', async () => {
    setEnv()
    const { res } = await call({ action: 'list' }, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when JWT is invalid', async () => {
    setEnv()
    createClient.mockImplementationOnce(() => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    }))
    const { res } = await call({ action: 'list' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when caller is a teacher (role=teacher)', async () => {
    setEnv()
    setupClients({ caller: { id: 'teacher-uid', user_metadata: { role: 'teacher' } } })
    const { res } = await call({ action: 'list' })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for unknown action', async () => {
    setEnv()
    setupClients()
    const { res } = await call({ action: 'nuke-everything' })
    expect(res.statusCode).toBe(400)
  })
})

describe('teacher-account — list action', () => {
  it('returns only emails whose role is teacher', async () => {
    setEnv()
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [
            { id: '1', email: 'admin@x.com',   user_metadata: {} },
            { id: '2', email: 'teach1@x.com',  user_metadata: { role: 'teacher' } },
            { id: '3', email: 'teach2@x.com',  user_metadata: { role: 'teacher' } },
            { id: '4', email: 'someone@x.com', user_metadata: { role: 'other' } },
          ] },
          error: null,
        }),
      },
    })
    const { res } = await call({ action: 'list' })
    expect(res.statusCode).toBe(200)
    expect(res.body.emails.sort()).toEqual(['teach1@x.com', 'teach2@x.com'])
  })

  it('lower-cases emails for case-insensitive comparison', async () => {
    setEnv()
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [
            { id: '1', email: 'Mixed.Case@X.com', user_metadata: { role: 'teacher' } },
          ] },
          error: null,
        }),
      },
    })
    const { res } = await call({ action: 'list' })
    expect(res.body.emails).toEqual(['mixed.case@x.com'])
  })
})

describe('teacher-account — create action', () => {
  it('returns 400 when email or password missing', async () => {
    setEnv()
    setupClients()
    const r1 = await call({ action: 'create' })
    expect(r1.res.statusCode).toBe(400)
    setupClients()
    const r2 = await call({ action: 'create', email: 'a@b.com' })
    expect(r2.res.statusCode).toBe(400)
  })

  it('calls auth.admin.createUser with email_confirm + teacher metadata', async () => {
    setEnv()
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null })
    setupClients({ adminOps: { createUser } })
    const { res } = await call({ action: 'create', email: 'new@x.com', password: 'pw12345678', name: 'Navneet Sir' })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(createUser).toHaveBeenCalledWith({
      email: 'new@x.com',
      password: 'pw12345678',
      email_confirm: true,
      user_metadata: { role: 'teacher', full_name: 'Navneet Sir' },
    })
  })

  it('omits full_name from user_metadata when name not provided', async () => {
    setEnv()
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null })
    setupClients({ adminOps: { createUser } })
    await call({ action: 'create', email: 'new@x.com', password: 'pw12345678' })
    const args = createUser.mock.calls[0][0]
    expect(args.user_metadata).toEqual({ role: 'teacher' })
  })

  it('surfaces Supabase error (e.g. duplicate email)', async () => {
    setEnv()
    setupClients({
      adminOps: {
        createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'User already registered' } }),
      },
    })
    const { res } = await call({ action: 'create', email: 'exists@x.com', password: 'pw12345678' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/already registered/i)
  })
})

describe('teacher-account — delete action', () => {
  it('returns 400 when email missing', async () => {
    setEnv(); setupClients()
    const { res } = await call({ action: 'delete' })
    expect(res.statusCode).toBe(400)
  })

  it('looks up user by email then calls deleteUser with UID', async () => {
    setEnv()
    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null })
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [
            { id: 'uid-1', email: 'admin@x.com', user_metadata: {} },
            { id: 'uid-2', email: 'teach@x.com', user_metadata: { role: 'teacher' } },
          ] },
          error: null,
        }),
        deleteUser,
      },
    })
    const { res } = await call({ action: 'delete', email: 'teach@x.com' })
    expect(res.statusCode).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith('uid-2')
  })

  it('returns 404 when email not found among auth users', async () => {
    setEnv()
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
    })
    const { res } = await call({ action: 'delete', email: 'ghost@x.com' })
    expect(res.statusCode).toBe(404)
  })

  it('matches email case-insensitively', async () => {
    setEnv()
    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null })
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [{ id: 'uid-1', email: 'Mixed@X.com', user_metadata: { role: 'teacher' } }] },
          error: null,
        }),
        deleteUser,
      },
    })
    const { res } = await call({ action: 'delete', email: 'mixed@x.com' })
    expect(res.statusCode).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith('uid-1')
  })
})

describe('teacher-account — reset action', () => {
  it('returns 400 when email or newPassword missing', async () => {
    setEnv()
    setupClients()
    const r1 = await call({ action: 'reset' })
    expect(r1.res.statusCode).toBe(400)
    setupClients()
    const r2 = await call({ action: 'reset', email: 'a@b.com' })
    expect(r2.res.statusCode).toBe(400)
  })

  it('looks up by email then calls updateUserById with new password', async () => {
    setEnv()
    const updateUserById = vi.fn().mockResolvedValue({ data: { user: { id: 'uid-2' } }, error: null })
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [{ id: 'uid-2', email: 'teach@x.com', user_metadata: { role: 'teacher' } }] },
          error: null,
        }),
        updateUserById,
      },
    })
    const { res } = await call({ action: 'reset', email: 'teach@x.com', newPassword: 'newpw98765' })
    expect(res.statusCode).toBe(200)
    expect(updateUserById).toHaveBeenCalledWith('uid-2', { password: 'newpw98765' })
  })

  it('returns 404 when email not found', async () => {
    setEnv()
    setupClients({
      adminOps: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
    })
    const { res } = await call({ action: 'reset', email: 'ghost@x.com', newPassword: 'newpw98765' })
    expect(res.statusCode).toBe(404)
  })
})
