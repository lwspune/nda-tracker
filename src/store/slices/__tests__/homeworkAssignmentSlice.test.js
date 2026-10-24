import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn() } },
}))

import { supabase } from '../../../lib/supabase'
import { createHomeworkAssignmentSlice } from '../homeworkAssignmentSlice'
import { blankAssignment } from '../../../lib/assignments/editor'

// A fake Supabase that records every write in order, so the tests can pin the
// sequence the storage policy depends on (row first, then files, then publish).
function fakeSupabase({ sessionEmail = 'teach@x', rows = [], failUpload = false, failFinal = false, deleteError = null } = {}) {
  const log = []
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionEmail ? { user: { email: sessionEmail } } : null },
  })
  let upserts = 0
  supabase.from.mockImplementation(table => {
    const b = {}
    b.select = vi.fn(() => b)
    b.order = vi.fn(() => b)
    b.eq = vi.fn((col, val) => { log.push(['eq', table, col, val]); return b })
    b.delete = vi.fn(() => { log.push(['delete', table]); return b })
    b.upsert = vi.fn(row => {
      upserts += 1
      log.push(['upsert', table, { status: row.status, q: row.question_files.length, k: row.answer_key_files.length }])
      b._result = failFinal && upserts > 1 ? { data: null, error: { message: 'final failed' } } : { data: row, error: null }
      return b
    })
    b.single = vi.fn(() => Promise.resolve(b._result))
    b.then = (ok, bad) => Promise.resolve(
      b._result ?? (log.at(-1)?.[0] === 'eq' && log.some(l => l[0] === 'delete') ? { error: deleteError } : { data: rows, error: null })
    ).then(ok, bad)
    return b
  })
  supabase.storage.from.mockImplementation(bucket => ({
    upload: vi.fn((path) => {
      log.push(['upload', bucket, path])
      return Promise.resolve(failUpload ? { error: { message: 'too big' } } : { data: { path }, error: null })
    }),
    remove: vi.fn(paths => { log.push(['remove', bucket, paths]); return Promise.resolve({ error: null }) }),
    createSignedUrl: vi.fn((path, ttl) => Promise.resolve({ data: { signedUrl: `https://signed/${path}?ttl=${ttl}` }, error: null })),
  }))
  return { log }
}

function makeStore() {
  let state = {}
  const get = () => state
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  state = createHomeworkAssignmentSlice(set, get)
  return { get }
}

const draft = () => ({
  ...blankAssignment('teach@x'),
  title: 'Limits', subject: 'Maths', batchNames: ['12th_A'], maxMarks: 10, dueAt: '2026-10-20T12:30:00.000Z',
})
const pdf = name => ({ name, type: 'application/pdf', size: 100 })

describe('homeworkAssignmentSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('crypto', { randomUUID: () => 'new-id' })
  })

  it('starts empty', () => {
    expect(makeStore().get().homeworkAssignments).toEqual([])
  })

  it('loads rows into the client shape', async () => {
    fakeSupabase({ rows: [{ id: 'a', title: 'T', subject: 'Maths', batch_names: ['x'], max_marks: '10', status: 'draft', created_by: 'teach@x', due_at: 'd' }] })
    const s = makeStore()
    await s.get().loadHomeworkAssignments()
    expect(s.get().homeworkAssignments[0]).toMatchObject({ id: 'a', maxMarks: 10, batchNames: ['x'] })
  })

  describe('saveHomeworkAssignment', () => {
    // The storage policy only admits a file for an assignment row that already
    // exists, so a NEW assignment is saved as a draft first, then its files go
    // up, then the row is updated with the file list (and published).
    it('creates the row, uploads, then publishes — in that order', async () => {
      const { log } = fakeSupabase()
      const s = makeStore()
      const r = await s.get().saveHomeworkAssignment(draft(), { questionFiles: [pdf('q.pdf')], keyFiles: [pdf('k.pdf')], publish: true })
      expect(r.ok).toBe(true)
      expect(log.filter(l => l[0] === 'upsert' || l[0] === 'upload')).toEqual([
        ['upsert', 'homework_assignments', { status: 'draft', q: 0, k: 0 }],
        ['upload', 'homework-files', 'new-id/questions/01.pdf'],
        ['upload', 'homework-files', 'new-id/key/01.pdf'],
        ['upsert', 'homework_assignments', { status: 'published', q: 1, k: 1 }],
      ])
      expect(s.get().homeworkAssignments.map(a => [a.id, a.status])).toEqual([['new-id', 'published']])
    })

    it('stamps the signed-in email as the creator, whatever the draft said', async () => {
      fakeSupabase({ sessionEmail: 'teach@x' })
      const s = makeStore()
      const r = await s.get().saveHomeworkAssignment({ ...draft(), createdBy: 'someone@else' }, { publish: false })
      expect(r.assignment.createdBy).toBe('teach@x')
    })

    it('updates an existing assignment in one write when there are no new files', async () => {
      const { log } = fakeSupabase()
      const s = makeStore()
      await s.get().saveHomeworkAssignment({ ...draft(), id: 'old', questionFiles: [{ path: 'old/questions/01.pdf' }] }, { publish: true })
      expect(log.filter(l => l[0] === 'upsert')).toEqual([['upsert', 'homework_assignments', { status: 'published', q: 1, k: 0 }]])
    })

    it('stops and reports when an upload fails, leaving the assignment a draft', async () => {
      const { log } = fakeSupabase({ failUpload: true })
      const s = makeStore()
      const r = await s.get().saveHomeworkAssignment(draft(), { questionFiles: [pdf('q.pdf')], publish: true })
      expect(r).toMatchObject({ ok: false })
      expect(r.error).toMatch(/q\.pdf/)
      expect(log.filter(l => l[0] === 'upsert')).toHaveLength(1)
      expect(s.get().homeworkAssignments[0].status).toBe('draft')
    })

    it('refuses a file the grader cannot read before touching anything', async () => {
      const { log } = fakeSupabase()
      const s = makeStore()
      const r = await s.get().saveHomeworkAssignment(draft(), { questionFiles: [{ name: 'a.docx', type: 'application/msword', size: 5 }] })
      expect(r.ok).toBe(false)
      expect(log).toEqual([])
    })

    it('needs a signed-in session', async () => {
      fakeSupabase({ sessionEmail: null })
      const r = await makeStore().get().saveHomeworkAssignment(draft(), {})
      expect(r).toMatchObject({ ok: false })
    })
  })

  describe('deleteHomeworkAssignment', () => {
    // Row first: the database refuses to delete homework that has submissions
    // (FK RESTRICT), and in that case the question paper must stay.
    it('deletes the row, then its files', async () => {
      const { log } = fakeSupabase()
      const s = makeStore()
      const a = { ...draft(), id: 'a1', questionFiles: [{ path: 'a1/questions/01.pdf' }], answerKeyFiles: [{ path: 'a1/key/01.pdf' }] }
      const r = await s.get().deleteHomeworkAssignment(a)
      expect(r.ok).toBe(true)
      const order = log.filter(l => l[0] === 'delete' || l[0] === 'remove').map(l => l[0])
      expect(order).toEqual(['delete', 'remove'])
      expect(log.find(l => l[0] === 'remove')[2]).toEqual(['a1/questions/01.pdf', 'a1/key/01.pdf'])
    })

    it('keeps the files and reports when the database refuses', async () => {
      const { log } = fakeSupabase({ deleteError: { message: 'violates foreign key constraint' } })
      const s = makeStore()
      const r = await s.get().deleteHomeworkAssignment({ ...draft(), id: 'a1', questionFiles: [{ path: 'a1/questions/01.pdf' }] })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/submitted/i)
      expect(log.some(l => l[0] === 'remove')).toBe(false)
    })
  })

  it('signs a short-lived link to a file', async () => {
    fakeSupabase()
    const url = await makeStore().get().getHomeworkFileUrl('homework-submissions', 'a/L1/s/01.jpg')
    expect(url).toBe('https://signed/a/L1/s/01.jpg?ttl=600')
  })

  // 2026-10-24: the slip-pages download signs every page in one call.
  describe('getHomeworkFileUrls', () => {
    it('signs many files at once, keyed by path', async () => {
      const createSignedUrls = vi.fn(async paths => ({ data: paths.map(p => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }))
      supabase.storage.from.mockImplementation(() => ({ createSignedUrls }))
      const urls = await makeStore().get().getHomeworkFileUrls('homework-submissions', ['a/01.jpg', 'a/02.jpg'])
      expect(createSignedUrls).toHaveBeenCalledWith(['a/01.jpg', 'a/02.jpg'], 600)
      expect(urls).toEqual({ 'a/01.jpg': 'https://signed/a/01.jpg', 'a/02.jpg': 'https://signed/a/02.jpg' })
    })

    it('is null on a failed signing', async () => {
      supabase.storage.from.mockImplementation(() => ({ createSignedUrls: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) }))
      expect(await makeStore().get().getHomeworkFileUrls('homework-submissions', ['a/01.jpg'])).toBeNull()
    })
  })

  describe('getHomeworkPageMarks', () => {
    const fakeMarks = result => {
      const b = {}
      b.select = vi.fn(() => b)
      b.in = vi.fn(() => Promise.resolve(result))
      supabase.from.mockImplementation(() => b)
      return b
    }

    it('reads which page each question\'s marks are on, for the given submissions', async () => {
      const b = fakeMarks({ data: [{ submission_id: 's1', label: 'Q2', page: 2 }], error: null })
      const r = await makeStore().get().getHomeworkPageMarks(['s1', 's2'])
      expect(supabase.from).toHaveBeenCalledWith('homework_page_marks')
      expect(b.select).toHaveBeenCalledWith('submission_id, label, page')
      expect(b.in).toHaveBeenCalledWith('submission_id', ['s1', 's2'])
      expect(r).toEqual([{ submissionId: 's1', label: 'Q2', page: 2 }])
    })

    it('skips the read when there are no submissions, and is null on a failed read', async () => {
      supabase.from.mockReset()
      expect(await makeStore().get().getHomeworkPageMarks([])).toEqual([])
      expect(supabase.from).not.toHaveBeenCalled()
      fakeMarks({ data: null, error: { message: 'boom' } })
      expect(await makeStore().get().getHomeworkPageMarks(['s1'])).toBeNull()
    })
  })

  // 2026-10-13: a grade held for a handwriting check is released or sent back
  // through one database function, which checks who is asking.
  describe('resolveHeldHomework', () => {
    beforeEach(() => { supabase.rpc.mockReset() })

    it('releases through the database function', async () => {
      supabase.rpc.mockResolvedValue({ data: 'graded', error: null })
      const r = await makeStore().get().resolveHeldHomework('s2', 'release')
      expect(r).toEqual({ ok: true })
      expect(supabase.rpc).toHaveBeenCalledWith('homework_held_resolve', { p_submission: 's2', p_action: 'release', p_reason: null })
    })

    it('sends back with the reason', async () => {
      supabase.rpc.mockResolvedValue({ data: 'rejected', error: null })
      await makeStore().get().resolveHeldHomework('s2', 'reject', '  Redo it in your own handwriting.  ')
      expect(supabase.rpc).toHaveBeenCalledWith('homework_held_resolve', {
        p_submission: 's2', p_action: 'reject', p_reason: 'Redo it in your own handwriting.',
      })
    })

    it('passes the database\'s refusal on to the page', async () => {
      supabase.rpc.mockResolvedValue({ data: null, error: { message: 'This homework was set by another teacher.' } })
      const r = await makeStore().get().resolveHeldHomework('s2', 'release')
      expect(r).toEqual({ ok: false, error: 'This homework was set by another teacher.' })
    })
  })

  describe('getHomeworkReferenceFiles', () => {
    it('returns the reference submission\'s pages for a student', async () => {
      supabase.from.mockImplementation(() => {
        const b = {}
        b.select = vi.fn(() => b)
        b.eq = vi.fn(() => b)
        b.maybeSingle = vi.fn(() => Promise.resolve({
          data: { submission_id: 'r1', homework_submissions: { files: ['p/01.jpg'], scans_deleted_at: null } }, error: null,
        }))
        return b
      })
      const r = await makeStore().get().getHomeworkReferenceFiles('L2')
      expect(supabase.from).toHaveBeenCalledWith('homework_hand_references')
      expect(r).toEqual({ submissionId: 'r1', files: ['p/01.jpg'], scansDeletedAt: null })
    })

    it('is null when the student has no reference yet, and on a failed read', async () => {
      for (const result of [{ data: null, error: null }, { data: null, error: { message: 'boom' } }]) {
        supabase.from.mockImplementation(() => {
          const b = {}
          b.select = vi.fn(() => b)
          b.eq = vi.fn(() => b)
          b.maybeSingle = vi.fn(() => Promise.resolve(result))
          return b
        })
        expect(await makeStore().get().getHomeworkReferenceFiles('L2')).toBeNull()
      }
    })
  })

  // 2026-10-16: emailing marked-paper reports, from the live site through the
  // homework endpoint (kind 'report-email'), with the admin's session.
  describe('emailHomeworkReports', () => {
    const reply = (status, json) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status === 200, status, json: async () => json })))

    it('posts the ids and test address with the session token and returns the result', async () => {
      reply(200, { ok: true, sent: [{ id: 's1' }], skipped: [], failed: [], test: false })
      const r = await makeStore().get().emailHomeworkReports(['s1'], 'office@lws.com')
      expect(r).toMatchObject({ ok: true, sent: [{ id: 's1' }] })
      const [url, init] = fetch.mock.calls[0]
      expect(url).toBe('/api/send-homework-pending')
      expect(init.headers.Authorization).toMatch(/^Bearer /)
      expect(JSON.parse(init.body)).toEqual({ kind: 'report-email', ids: ['s1'], testTo: 'office@lws.com' })
    })

    it('passes the server refusal back', async () => {
      reply(400, { ok: false, error: 'The test address is not an email address.' })
      expect(await makeStore().get().emailHomeworkReports(['s1'], 'x')).toEqual({ ok: false, error: 'The test address is not an email address.' })
    })

    it('refuses without a session, sending nothing', async () => {
      supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
      vi.stubGlobal('fetch', vi.fn())
      const r = await makeStore().get().emailHomeworkReports(['s1'], null)
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sign in/i) })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('says so when the server cannot be reached', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
      const r = await makeStore().get().emailHomeworkReports(['s1'], null)
      expect(r.ok).toBe(false)
      expect(r.error).not.toMatch(/npm run dev/)
    })
  })
})
