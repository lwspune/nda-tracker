// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const STUDENT = {
  canonical_name: 'Arjun Sharma', lws_id: 'LWS001', mobile: '9876543210',
  account_status: 'Active', student_batches: [{ batch_name: 'BATCH_A' }],
}

const QUESTIONS = [
  { q: 1, question: 'A?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', answer: 'A', solution: 'because' },
]

function futureIso() { const d = new Date(); d.setHours(d.getHours() + 2); return d.toISOString() }
function pastIso()   { const d = new Date(); d.setHours(d.getHours() - 2); return d.toISOString() }

function quiz(over = {}) {
  return {
    id: 'q-a', title: 'Batch A Quiz', subject: 'Maths', marking: { correct: 1, wrong: 0 },
    questions: QUESTIONS, status: 'published', batch: 'BATCH_A', closes_at: futureIso(), ...over,
  }
}

function builder(data, error = null) {
  const b = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn(() => b)
  b.then = (resolve) => Promise.resolve({ data, error }).then(resolve)
  return b
}

function makeMockClient({ students = [STUDENT], quizzes = [quiz()], attempts = [] } = {}) {
  return {
    from: vi.fn(table => {
      if (table === 'students') return { select: vi.fn().mockResolvedValue({ data: students, error: null }) }
      if (table === 'quizzes') return builder(quizzes)
      if (table === 'quiz_attempts') return builder(attempts)
      return builder([])
    }),
  }
}

async function call(body, method = 'POST') {
  const { default: handler } = await import('../student-quizzes.js')
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

describe('POST /api/student-quizzes', () => {
  it('returns 405 for non-POST', async () => {
    expect((await call({}, 'GET')).status).toHaveBeenCalledWith(405)
  })

  it('returns 404 for an unknown mobile', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ students: [] }))
    expect((await call({ mobile: '9999999999' })).status).toHaveBeenCalledWith(404)
  })

  it('returns open quizzes targeting the student batch, with the answer key stripped', async () => {
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(200)
    const { quizzes } = res.json.mock.calls[0][0]
    expect(quizzes).toHaveLength(1)
    expect(quizzes[0].state).toBe('open')
    expect(quizzes[0].questions[0]).not.toHaveProperty('answer')
    expect(quizzes[0].questions[0]).not.toHaveProperty('solution')
    expect(quizzes[0].questions[0].optionA).toBe('1')
  })

  it('includes all-batches quizzes (empty batch field)', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ quizzes: [quiz({ batch: null })] }))
    const { quizzes } = (await call({ mobile: '9876543210' })).json.mock.calls.at(-1)[0]
    expect(quizzes).toHaveLength(1)
  })

  it('excludes quizzes for a different batch', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ quizzes: [quiz({ batch: 'BATCH_B' })] }))
    const { quizzes } = (await call({ mobile: '9876543210' })).json.mock.calls.at(-1)[0]
    expect(quizzes).toHaveLength(0)
  })

  it('marks an already-attempted quiz as done and reveals the key for review', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      attempts: [{ quiz_id: 'q-a', answers: { 1: 'A' }, score: 1, correct: 1, incorrect: 0, not_attempted: 0, submitted_at: 'x' }],
    }))
    const { quizzes } = (await call({ mobile: '9876543210' })).json.mock.calls.at(-1)[0]
    expect(quizzes).toHaveLength(1)
    expect(quizzes[0].state).toBe('done')
    expect(quizzes[0].questions[0]).toHaveProperty('answer') // review reveals key
    expect(quizzes[0].myAnswers).toEqual({ 1: 'A' })
    expect(quizzes[0].result.score).toBe(1)
  })

  it('excludes a closed quiz the student never attempted', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ quizzes: [quiz({ closes_at: pastIso() })] }))
    const { quizzes } = (await call({ mobile: '9876543210' })).json.mock.calls.at(-1)[0]
    expect(quizzes).toHaveLength(0)
  })

  it('still shows a closed quiz the student DID attempt (review survives close)', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      quizzes: [quiz({ closes_at: pastIso() })],
      attempts: [{ quiz_id: 'q-a', answers: { 1: 'A' }, score: 1, correct: 1, incorrect: 0, not_attempted: 0, submitted_at: 'x' }],
    }))
    const { quizzes } = (await call({ mobile: '9876543210' })).json.mock.calls.at(-1)[0]
    expect(quizzes).toHaveLength(1)
    expect(quizzes[0].state).toBe('done')
  })

  it('excludes draft quizzes (defensive JS guard in addition to the status query)', async () => {
    // The real query filters with .eq('status','published'); the mock ignores eq,
    // so this also asserts the handler defensively skips non-published rows.
    vi.mocked(createClient).mockReturnValue(makeMockClient({ quizzes: [quiz({ status: 'draft' })] }))
    const { quizzes } = (await call({ mobile: '9876543210' })).json.mock.calls.at(-1)[0]
    expect(quizzes).toHaveLength(0)
  })
})
