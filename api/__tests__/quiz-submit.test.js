// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const STUDENT = { canonical_name: 'Arjun Sharma', lws_id: 'LWS001', mobile: '9876543210' }

const QUESTIONS = [
  { q: 1, question: 'A?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', answer: 'A' },
  { q: 2, question: 'B?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', answer: 'B' },
]

function futureIso() { const d = new Date(); d.setHours(d.getHours() + 2); return d.toISOString() }
function pastIso()   { const d = new Date(); d.setHours(d.getHours() - 2); return d.toISOString() }

function makeQuiz(over = {}) {
  return {
    id: 'quiz-1', title: 'Daily 1', subject: 'Maths',
    marking: { correct: 1, wrong: 0 }, questions: QUESTIONS,
    status: 'published', closes_at: futureIso(), ...over,
  }
}

// Chainable thenable builder that resolves to { data, error }.
function builder(data, error = null) {
  const b = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn(() => b)
  b.then = (resolve) => Promise.resolve({ data, error }).then(resolve)
  return b
}

function makeMockClient({
  students = [STUDENT],
  quiz = makeQuiz(),
  existingAttempts = [],
  insertError = null,
  studentsError = null,
  quizError = null,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError })
  const client = {
    from: vi.fn(table => {
      if (table === 'students') return { select: vi.fn().mockResolvedValue({ data: students, error: studentsError }) }
      if (table === 'quizzes') return builder(quiz ? [quiz] : [], quizError)
      if (table === 'quiz_attempts') {
        const b = builder(existingAttempts)
        b.insert = insert
        return b
      }
      return builder([])
    }),
    insert,
  }
  return client
}

async function call(body, method = 'POST') {
  const { default: handler } = await import('../quiz-submit.js')
  const req = { method, body, headers: {} }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  vi.mocked(createClient).mockReturnValue(makeMockClient())
})

describe('POST /api/quiz-submit', () => {
  it('returns 405 for non-POST', async () => {
    const res = await call({}, 'GET')
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('returns 400 when mobile or quizId missing', async () => {
    expect((await call({ quizId: 'quiz-1' })).status).toHaveBeenCalledWith(400)
    expect((await call({ mobile: '9876543210' })).status).toHaveBeenCalledWith(400)
  })

  it('returns 404 for an unknown mobile', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ students: [] }))
    const res = await call({ mobile: '9999999999', quizId: 'quiz-1', answers: {} })
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns 404 when the quiz does not exist', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ quiz: null }))
    const res = await call({ mobile: '9876543210', quizId: 'nope', answers: {} })
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('grades server-side and returns the score + review with the answer key', async () => {
    const res = await call({ mobile: '9876543210', quizId: 'quiz-1', answers: { 1: 'A', 2: 'C' } })
    expect(res.status).toHaveBeenCalledWith(200)
    const out = res.json.mock.calls[0][0]
    expect(out.score).toBe(1)
    expect(out.correct).toBe(1)
    expect(out.incorrect).toBe(1)
    expect(out.notAttempted).toBe(0)
    expect(out.total).toBe(2)
    expect(out.review[0]).toHaveProperty('answer') // review reveals the key
    expect(out.myAnswers).toEqual({ 1: 'A', 2: 'C' })
  })

  it('inserts a quiz_attempts row with the graded result', async () => {
    const client = makeMockClient()
    vi.mocked(createClient).mockReturnValue(client)
    await call({ mobile: '9876543210', quizId: 'quiz-1', answers: { 1: 'A', 2: 'B' } })
    expect(client.insert).toHaveBeenCalledWith(expect.objectContaining({
      quiz_id: 'quiz-1', lws_id: 'LWS001', student_name: 'Arjun Sharma',
      score: 2, correct: 2, incorrect: 0, not_attempted: 0,
    }))
  })

  it('rejects submission after the close time (403, no insert)', async () => {
    const client = makeMockClient({ quiz: makeQuiz({ closes_at: pastIso() }) })
    vi.mocked(createClient).mockReturnValue(client)
    const res = await call({ mobile: '9876543210', quizId: 'quiz-1', answers: { 1: 'A' } })
    expect(res.status).toHaveBeenCalledWith(403)
    expect(client.insert).not.toHaveBeenCalled()
  })

  it('rejects a draft quiz (403)', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ quiz: makeQuiz({ status: 'draft' }) }))
    const res = await call({ mobile: '9876543210', quizId: 'quiz-1', answers: { 1: 'A' } })
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rejects a second submission (409, no insert)', async () => {
    const client = makeMockClient({ existingAttempts: [{ id: 'att-1' }] })
    vi.mocked(createClient).mockReturnValue(client)
    const res = await call({ mobile: '9876543210', quizId: 'quiz-1', answers: { 1: 'A' } })
    expect(res.status).toHaveBeenCalledWith(409)
    expect(client.insert).not.toHaveBeenCalled()
  })

  it('returns 409 when the insert hits a UNIQUE violation (race)', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ insertError: { message: 'duplicate key' } }))
    const res = await call({ mobile: '9876543210', quizId: 'quiz-1', answers: { 1: 'A' } })
    expect(res.status).toHaveBeenCalledWith(409)
  })
})
