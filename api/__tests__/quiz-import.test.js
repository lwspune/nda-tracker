// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const SECRET = 'test-import-secret'

const QUESTIONS = [
  { q: 1, question: 'A?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', answer: 'A' },
  { q: 2, question: 'B?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', answer: 'B' },
]

function makeQuiz(over = {}) {
  return {
    id: 'nda-prob-classical-1',
    title: 'NDA Probability — Classical 1',
    subject: 'Maths',
    questions: QUESTIONS,
    marking: { correct: 1, wrong: 0 },
    ...over,
  }
}

// quizzes table mock — captures the upserted row.
function makeMockClient({ upsertError = null } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const client = {
    from: vi.fn(table => {
      if (table === 'quizzes') return { upsert }
      return { upsert: vi.fn().mockResolvedValue({ error: null }) }
    }),
    upsert,
  }
  return client
}

async function call(body, { method = 'POST', auth = `Bearer ${SECRET}` } = {}) {
  const { default: handler } = await import('../quiz-import.js')
  const headers = auth ? { authorization: auth } : {}
  const req = { method, body, headers }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.QUIZ_IMPORT_SECRET = SECRET
  vi.mocked(createClient).mockReturnValue(makeMockClient())
})

describe('POST /api/quiz-import', () => {
  it('returns 405 for non-POST', async () => {
    const res = await call(makeQuiz(), { method: 'GET' })
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await call(makeQuiz(), { auth: null })
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 401 when the secret is wrong', async () => {
    const res = await call(makeQuiz(), { auth: 'Bearer nope' })
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 500 when the server has no import secret configured', async () => {
    delete process.env.QUIZ_IMPORT_SECRET
    const res = await call(makeQuiz())
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('returns 400 when the title is missing', async () => {
    const res = await call(makeQuiz({ title: '' }))
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 400 when there are no complete questions', async () => {
    const res = await call(makeQuiz({ questions: [{ q: 1, question: 'incomplete', optionA: '1' }] }))
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('upserts the quiz as a DRAFT and returns a summary', async () => {
    const client = makeMockClient()
    vi.mocked(createClient).mockReturnValue(client)
    const res = await call(makeQuiz())
    expect(res.status).toHaveBeenCalledWith(200)
    expect(client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nda-prob-classical-1', status: 'draft' }),
      { onConflict: 'id' },
    )
    const out = res.json.mock.calls[0][0]
    expect(out).toMatchObject({ ok: true, id: 'nda-prob-classical-1', questionCount: 2 })
  })

  it('forces status to draft even when the body says published', async () => {
    const client = makeMockClient()
    vi.mocked(createClient).mockReturnValue(client)
    await call(makeQuiz({ status: 'published' }))
    expect(client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft' }),
      { onConflict: 'id' },
    )
  })

  it('returns 500 when the upsert fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ upsertError: { message: 'boom' } }))
    const res = await call(makeQuiz())
    expect(res.status).toHaveBeenCalledWith(500)
  })
})
