// @vitest-environment node
//
// The outbound half of the cross-app bridge: an admin asks the tracker to pull
// question content (above all DIAGRAMS) from PYQ Vault by bank id.
//
// It lives inside quiz-import.js behind a `kind` discriminator because Vercel's
// Hobby plan hard-fails the build at >12 api/*.js files and we are at 12. Note
// the auth is DIFFERENT from the quiz path in the same file: that one is the
// vault calling US with a shared secret; this one is our own admin calling us
// with their Supabase session, and the shared secret never leaves the server.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

function mockAuth(user) {
  createClient.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  })
}

async function call(body, { auth = 'Bearer session-jwt' } = {}) {
  const { default: handler } = await import('../quiz-import.js')
  const req = { method: 'POST', body, headers: auth ? { authorization: auth } : {} }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://tracker.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('VAULT_API_URL', 'https://vault.test')
  vi.stubEnv('VAULT_SYNC_SECRET', 'institute-secret')
  vi.stubEnv('QUIZ_IMPORT_SECRET', 'import-secret')
  mockAuth({ id: 'u1', app_metadata: { role: 'superadmin' } })
})

describe('quiz-import — kind: hydrate-questions — auth', () => {
  it('401s without a session token', async () => {
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] }, { auth: null })
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('401s when the session is invalid', async () => {
    mockAuth(null)
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] })
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('403s a teacher — capture surfaces never reach out to the bank', async () => {
    mockAuth({ id: 'u2', app_metadata: { role: 'teacher' } })
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] })
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('does NOT accept the import secret as authorisation for this branch', async () => {
    // the quiz path's shared secret is for the vault calling us; presenting it
    // here must not stand in for an admin session
    mockAuth(null)
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] }, { auth: 'Bearer import-secret' })
    expect(res.status).toHaveBeenCalledWith(401)
  })
})

describe('quiz-import — kind: hydrate-questions — request', () => {
  it('400s without ids', async () => {
    const res = await call({ kind: 'hydrate-questions' })
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('500s when the vault is not configured', async () => {
    vi.stubEnv('VAULT_SYNC_SECRET', '')
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] })
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('quiz-import — kind: hydrate-questions — the vault call', () => {
  it('calls the vault with the secret server-side and returns questions + missing', async () => {
    const payload = { questions: [{ questionId: ID1, question: 'a' }], missing: [ID2] }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    const res = await call({ kind: 'hydrate-questions', ids: [ID1, ID2] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('https://vault.test/api/questions/by-ids')
    expect(url).toContain(ID1)
    expect(init.headers.Authorization).toBe('Bearer institute-secret')

    expect(res.status).toHaveBeenCalledWith(200)
    const body = res.json.mock.calls[0][0]
    expect(body.questions).toEqual(payload.questions)
    // `missing` is contract, not courtesy — a repaired question mints a new uuid
    expect(body.missing).toEqual([ID2])
  })

  it('never leaks the shared secret to the client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ questions: [], missing: [] }),
    }))
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] })
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('institute-secret')
  })

  it('reports a vault failure as 502 rather than pretending the bank is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: 'unauthorized' }),
    }))
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] })
    expect(res.status).toHaveBeenCalledWith(502)
  })

  it('reports a network failure as 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = await call({ kind: 'hydrate-questions', ids: [ID1] })
    expect(res.status).toHaveBeenCalledWith(502)
  })
})
