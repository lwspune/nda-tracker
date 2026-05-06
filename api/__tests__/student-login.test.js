// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

// ── Fixtures ──────────────────────────────────────────────────────
const MOCK_STUDENT = {
  canonical_name: 'Arjun Sharma',
  lws_id: 'LWS001',
  mobile: '9876543210',
  name_variants: [],
  parent_mobiles: [],
  branch: 'Pune',
  registration_date: '2025-01-01',
  account_status: 'Active',
  coming_status: 'Regular',
  dob: '2005-01-01',
  gender: 'M',
  student_batches: [{ batch_name: 'LWS_NDA_2Y_(25-27)' }],
}

const MOCK_EXAM = {
  id: 'exam1',
  name: 'NDA Test 1',
  date: '2025-06-01',
  students: [
    { name: 'Arjun Sharma', correct: 80, incorrect: 20, notAttempted: 50 },
    { name: 'Other Student', correct: 60, incorrect: 30, notAttempted: 60 },
  ],
}

const MOCK_STATE = {
  data: { exams: [MOCK_EXAM], ndaFreqBySubject: { Maths: {} } },
}

// ── Mock client factory ───────────────────────────────────────────
function makeMockClient({ students = [MOCK_STUDENT], stateData = MOCK_STATE,
                          studentsError = null, stateError = null } = {}) {
  return {
    from: vi.fn(table => {
      if (table === 'students') {
        return { select: vi.fn().mockResolvedValue({ data: students, error: studentsError }) }
      }
      // faculty_state
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: stateData, error: stateError }),
          }),
        }),
      }
    }),
  }
}

// ── Call helper ───────────────────────────────────────────────────
async function call(body, method = 'POST') {
  const { default: handler } = await import('../student-login.js')
  const req = { method, body, headers: {} }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

// ── Tests ─────────────────────────────────────────────────────────
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  vi.mocked(createClient).mockReturnValue(makeMockClient())
})

describe('POST /api/student-login', () => {
  it('returns 405 for non-POST requests', async () => {
    const res = await call({}, 'GET')
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('returns 400 if mobile is missing', async () => {
    const res = await call({})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })

  it('returns 400 if mobile cannot be normalized to a valid Indian number', async () => {
    const res = await call({ mobile: '12345' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })

  it('returns 404 if no student found with that mobile', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ students: [] }))
    const res = await call({ mobile: '9999999999' })
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })

  it('returns 200 with student name, lwsId, profile, and filtered exams', async () => {
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(200)
    const result = res.json.mock.calls[0][0]
    expect(result.name).toBe('Arjun Sharma')
    expect(result.lwsId).toBe('LWS001')
    expect(result.profile).toMatchObject({ branch: 'Pune', regDate: '2025-01-01' })
    expect(result.ndaFreqBySubject).toBeDefined()
  })

  it('only includes this student\'s record in each exam\'s students array', async () => {
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.exams).toHaveLength(1)
    expect(result.exams[0].students).toHaveLength(1)
    expect(result.exams[0].students[0].name).toBe('Arjun Sharma')
  })

  it('matches exam records using name variants', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      students: [{ ...MOCK_STUDENT, name_variants: ['Arjun'] }],
      stateData: {
        data: {
          exams: [{
            id: 'exam2', name: 'GAT Test', date: '2025-07-01',
            students: [{ name: 'Arjun', correct: 70, incorrect: 10, notAttempted: 70 }],
          }],
          ndaFreqBySubject: {},
        },
      },
    }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.exams).toHaveLength(1)
    expect(result.exams[0].students[0].name).toBe('Arjun')
  })

  it('excludes exams where student has no record', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      stateData: {
        data: {
          exams: [
            { ...MOCK_EXAM },                           // has Arjun's record
            { id: 'exam2', name: 'Other Exam', date: '2025-07-01',
              students: [{ name: 'Other Student', correct: 50, incorrect: 10, notAttempted: 90 }] },
          ],
          ndaFreqBySubject: {},
        },
      },
    }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.exams).toHaveLength(1)
    expect(result.exams[0].name).toBe('NDA Test 1')
  })

  it('returns 500 if students Supabase query fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      makeMockClient({ students: null, studentsError: { message: 'DB error' } })
    )
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('returns 500 if faculty_state Supabase query fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      makeMockClient({ stateData: null, stateError: { message: 'DB error' } })
    )
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('uses SUPABASE_SERVICE_ROLE_KEY env var to create client', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'my-service-key'
    await call({ mobile: '9876543210' })
    expect(vi.mocked(createClient)).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'my-service-key'
    )
  })

  it('normalizes mobile with country code prefix', async () => {
    // +91 prefix should be treated same as 10-digit
    const res = await call({ mobile: '919876543210' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].name).toBe('Arjun Sharma')
  })
})
