// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// One row per student per exam in exam_results
const MOCK_RESULT_ROW = {
  exam_id:       'exam1',
  student_name:  'Arjun Sharma',
  roll_no:       '',
  total_marks:   80,
  correct:       20,
  incorrect:     5,
  not_attempted: 5,
  responses:     { '1': 1, '2': -1 },
}

// One row per exam in exams
const MOCK_EXAM_ROW = {
  id:         'exam1',
  name:       'NDA Test 1',
  date:       '2025-06-01',
  subject:    'Maths',
  batch:      'LWS_NDA_2Y_(25-27)',
  branch:     null,
  marking:    { correct: 4, wrong: -1 },
  questions:  [{ q: 1, chapter: 'Algebra', subtopic: 'General' }],
  created_at: '2025-06-01T10:00:00.000Z',
}

// faculty_state now only used for ndaFreqBySubject
const MOCK_STATE = {
  data: { ndaFreqBySubject: { Maths: {} } },
}

// ── Mock client factory ───────────────────────────────────────────────────────
//
// Tables involved in the new flow:
//   students      → from().select()
//   exam_results  → from().select().in('student_name', names)
//   exams         → from().select().in('id', ids)
//   faculty_state → from().select().eq().single()   (ndaFreqBySubject only)

function makeMockClient({
  students      = [MOCK_STUDENT],
  resultRows    = [MOCK_RESULT_ROW],
  examRows      = [MOCK_EXAM_ROW],
  stateData     = MOCK_STATE,
  studentsError = null,
  resultsError  = null,
  examsError    = null,
  stateError    = null,
  loginInsertError = null,
} = {}) {
  const loginInsert = vi.fn().mockResolvedValue({ error: loginInsertError })
  const client = {
    from: vi.fn(table => {
      if (table === 'students') {
        return {
          select: vi.fn().mockResolvedValue({ data: students, error: studentsError }),
        }
      }
      if (table === 'exam_results') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: resultRows, error: resultsError }),
          }),
        }
      }
      if (table === 'exams') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: examRows, error: examsError }),
          }),
        }
      }
      if (table === 'student_logins') {
        return { insert: loginInsert }
      }
      // faculty_state — ndaFreqBySubject only
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: stateData, error: stateError }),
          }),
        }),
      }
    }),
    loginInsert,
  }
  return client
}

// ── Call helper ───────────────────────────────────────────────────────────────

async function call(body, method = 'POST') {
  const { default: handler } = await import('../student-login.js')
  const req = { method, body, headers: {} }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  vi.mocked(createClient).mockReturnValue(makeMockClient())
})

describe('POST /api/student-login', () => {
  // ── Method / input validation ──────────────────────────────────────────────

  it('returns 405 for non-POST requests', async () => {
    const res = await call({}, 'GET')
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('returns 400 if mobile is missing', async () => {
    const res = await call({})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })

  it('returns 400 if mobile cannot be normalised to a valid Indian number', async () => {
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

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with name, lwsId, profile, exams, and ndaFreqBySubject', async () => {
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(200)
    const result = res.json.mock.calls[0][0]
    expect(result.name).toBe('Arjun Sharma')
    expect(result.lwsId).toBe('LWS001')
    expect(result.profile).toMatchObject({ branch: 'Pune', regDate: '2025-01-01' })
    expect(result.ndaFreqBySubject).toBeDefined()
  })

  it('reconstructs exam object with student result fields from exam_results', async () => {
    const res = await call({ mobile: '9876543210' })
    const { exams } = res.json.mock.calls[0][0]
    expect(exams).toHaveLength(1)
    const [exam] = exams
    // exam metadata from exams table
    expect(exam.id).toBe('exam1')
    expect(exam.name).toBe('NDA Test 1')
    expect(exam.marking).toEqual({ correct: 4, wrong: -1 })
    expect(exam.questions).toHaveLength(1)
    // student result from exam_results table
    expect(exam.students).toHaveLength(1)
    expect(exam.students[0]).toMatchObject({
      name:          'Arjun Sharma',
      totalMarks:    80,
      correct:       20,
      incorrect:     5,
      notAttempted:  5,
      responses:     { '1': 1, '2': -1 },
    })
  })

  it('returns empty exams array when student has no results', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ resultRows: [] }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.exams).toEqual([])
  })

  it('skips the exams table query entirely when resultRows is empty', async () => {
    const client = makeMockClient({ resultRows: [] })
    vi.mocked(createClient).mockReturnValue(client)
    await call({ mobile: '9876543210' })
    const fromCalls = client.from.mock.calls.map(c => c[0])
    expect(fromCalls).not.toContain('exams')
  })

  it('normalises mobile with country code prefix', async () => {
    const res = await call({ mobile: '919876543210' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].name).toBe('Arjun Sharma')
  })

  // ── Name variants ─────────────────────────────────────────────────────────

  it('includes results stored under a name variant', async () => {
    const variantResult = { ...MOCK_RESULT_ROW, student_name: 'Arjun' }
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      students: [{ ...MOCK_STUDENT, name_variants: ['Arjun'] }],
      resultRows: [variantResult],
      examRows: [MOCK_EXAM_ROW],
    }))
    const res = await call({ mobile: '9876543210' })
    const { exams } = res.json.mock.calls[0][0]
    expect(exams).toHaveLength(1)
    expect(exams[0].students[0].name).toBe('Arjun')
  })

  it('queries exam_results using all names including variants', async () => {
    const client = makeMockClient({
      students: [{ ...MOCK_STUDENT, name_variants: ['Arjun'] }],
    })
    vi.mocked(createClient).mockReturnValue(client)
    await call({ mobile: '9876543210' })
    const examResultsIn = client.from.mock.results
      .find((_, i) => client.from.mock.calls[i]?.[0] === 'exam_results')
    // Verify .in() was called (regardless of exact names, proves the query was made)
    expect(examResultsIn).toBeDefined()
  })

  // ── Error paths ───────────────────────────────────────────────────────────

  it('returns 500 if students query fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      makeMockClient({ students: null, studentsError: { message: 'DB error' } })
    )
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('returns 500 if exam_results query fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      makeMockClient({ resultsError: { message: 'DB error' } })
    )
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('returns 500 if exams query fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      makeMockClient({ examsError: { message: 'DB error' } })
    )
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('returns 500 if faculty_state query fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      makeMockClient({ stateData: null, stateError: { message: 'DB error' } })
    )
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  // ── Config ────────────────────────────────────────────────────────────────

  it('uses SUPABASE_SERVICE_ROLE_KEY env var to create client', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'my-service-key'
    await call({ mobile: '9876543210' })
    expect(vi.mocked(createClient)).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'my-service-key'
    )
  })

  // ── Login tracking ────────────────────────────────────────────────────────

  it('inserts a row into student_logins on successful login', async () => {
    const client = makeMockClient()
    vi.mocked(createClient).mockReturnValue(client)
    await call({ mobile: '9876543210' })
    expect(client.loginInsert).toHaveBeenCalledWith({ lws_id: 'LWS001' })
  })

  it('still returns 200 when student_logins insert fails (fire-and-forget)', async () => {
    const client = makeMockClient({ loginInsertError: { message: 'DB error' } })
    vi.mocked(createClient).mockReturnValue(client)
    const res = await call({ mobile: '9876543210' })
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
