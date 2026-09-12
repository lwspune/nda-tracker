// @vitest-environment node
//
// The inbound half of the cross-app bridge: PYQ Vault pushes a finished paper
// and it lands here as a DRAFT exam, carrying the diagrams the tagged .xlsx
// cannot. It does NOT replace the tags-file flow — that stays live and remains
// the proven path.
//
// Lives inside quiz-import.js behind a `kind` discriminator for the same reason
// as hydrate-questions: Vercel Hobby hard-fails the build above 12 api/*.js and
// we are at 12. Its auth is a THIRD model in that one file — VAULT_SYNC_SECRET,
// the same per-institute secret we PRESENT when hydrating, used in reverse.
//
// The two assertions that matter most are the guards:
//   - a re-push onto an exam WITH RESULTS is refused (409), never overwritten;
//   - a re-push onto a clean draft PRESERVES the date/batch/marking faculty set.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const PAPER_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const EXAM_ID = `exam_vault_${PAPER_ID}`

const QUESTIONS = [
  { q: 1, questionId: 'q1', question: 'stem 1', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', answer: 'B' },
  { q: 2, questionId: 'q2', question: 'stem 2', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', answer: 'C' },
]

function body(over = {}) {
  return { kind: 'paper', paperId: PAPER_ID, title: 'NDA Mock 7', subject: 'Maths', questions: QUESTIONS, ...over }
}

/**
 * Mock the two reads and the write, routed by table name.
 * `resultCount` drives the results guard; `existing` is the current exams row.
 */
function mockDb({ resultCount = 0, existing = null, upsertError = null } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  createClient.mockReturnValue({
    from: vi.fn((table) => {
      if (table === 'exam_results') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: resultCount, error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          }),
        }),
        upsert,
      }
    }),
  })
  return { upsert }
}

async function call(b, { auth = 'Bearer institute-secret' } = {}) {
  const { default: handler } = await import('../quiz-import.js')
  const req = { method: 'POST', body: b, headers: auth ? { authorization: auth } : {} }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler(req, res)
  return res
}

const payloadOf = (res) => res.json.mock.calls[0][0]

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://tracker.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('VAULT_SYNC_SECRET', 'institute-secret')
  vi.stubEnv('QUIZ_IMPORT_SECRET', 'import-secret')
})

describe('quiz-import — kind: paper — auth', () => {
  it('401s with no Authorization header', async () => {
    mockDb()
    expect((await call(body(), { auth: null })).status).toHaveBeenCalledWith(401)
  })

  it('401s on a wrong secret', async () => {
    mockDb()
    expect((await call(body(), { auth: 'Bearer nope' })).status).toHaveBeenCalledWith(401)
  })

  it('does NOT accept the quiz import secret — these are different boundaries', async () => {
    mockDb()
    expect((await call(body(), { auth: 'Bearer import-secret' })).status).toHaveBeenCalledWith(401)
  })

  it('500s when the push is not configured at all', async () => {
    vi.stubEnv('VAULT_SYNC_SECRET', '')
    mockDb()
    expect((await call(body())).status).toHaveBeenCalledWith(500)
  })
})

describe('quiz-import — kind: paper — validation', () => {
  it('400s without a paperId', async () => {
    mockDb()
    expect((await call(body({ paperId: '' }))).status).toHaveBeenCalledWith(400)
  })

  it('400s without a title', async () => {
    mockDb()
    expect((await call(body({ title: '  ' }))).status).toHaveBeenCalledWith(400)
  })

  it('400s on an empty paper rather than creating an exam with no questions', async () => {
    mockDb()
    expect((await call(body({ questions: [] }))).status).toHaveBeenCalledWith(400)
  })
})

describe('quiz-import — kind: paper — GUARD: never overwrite a conducted exam', () => {
  it('409s when the exam already has results', async () => {
    const { upsert } = mockDb({ resultCount: 37, existing: { id: EXAM_ID } })
    const res = await call(body())
    expect(res.status).toHaveBeenCalledWith(409)
    // The whole point: nothing was written.
    expect(upsert).not.toHaveBeenCalled()
  })

  it('names the exam and the result count, so the operator knows what it is protecting', async () => {
    mockDb({ resultCount: 37 })
    const res = await call(body())
    const out = payloadOf(res)
    expect(out.error).toContain('NDA Mock 7')
    expect(out.error).toContain('37')
    expect(out.examId).toBe(EXAM_ID)
  })
})

describe('quiz-import — kind: paper — writing', () => {
  it('upserts under a deterministic, namespaced id so a re-push updates rather than duplicating', async () => {
    const { upsert } = mockDb()
    await call(body())
    const row = upsert.mock.calls[0][0]
    expect(row.id).toBe(EXAM_ID)
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'id' })
    // must never look like a hand-made exam_<timestamp>
    expect(/^exam_\d+$/.test(row.id)).toBe(false)
  })

  it('fills the NOT NULL columns the vault cannot know, rather than failing the insert', async () => {
    const { upsert } = mockDb()
    await call(body())
    const row = upsert.mock.calls[0][0]
    expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(row.source).toBe('admin') // CHECK is admin|teacher; 'teacher' tags parent reports
    expect(row.marking).toEqual({ correct: 4, wrong: -1 })
    expect(row.name).toBe('NDA Mock 7')
    expect(row.questions).toHaveLength(2)
  })

  it('PRESERVES what faculty already set when re-pushing a clean draft', async () => {
    const existing = {
      id: EXAM_ID,
      date: '2026-03-01',
      batch: 'NDA 2026 Morning',
      branch: 'FC Road',
      marking: { correct: 2.5, wrong: -0.83 },
      subject: 'Maths',
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'someone',
      source: 'admin',
      max_marks: 300,
    }
    const { upsert } = mockDb({ existing })
    await call(body({ title: 'NDA Mock 7 (revised)' }))
    const row = upsert.mock.calls[0][0]
    // the vault owns these
    expect(row.name).toBe('NDA Mock 7 (revised)')
    expect(row.questions).toHaveLength(2)
    // …and must not clobber these
    expect(row.date).toBe('2026-03-01')
    expect(row.batch).toBe('NDA 2026 Morning')
    expect(row.branch).toBe('FC Road')
    expect(row.marking).toEqual({ correct: 2.5, wrong: -0.83 })
    expect(row.created_at).toBe('2026-01-01T00:00:00Z')
    expect(row.max_marks).toBe(300)
  })

  it('reports success with the exam id and count', async () => {
    mockDb()
    const res = await call(body())
    expect(res.status).toHaveBeenCalledWith(200)
    const out = payloadOf(res)
    expect(out).toMatchObject({ ok: true, examId: EXAM_ID, questionCount: 2, updated: false })
  })

  it('flags an update so the operator knows a draft was replaced', async () => {
    mockDb({ existing: { id: EXAM_ID, date: '2026-03-01' } })
    const out = payloadOf(await call(body()))
    expect(out.updated).toBe(true)
    expect(out.warning).toMatch(/preserved/i)
  })

  it('500s (not 200) when the write fails — a failed push must not read as success', async () => {
    mockDb({ upsertError: { message: 'boom' } })
    expect((await call(body())).status).toHaveBeenCalledWith(500)
  })
})

/**
 * SITTINGS — one paper, conducted more than once.
 *
 * A paper is routinely run for batch A on Monday and batch B on Thursday. Each
 * conduct owns its own date, batch and results, so each must be its own exam;
 * before this, the id derived from the PAPER, so the second conduct upserted the
 * first exam and — once it had results — was refused outright.
 *
 * The constraint that shapes it: SITTING 1 KEEPS THE ORIGINAL UNSUFFIXED ID.
 * Nine drafts are live in production on `exam_vault_<paperId>`, and suffixing
 * them would orphan every one.
 */
describe('quiz-import — kind: paper — sittings', () => {
  it('treats an absent sittingNo as 1, so a pre-sittings vault deploys unchanged', async () => {
    const { upsert } = mockDb()
    await call(body())
    expect(upsert.mock.calls[0][0].id).toBe(EXAM_ID)
  })

  it('leaves sitting 1 on the original unsuffixed id — the nine live drafts depend on it', async () => {
    const { upsert } = mockDb()
    await call(body({ sittingNo: 1 }))
    expect(upsert.mock.calls[0][0].id).toBe(`exam_vault_${PAPER_ID}`)
  })

  it('gives a second conduct its OWN exam rather than overwriting the first', async () => {
    const { upsert } = mockDb()
    await call(body({ sittingNo: 2, title: 'NDA Mock 7 — Batch B' }))
    const written = upsert.mock.calls[0][0]
    expect(written.id).toBe(`exam_vault_${PAPER_ID}_s2`)
    expect(written.id).not.toBe(EXAM_ID)
    expect(written.name).toBe('NDA Mock 7 — Batch B')
  })

  it('stays namespaced on a later sitting — never collides with a hand-made exam_<timestamp>', async () => {
    const { upsert } = mockDb()
    await call(body({ sittingNo: 3 }))
    expect(upsert.mock.calls[0][0].id.startsWith('exam_vault_')).toBe(true)
  })

  it('checks results against THIS sitting, so sitting 1 having results cannot block sitting 2', async () => {
    // The guard reads exam_results for the derived id. A fresh sitting id has
    // none, so a conducted sitting 1 must not refuse a brand-new sitting 2.
    const { upsert } = mockDb({ resultCount: 0 })
    const res = await call(body({ sittingNo: 2 }))
    expect(res.status).toHaveBeenCalledWith(200)
    expect(upsert).toHaveBeenCalled()
  })

  it('400s on a nonsense sittingNo rather than filing the paper under an id nobody recorded', async () => {
    mockDb()
    for (const bad of [0, -1, 1.5, 'two']) {
      const res = await call(body({ sittingNo: bad }))
      expect(res.status).toHaveBeenCalledWith(400)
    }
  })

  it('still refuses to overwrite a conducted sitting, and says so machine-readably', async () => {
    // The CODE is what lets the vault offer "push as a new sitting" instead of
    // presenting a dead end. Without it the caller has only a sentence.
    mockDb({ resultCount: 32 })
    const res = await call(body({ sittingNo: 2 }))
    expect(res.status).toHaveBeenCalledWith(409)
    const p = payloadOf(res)
    expect(p.code).toBe('has_results')
    expect(p.resultCount).toBe(32)
    expect(p.sittingNo).toBe(2)
    expect(p.examId).toBe(`exam_vault_${PAPER_ID}_s2`)
  })
})
