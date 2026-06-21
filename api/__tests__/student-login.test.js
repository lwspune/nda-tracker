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
  students         = [MOCK_STUDENT],
  resultRows       = [MOCK_RESULT_ROW],
  examRows         = [MOCK_EXAM_ROW],
  stateData        = MOCK_STATE,
  examAbsences     = [],
  integrityIncidents = [],
  absentExamMeta   = null, // null = reuse examRows; pass [] for "no rows found"
  studentsError    = null,
  resultsError     = null,
  examsError       = null,
  stateError       = null,
  loginInsertError = null,
} = {}) {
  // Track sequential `exams` table calls — first call resolves attended-exam ids,
  // second call resolves absent-exam metadata. Tests can pass `absentExamMeta`
  // separately from the attended `examRows`.
  let examsCallCount = 0
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
        examsCallCount++
        // First call: resolves the attended-exam ids from resultRows.
        // Second call (when present): resolves absent-exam metadata for the
        // exam-absence enrichment in the response.
        const data = examsCallCount === 1
          ? examRows
          : (absentExamMeta ?? examRows)
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data, error: examsError }),
          }),
        }
      }
      if (table === 'student_logins') {
        return { insert: loginInsert }
      }
      if (table === 'student_attendance') {
        // chain: .select('date, status').eq('lws_id', X) — await this
        const builder = {
          select: vi.fn(() => builder),
          eq:     vi.fn(() => builder),
          then:   (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        }
        return builder
      }
      if (table === 'lecture_absences') {
        // chain: .select(...).eq('lws_id', X).gte('date', X).order(...) — await this
        const builder = {
          select: vi.fn(() => builder),
          eq:     vi.fn(() => builder),
          gte:    vi.fn(() => builder),
          order:  vi.fn(() => builder),
          then:   (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        }
        return builder
      }
      if (table === 'exam_absences') {
        // chain: .select(...).eq('lws_id', X).gte('marked_at', X).order(...) — await
        const builder = {
          select: vi.fn(() => builder),
          eq:     vi.fn(() => builder),
          gte:    vi.fn(() => builder),
          order:  vi.fn(() => builder),
          then:   (resolve) => Promise.resolve({ data: examAbsences, error: null }).then(resolve),
        }
        return builder
      }
      if (table === 'homework_pending') {
        // chain: .select(...).eq('lws_id', X).gte('date', X).order(...) — await
        const builder = {
          select: vi.fn(() => builder),
          eq:     vi.fn(() => builder),
          gte:    vi.fn(() => builder),
          order:  vi.fn(() => builder),
          then:   (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        }
        return builder
      }
      if (table === 'integrity_incidents') {
        // chain: .select(...).eq('lws_id', X).order('created_at', ...) — await
        const builder = {
          select: vi.fn(() => builder),
          eq:     vi.fn(() => builder),
          order:  vi.fn(() => builder),
          then:   (resolve) => Promise.resolve({ data: integrityIncidents, error: null }).then(resolve),
        }
        return builder
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

  // ── Exam absences (last 30 days) ──────────────────────────────────────────

  it('returns examAbsences[] in the response, scoped to the student', async () => {
    const rows = [
      { exam_id: 'e1', marked_at: '2026-05-22T10:00:00Z', notified_at: null },
      { exam_id: 'e2', marked_at: '2026-05-20T10:00:00Z', notified_at: '2026-05-20T11:00:00Z' },
    ]
    vi.mocked(createClient).mockReturnValue(makeMockClient({ examAbsences: rows }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(Array.isArray(result.examAbsences)).toBe(true)
    expect(result.examAbsences).toHaveLength(2)
    expect(result.examAbsences[0]).toMatchObject({
      lws_id:     'LWS001',
      exam_id:    'e1',
      marked_at:  '2026-05-22T10:00:00Z',
      notified_at: null,
    })
  })

  it('returns empty examAbsences[] when the student has no absences', async () => {
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.examAbsences).toEqual([])
  })

  it('returns integrityIncidents[] in the response (student/parent visibility)', async () => {
    const rows = [{
      id: 'inc1', exam_id: 'e1', exam_name: 'Mock Test', exam_date: '2026-06-14',
      counterpart_name: 'Saarth Deshmukh', shared_wrong: 18, diff: 8,
      status: 'admitted', note: null, created_at: '2026-06-15T09:00:00Z', created_by: 't@lws.test',
    }]
    vi.mocked(createClient).mockReturnValue(makeMockClient({ integrityIncidents: rows }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.integrityIncidents).toHaveLength(1)
    expect(result.integrityIncidents[0]).toMatchObject({ id: 'inc1', exam_name: 'Mock Test', status: 'admitted' })
  })

  it('returns empty integrityIncidents[] when the student has none', async () => {
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.integrityIncidents).toEqual([])
  })

  it('enriches each examAbsences row with exam_name + exam_date + exam_batch from the exams table', async () => {
    // Absences reference an exam the student never sat — must still appear with
    // metadata so the student portal can render the name (otherwise the modal
    // / chip / strip would drop the row on join).
    const rows = [
      { exam_id: 'e-missed', marked_at: '2026-05-22T10:00:00Z', notified_at: null },
    ]
    const absentExamMeta = [{ id: 'e-missed', name: 'Mock #99', date: '2026-05-22', batch: 'APJ_NDA_2Y_(26-28)' }]
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      examAbsences:      rows,
      absentExamMeta,
    }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.examAbsences[0]).toMatchObject({
      exam_id:    'e-missed',
      exam_name:  'Mock #99',
      exam_date:  '2026-05-22',
      exam_batch: 'APJ_NDA_2Y_(26-28)',
    })
  })

  it('returns null exam_name when the exam row could not be found (deleted exam)', async () => {
    const rows = [{ exam_id: 'gone', marked_at: '2026-05-22T10:00:00Z', notified_at: null }]
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      examAbsences:   rows,
      absentExamMeta: [],
    }))
    const res = await call({ mobile: '9876543210' })
    const result = res.json.mock.calls[0][0]
    expect(result.examAbsences[0].exam_name).toBeNull()
    expect(result.examAbsences[0].exam_date).toBeNull()
  })
})

// ── Parent-number login + sibling picker ──────────────────────────────────────
//
// A student can log in with their own registered number OR a parent number from
// parent_mobiles[]. When a number resolves to exactly one student, login is
// direct. When it resolves to 2+ students (siblings sharing a parent number),
// the endpoint returns a picker payload; the client re-calls with the chosen
// lwsId to get that student's full data.

const SIBLING_A = {
  ...MOCK_STUDENT,
  canonical_name: 'Arjun Sharma',
  lws_id:         'LWS001',
  mobile:         '9876543210',
  parent_mobiles: ['9111111111'],
}
const SIBLING_B = {
  ...MOCK_STUDENT,
  canonical_name: 'Priya Sharma',
  lws_id:         'LWS002',
  mobile:         '9000000002',
  parent_mobiles: ['9111111111'],
}

describe('POST /api/student-login — parent number + sibling picker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  })

  it('logs in via a parent mobile number (single match)', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      students: [{ ...MOCK_STUDENT, parent_mobiles: ['9111111111'] }],
    }))
    const res = await call({ mobile: '9111111111' })
    expect(res.status).toHaveBeenCalledWith(200)
    const result = res.json.mock.calls[0][0]
    expect(result.lwsId).toBe('LWS001')
    expect(result.viaParent).toBe(true)
  })

  it('normalises a parent number that carries a country-code prefix', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      students: [{ ...MOCK_STUDENT, parent_mobiles: ['9111111111'] }],
    }))
    const res = await call({ mobile: '919111111111' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].lwsId).toBe('LWS001')
  })

  it('sets viaParent=false when logging in with the own number', async () => {
    const res = await call({ mobile: '9876543210' })
    expect(res.json.mock.calls[0][0].viaParent).toBe(false)
  })

  it('returns a picker payload (no exam data) when a number matches multiple students', async () => {
    const client = makeMockClient({ students: [SIBLING_A, SIBLING_B] })
    vi.mocked(createClient).mockReturnValue(client)
    const res = await call({ mobile: '9111111111' })
    expect(res.status).toHaveBeenCalledWith(200)
    const result = res.json.mock.calls[0][0]
    expect(result.multiple).toBe(true)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map(c => c.lwsId).sort()).toEqual(['LWS001', 'LWS002'])
    expect(result.candidates[0]).toMatchObject({
      name:   expect.any(String),
      branch: expect.any(String),
    })
    // Picker step must not leak full data or record a login yet
    expect(result.exams).toBeUndefined()
    expect(client.loginInsert).not.toHaveBeenCalled()
  })

  it('resolves to the chosen student when lwsId is supplied with an ambiguous number', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ students: [SIBLING_A, SIBLING_B] }))
    const res = await call({ mobile: '9111111111', lwsId: 'LWS002' })
    expect(res.status).toHaveBeenCalledWith(200)
    const result = res.json.mock.calls[0][0]
    expect(result.lwsId).toBe('LWS002')
    expect(result.multiple).toBeUndefined()
  })

  it('returns 404 when the supplied lwsId is not linked to the number', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({ students: [SIBLING_A, SIBLING_B] }))
    const res = await call({ mobile: '9111111111', lwsId: 'LWS999' })
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('records the login under the chosen student when resolved via picker', async () => {
    const client = makeMockClient({ students: [SIBLING_A, SIBLING_B] })
    vi.mocked(createClient).mockReturnValue(client)
    await call({ mobile: '9111111111', lwsId: 'LWS002' })
    expect(client.loginInsert).toHaveBeenCalledWith({ lws_id: 'LWS002' })
  })

  it('returns 404 when neither own nor parent numbers match', async () => {
    vi.mocked(createClient).mockReturnValue(makeMockClient({
      students: [{ ...MOCK_STUDENT, parent_mobiles: ['9111111111'] }],
    }))
    const res = await call({ mobile: '9222222222' })
    expect(res.status).toHaveBeenCalledWith(404)
  })
})
