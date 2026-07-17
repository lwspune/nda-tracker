// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_EXAM_ROW = {
  id:      'exam1',
  name:    'NDA Test 1',
  date:    '2025-06-01',
  subject: 'Maths',
}

const MOCK_RESULT_ROWS = [
  { student_name: 'Arjun Sharma', correct: 20, incorrect: 5, not_attempted: 5 },
  { student_name: 'Ravi Kumar',   correct: 15, incorrect: 8, not_attempted: 7 },
]

const MOCK_STUDENTS = [
  { canonical_name: 'Arjun Sharma', mobile: '9876543210', parent_mobiles: [], name_variants: [] },
  { canonical_name: 'Ravi Kumar',   mobile: '9123456789', parent_mobiles: [], name_variants: [] },
]

// ── Mock client factories ─────────────────────────────────────────────────────

function makeAnonClient({ user = { id: 'faculty-uid' } } = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  }
}

// DB client used for exam queries (second createClient call, JWT-scoped)
function makeQueryClient({
  allExams    = [MOCK_EXAM_ROW],
  resultRows  = MOCK_RESULT_ROWS,
  students    = MOCK_STUDENTS,
  examsError  = null,
  resultsError = null,
} = {}) {
  return {
    from: vi.fn(table => {
      if (table === 'exams') {
        return { select: vi.fn().mockResolvedValue({ data: allExams, error: examsError }) }
      }
      if (table === 'exam_results') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: resultRows, error: resultsError }),
          }),
        }
      }
      // students
      return { select: vi.fn().mockResolvedValue({ data: students, error: null }) }
    }),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Use mockImplementation + per-call counter to avoid mockReturnValueOnce stacking
// across tests when clearAllMocks doesn't reset queued once-values.
function setupMocks({ anonClient = makeAnonClient(), queryClient = makeQueryClient() } = {}) {
  let callCount = 0
  vi.mocked(createClient).mockImplementation(() => ++callCount === 1 ? anonClient : queryClient)
}

function mockWabridge(ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(
      ok ? { status: 1, data: { messageid: 'msg1' } }
         : { status: 0, message: 'send failed' }
    ),
  }))
}

async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-whatsapp.js')
  const req = {
    method,
    body,
    headers: { authorization: `Bearer ${jwt}` },
  }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL      = 'https://test.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.WABRIDGE_APP_KEY       = 'app-key'
  process.env.WABRIDGE_AUTH_KEY      = 'auth-key'
  process.env.WABRIDGE_DEVICE_ID     = 'device-id'
  process.env.WABRIDGE_TEMPLATE_ID   = 'template-id'
  setupMocks()
  mockWabridge()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/send-whatsapp', () => {
  // ── Method / config validation ─────────────────────────────────────────────

  it('returns 405 for non-POST requests', async () => {
    const res = await call({}, { method: 'GET' })
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('returns 500 if Wabridge credentials are missing', async () => {
    delete process.env.WABRIDGE_APP_KEY
    const res = await call({ examName: 'NDA Test 1' })
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
  })

  // ── Auth ───────────────────────────────────────────────────────────────────

  it('returns 401 if Authorization header is missing', async () => {
    const { default: handler } = await import('../send-whatsapp.js')
    const req = { method: 'POST', body: {}, headers: {} }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 401 if JWT is invalid (user not found)', async () => {
    setupMocks({ anonClient: makeAnonClient({ user: null }) })
    const res = await call({ examName: 'NDA Test 1' })
    expect(res.status).toHaveBeenCalledWith(401)
  })

  // ── Exam lookup (from exams table, not faculty_state) ──────────────────────

  it('queries exams table — not faculty_state — to find the exam', async () => {
    const queryClient = makeQueryClient()
    setupMocks({ queryClient })
    await call({ examName: 'NDA Test 1' })
    const tablesCalled = queryClient.from.mock.calls.map(c => c[0])
    expect(tablesCalled).toContain('exams')
    expect(tablesCalled).not.toContain('faculty_state')
  })

  it('returns 404 if exam name not found in exams table', async () => {
    setupMocks({ queryClient: makeQueryClient({ allExams: [] }) })
    const res = await call({ examName: 'Unknown Exam' })
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
  })

  it('returns 500 if exams query fails', async () => {
    setupMocks({ queryClient: makeQueryClient({ examsError: { message: 'DB error' } }) })
    const res = await call({ examName: 'NDA Test 1' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('falls back to most recent exam when examName is omitted', async () => {
    const older = { ...MOCK_EXAM_ROW, id: 'exam0', name: 'Old Exam', date: '2025-01-01' }
    const newer = { ...MOCK_EXAM_ROW, id: 'exam2', name: 'New Exam', date: '2025-12-01' }
    setupMocks({ queryClient: makeQueryClient({ allExams: [older, newer] }) })
    const res = await call({})
    expect(res.status).not.toHaveBeenCalledWith(404)
  })

  // ── Results lookup (from exam_results table) ───────────────────────────────

  it('queries exam_results by exam id to get student results', async () => {
    const queryClient = makeQueryClient()
    setupMocks({ queryClient })
    await call({ examName: 'NDA Test 1' })
    const tablesCalled = queryClient.from.mock.calls.map(c => c[0])
    expect(tablesCalled).toContain('exam_results')
  })

  it('returns 500 if exam_results query fails', async () => {
    setupMocks({ queryClient: makeQueryClient({ resultsError: { message: 'DB error' } }) })
    const res = await call({ examName: 'NDA Test 1' })
    expect(res.status).toHaveBeenCalledWith(500)
  })

  // ── Send behaviour ─────────────────────────────────────────────────────────

  it('returns 200 with sent count equal to students with mobiles', async () => {
    const res = await call({ examName: 'NDA Test 1' })
    expect(res.status).toHaveBeenCalledWith(200)
    const body = res.json.mock.calls[0][0]
    expect(body.ok).toBe(true)
    expect(body.sent).toBe(2)
    expect(body.skipped).toBe(0)
  })

  it('counts student without mobile as skipped', async () => {
    setupMocks({
      queryClient: makeQueryClient({
        students: [
          { canonical_name: 'Arjun Sharma', mobile: '9876543210', parent_mobiles: [], name_variants: [] },
          { canonical_name: 'Ravi Kumar',   mobile: '',           parent_mobiles: [], name_variants: [] },
        ],
      }),
    })
    const res = await call({ examName: 'NDA Test 1' })
    const body = res.json.mock.calls[0][0]
    expect(body.sent).toBe(1)
    expect(body.skipped).toBe(1)
  })

  it('filters students to only those in the students body param', async () => {
    const res = await call({ examName: 'NDA Test 1', students: ['Arjun Sharma'] })
    const body = res.json.mock.calls[0][0]
    // Only Arjun was in the filter, so only 1 sent
    expect(body.sent).toBe(1)
  })

  // ── Blocked-contact guard ──────────────────────────────────────────────────
  // A blocked / quit / inactive student must never be messaged, even when they
  // still have an exam_results row (e.g. blocked after sitting the exam). Server
  // enforced (fail-safe) — the client can't opt them back in by omitting a filter.

  it('never sends to a Block student (dropped before student + parent legs)', async () => {
    setupMocks({
      queryClient: makeQueryClient({
        students: [
          { canonical_name: 'Arjun Sharma', mobile: '9876543210', parent_mobiles: ['9000000001'], name_variants: [], account_status: 'Active' },
          { canonical_name: 'Ravi Kumar',   mobile: '9123456789', parent_mobiles: ['9000000002'], name_variants: [], account_status: 'Block' },
        ],
      }),
    })
    const res = await call({ examName: 'NDA Test 1' })
    const body = res.json.mock.calls[0][0]
    // Arjun: student + parent = 2 sent. Ravi (Block): 0.
    expect(body.sent).toBe(2)
    expect(body.blocked).toBe(1)
    // Ravi's numbers never hit the wire.
    const dests = global.fetch.mock.calls.map(c => JSON.parse(c[1].body).destination_number)
    expect(dests).not.toContain('919123456789')
    expect(dests).not.toContain('919000000002')
  })

  it('excludes a Block student from the monitoring sample', async () => {
    setupMocks({
      queryClient: makeQueryClient({
        students: [
          { canonical_name: 'Arjun Sharma', mobile: '9876543210', parent_mobiles: [], name_variants: [], account_status: 'Active' },
          { canonical_name: 'Ravi Kumar',   mobile: '9123456789', parent_mobiles: [], name_variants: [], account_status: 'Block' },
        ],
      }),
    })
    await call({ examName: 'NDA Test 1', monitorMobiles: ['9021869427'] })
    const monitorCall = global.fetch.mock.calls.find(c => JSON.parse(c[1].body).destination_number === '919021869427')
    // The sampled name is always the only non-blocked student.
    expect(JSON.parse(monitorCall[1].body).variables[0]).toBe('Arjun Sharma')
  })

  it('treats a blank/legacy status as active (still sends)', async () => {
    setupMocks({
      queryClient: makeQueryClient({
        students: [
          { canonical_name: 'Arjun Sharma', mobile: '9876543210', parent_mobiles: [], name_variants: [], account_status: '' },
          { canonical_name: 'Ravi Kumar',   mobile: '9123456789', parent_mobiles: [], name_variants: [] }, // no field at all
        ],
      }),
    })
    const res = await call({ examName: 'NDA Test 1' })
    const body = res.json.mock.calls[0][0]
    expect(body.sent).toBe(2)
    expect(body.blocked).toBe(0)
  })

  it('uses exam name from exams table (case-insensitive match)', async () => {
    const res = await call({ examName: 'nda test 1' })
    // Should still find the exam and return 200
    expect(res.status).toHaveBeenCalledWith(200)
  })

  // ── Tracker deep-link (so parents land on the specific result) ─────────────

  // The tracker URL is the 7th template variable (index 6).
  function trackerUrlsFromFetch() {
    return global.fetch.mock.calls.map(c => JSON.parse(c[1].body).variables[6])
  }

  it('embeds the exam id in every tracker link (deep-link to the result)', async () => {
    await call({ examName: 'NDA Test 1' })
    const urls = trackerUrlsFromFetch()
    expect(urls.length).toBeGreaterThan(0)
    urls.forEach(u => expect(u).toContain('exam=exam1'))
  })

  it('pre-fills the student mobile + exam id on the PARENT message link', async () => {
    // Previously the parent link was the bare tracker base (no pre-fill) — a
    // parent had to guess which number to type. Now it carries the student's
    // own mobile (one-tap, right child, no sibling picker) + the exam id.
    setupMocks({
      queryClient: makeQueryClient({
        students: [{ canonical_name: 'Arjun Sharma', mobile: '9876543210', parent_mobiles: ['9000000001'], name_variants: [] }],
        resultRows: [{ student_name: 'Arjun Sharma', correct: 20, incorrect: 5, not_attempted: 5 }],
      }),
    })
    await call({ examName: 'NDA Test 1' })
    const urls = trackerUrlsFromFetch()
    expect(urls).toHaveLength(2) // student + 1 parent
    urls.forEach(u => {
      expect(u).toContain('mobile=9876543210')
      expect(u).toContain('exam=exam1')
    })
  })

  // ── Message name = canonical roster spelling (not the exam-sheet variant) ──
  const namesFromFetch = () => global.fetch.mock.calls.map(c => JSON.parse(c[1].body).variables[0])

  it('shows the canonical roster spelling even when the exam sheet used a variant', async () => {
    setupMocks({
      queryClient: makeQueryClient({
        students: [{ canonical_name: 'Vedant Bechawade', mobile: '9876543210', parent_mobiles: ['9000000001'], name_variants: ['Vedant Bechavade'] }],
        resultRows: [{ student_name: 'Vedant Bechavade', correct: 10, incorrect: 5, not_attempted: 5 }],
      }),
    })
    await call({ examName: 'NDA Test 1' })
    const names = namesFromFetch()
    expect(names.length).toBeGreaterThan(0)         // student + parent
    names.forEach(n => expect(n).toBe('Vedant Bechawade'))  // canonical, not the sheet's 'Bechavade'
  })

  it('falls back to the exam-sheet name when no profile matches', async () => {
    setupMocks({
      queryClient: makeQueryClient({
        students: [],
        resultRows: [{ student_name: 'No Profile Student', correct: 1, incorrect: 0, not_attempted: 0 }],
      }),
    })
    await call({ examName: 'NDA Test 1', redirectTo: '9999999999' })
    expect(namesFromFetch()).toContain('No Profile Student')
  })

  // ── Monitoring copy (one random student's message → monitor number) ─────────

  const destsFromFetch = () => global.fetch.mock.calls.map(c => JSON.parse(c[1].body).destination_number)

  it('sends one monitoring copy to each configured monitor number', async () => {
    const res = await call({ examName: 'NDA Test 1', monitorMobiles: ['9021869427'] })
    const body = res.json.mock.calls[0][0]
    expect(body.monitor).toBe(1)
    expect(destsFromFetch()).toContain('919021869427')
  })

  it('sends a monitoring copy to every monitor number when several are set', async () => {
    const res = await call({ examName: 'NDA Test 1', monitorMobiles: ['9021869427', '9876500000'] })
    const body = res.json.mock.calls[0][0]
    expect(body.monitor).toBe(2)
    const dests = destsFromFetch()
    expect(dests).toContain('919021869427')
    expect(dests).toContain('919876500000')
  })

  it('the monitoring message is a real student\'s result (7 template variables)', async () => {
    await call({ examName: 'NDA Test 1', monitorMobiles: ['9021869427'] })
    const monitorCall = global.fetch.mock.calls.find(c => JSON.parse(c[1].body).destination_number === '919021869427')
    const vars = JSON.parse(monitorCall[1].body).variables
    expect(vars).toHaveLength(7)
    expect(['Arjun Sharma', 'Ravi Kumar']).toContain(vars[0])
  })

  it('does NOT send a monitoring copy on a test send (redirectTo set)', async () => {
    const res = await call({ examName: 'NDA Test 1', redirectTo: '9999999999', monitorMobiles: ['9021869427'] })
    const body = res.json.mock.calls[0][0]
    expect(body.monitor).toBe(0)
    expect(destsFromFetch()).not.toContain('919021869427')
  })

  it('sends no monitoring copy when monitorMobiles is empty or absent', async () => {
    const res = await call({ examName: 'NDA Test 1' })
    const body = res.json.mock.calls[0][0]
    expect(body.monitor).toBe(0)
    expect(destsFromFetch()).not.toContain('919021869427')
  })

  it('skips a malformed monitor number but still sends to valid ones', async () => {
    const res = await call({ examName: 'NDA Test 1', monitorMobiles: ['123', '9021869427'] })
    const body = res.json.mock.calls[0][0]
    expect(body.monitor).toBe(1)
    expect(destsFromFetch()).toContain('919021869427')
    expect(body.lines.some(l => l.includes('SKIP monitor 123'))).toBe(true)
  })
})
