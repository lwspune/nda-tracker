// @vitest-environment node
// The homework kinds of api/student-quizzes.js (2026-10-12): list, start an
// upload, submit. Same mobile identity as the quiz endpoints, plus the LWS ID.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const DAY = 864e5
const STUDENT = {
  canonical_name: 'Arjun Sharma', lws_id: 'L1', mobile: '9876543210',
  account_status: 'Active', student_batches: [{ batch_name: '12th_A' }],
}
const assignment = (over = {}) => ({
  id: 'a1', title: 'Limits', subject: 'Maths', instructions: 'Ex 2.3', batch_names: ['12th_A'],
  question_files: [{ path: 'a1/questions/01.pdf', name: 'limits.pdf' }],
  answer_key_files: [{ path: 'a1/key/01.pdf', name: 'key.pdf' }], questions: [],
  max_marks: 10, due_at: new Date(Date.now() + DAY).toISOString(), status: 'published', created_by: 'teach@x',
  ...over,
})

// A chainable PostgREST builder that resolves to { data, error } and records filters.
function builder(result, log, table) {
  const b = {}
  for (const m of ['select', 'eq', 'overlaps', 'order', 'in']) {
    b[m] = vi.fn((...args) => { log.push([table, m, ...args]); return b })
  }
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error ?? null }))
  b.then = (ok, bad) => Promise.resolve({ data: result.data, error: result.error ?? null }).then(ok, bad)
  return b
}

function makeClient({
  students = [STUDENT], assignments = [assignment()], submissions = [],
  rpcError = null, stored = null, signFail = false,
} = {}) {
  const log = []
  const client = {
    log,
    from: vi.fn(table => {
      if (table === 'students') return builder({ data: students }, log, table)
      if (table === 'homework_assignments') return builder({ data: assignments }, log, table)
      if (table === 'homework_submissions') return builder({ data: submissions }, log, table)
      return builder({ data: [] }, log, table)
    }),
    rpc: vi.fn((name, args) => { log.push(['rpc', name, args]); return Promise.resolve({ error: rpcError }) }),
    storage: {
      from: vi.fn(bucket => ({
        createSignedUrls: vi.fn((paths, ttl) => {
          log.push(['sign', bucket, paths, ttl])
          return Promise.resolve(signFail ? { data: null, error: { message: 'x' } }
            : { data: paths.map(p => ({ path: p, signedUrl: `https://signed/${p}` })), error: null })
        }),
        createSignedUploadUrl: vi.fn(path => {
          log.push(['signUpload', bucket, path])
          return Promise.resolve({ data: { path, token: `tok-${path}`, signedUrl: `https://up/${path}` }, error: null })
        }),
        list: vi.fn(folder => {
          log.push(['list', bucket, folder])
          return Promise.resolve({ data: (stored ?? []).map(name => ({ name })), error: null })
        }),
      })),
    },
  }
  return client
}

async function call(body) {
  const { default: handler } = await import('../student-quizzes.js')
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler({ method: 'POST', body, headers: {} }, res)
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
}

let client
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  client = makeClient()
  vi.mocked(createClient).mockImplementation(() => client)
})

const who = { mobile: '9876543210', lwsId: 'L1' }

describe('kind: homework-list', () => {
  it('returns the student\'s homework with signed question-paper links', async () => {
    const r = await call({ kind: 'homework-list', ...who })
    expect(r.status).toBe(200)
    expect(r.body.name).toBe('Arjun Sharma')
    expect(r.body.homework[0]).toMatchObject({
      id: 'a1', state: 'open', canSubmit: true,
      questionFiles: [{ name: 'limits.pdf', url: 'https://signed/a1/questions/01.pdf' }],
    })
  })

  it('asks the database only for published homework in the student\'s batches', async () => {
    await call({ kind: 'homework-list', ...who })
    expect(client.log).toContainEqual(['homework_assignments', 'eq', 'status', 'published'])
    expect(client.log).toContainEqual(['homework_assignments', 'overlaps', 'batch_names', ['12th_A']])
  })

  it('never signs or sends the answer key', async () => {
    const r = await call({ kind: 'homework-list', ...who })
    expect(JSON.stringify(r.body)).not.toMatch(/key\.pdf|a1\/key|teach@x/)
    const signed = client.log.filter(l => l[0] === 'sign').flatMap(l => l[2])
    expect(signed).toEqual(['a1/questions/01.pdf'])
  })

  it('refuses a blocked student and an ID that is not on the number', async () => {
    client = makeClient({ students: [{ ...STUDENT, account_status: 'Quit' }] })
    expect((await call({ kind: 'homework-list', ...who })).status).toBe(403)
    client = makeClient()
    expect((await call({ kind: 'homework-list', mobile: '9876543210', lwsId: 'L9' })).status).toBe(404)
  })

  it('still serves the existing quiz list when no kind is given', async () => {
    client = makeClient()
    client.from = vi.fn(table => builder({ data: table === 'students' ? [STUDENT] : [] }, client.log, table))
    const r = await call({ mobile: '9876543210' })
    expect(r.status).toBe(200)
    expect(r.body).toHaveProperty('quizzes')
  })
})

describe('kind: homework-start', () => {
  const files = [{ type: 'image/jpeg', size: 1000 }, { type: 'image/jpeg', size: 2000 }]

  it('starts the submission in the database and returns one signed upload per page', async () => {
    const r = await call({ kind: 'homework-start', ...who, assignmentId: 'a1', files })
    expect(r.status).toBe(200)
    const id = r.body.submissionId
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const rpc = client.log.find(l => l[0] === 'rpc')
    expect(rpc).toEqual(['rpc', 'homework_submission_start', {
      p_id: id, p_assignment: 'a1', p_lws_id: 'L1', p_files: [`a1/L1/${id}/01.jpg`, `a1/L1/${id}/02.jpg`],
    }])
    expect(r.body.uploads).toEqual([
      { path: `a1/L1/${id}/01.jpg`, token: `tok-a1/L1/${id}/01.jpg` },
      { path: `a1/L1/${id}/02.jpg`, token: `tok-a1/L1/${id}/02.jpg` },
    ])
    expect(client.log.filter(l => l[0] === 'signUpload').every(l => l[1] === 'homework-submissions')).toBe(true)
  })

  it('refuses a file type the grader cannot read before touching the database', async () => {
    const r = await call({ kind: 'homework-start', ...who, assignmentId: 'a1', files: [{ type: 'image/heic', size: 5 }] })
    expect(r.status).toBe(400)
    expect(client.log.some(l => l[0] === 'rpc')).toBe(false)
  })

  // The database function checks the deadline and one-per-student, but not the
  // batch: that is the endpoint's job.
  it('refuses homework set for another batch', async () => {
    client = makeClient({ assignments: [assignment({ batch_names: ['12th_B'] })] })
    const r = await call({ kind: 'homework-start', ...who, assignmentId: 'a1', files })
    expect(r.status).toBe(404)
    expect(client.log.some(l => l[0] === 'rpc')).toBe(false)
  })

  it('refuses after the deadline and after a submission', async () => {
    client = makeClient({ assignments: [assignment({ due_at: new Date(Date.now() - 1000).toISOString() })] })
    expect((await call({ kind: 'homework-start', ...who, assignmentId: 'a1', files })).status).toBe(409)
    client = makeClient({ submissions: [{ id: 's', assignment_id: 'a1', status: 'submitted', files: ['x'] }] })
    expect((await call({ kind: 'homework-start', ...who, assignmentId: 'a1', files })).status).toBe(409)
  })

  it('reports the database\'s refusal as a 409, not a crash', async () => {
    client = makeClient({ rpcError: { message: 'homework a1: the deadline has passed' } })
    const r = await call({ kind: 'homework-start', ...who, assignmentId: 'a1', files })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/deadline/i)
  })
})

describe('kind: homework-submit', () => {
  const upload = { id: 's1', assignment_id: 'a1', lws_id: 'L1', status: 'uploading', files: ['a1/L1/s1/01.jpg', 'a1/L1/s1/02.jpg'] }

  it('submits once every page is in storage', async () => {
    client = makeClient({ submissions: [upload], stored: ['01.jpg', '02.jpg'] })
    const r = await call({ kind: 'homework-submit', ...who, submissionId: 's1' })
    expect(r.status).toBe(200)
    expect(client.log).toContainEqual(['list', 'homework-submissions', 'a1/L1/s1'])
    expect(client.log.find(l => l[0] === 'rpc')).toEqual(['rpc', 'homework_submission_submit', { p_id: 's1', p_lws_id: 'L1' }])
  })

  it('refuses while a page is missing, so a half-uploaded set is never graded', async () => {
    client = makeClient({ submissions: [upload], stored: ['01.jpg'] })
    const r = await call({ kind: 'homework-submit', ...who, submissionId: 's1' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/upload/i)
    expect(client.log.some(l => l[0] === 'rpc')).toBe(false)
  })

  it('looks the submission up only among this student\'s own', async () => {
    client = makeClient({ submissions: [], stored: ['01.jpg', '02.jpg'] })
    const r = await call({ kind: 'homework-submit', ...who, submissionId: 's1' })
    expect(r.status).toBe(404)
    expect(client.log).toContainEqual(['homework_submissions', 'eq', 'lws_id', 'L1'])
  })

  it('reports a deadline that passed mid-upload as a 409', async () => {
    client = makeClient({ submissions: [upload], stored: ['01.jpg', '02.jpg'], rpcError: { message: 'submission s1: the deadline has passed' } })
    const r = await call({ kind: 'homework-submit', ...who, submissionId: 's1' })
    expect(r.status).toBe(409)
  })
})

it('rejects an unknown kind', async () => {
  expect((await call({ kind: 'homework-delete', ...who })).status).toBe(400)
})
