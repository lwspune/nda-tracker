import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createExamAbsenceSlice } from '../examAbsenceSlice'

// ── Builder factory ─────────────────────────────────────────────────────────
// The slice issues several distinct queries in one method (select existing,
// delete diff, insert diff, update notified_at). Each `from()` returns a fresh
// builder via the factory below.

function makeBuilder({ data = [], error = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.gte    = vi.fn(() => builder)
  builder.in     = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.insert = vi.fn(() => builder)
  builder.then   = (onFulfilled, onRejected) =>
    Promise.resolve({ data, error }).then(onFulfilled, onRejected)
  return builder
}

function mockSession(active = true) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: active ? { user: { id: 'admin', email: 'admin@lws' } } : null },
  })
}

// queue: array of builders to return in order from successive supabase.from() calls
function mockFromQueue(builders) {
  let idx = 0
  supabase.from.mockImplementation(() => {
    const b = builders[idx] ?? makeBuilder()
    idx++
    return b
  })
}

function makeStore(overrides = {}) {
  let state = {
    exams: [],
    studentProfiles: {},
    ...overrides,
  }
  const get  = () => state
  const set  = fn  => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  return { slice: createExamAbsenceSlice(set, get), state, set }
}

// Minimal studentProfiles fixture used across tests
function fixtureProfiles() {
  return {
    'Alice': { lwsId: 'LWS-001', name: 'Alice', batches: ['B1'], nameVariants: [] },
    'Bob':   { lwsId: 'LWS-002', name: 'Bob',   batches: ['B1'], nameVariants: [] },
    'Cara':  { lwsId: 'LWS-003', name: 'Cara',  batches: ['B1'], nameVariants: [] },
    'Drew':  { lwsId: 'LWS-004', name: 'Drew',  batches: ['B2'], nameVariants: [] },
  }
}

beforeEach(() => vi.clearAllMocks())

// ── syncExamAbsences ─────────────────────────────────────────────────────────

describe('syncExamAbsences', () => {
  it('inserts rows for cohort members not in exam.students[]', async () => {
    mockSession(true)
    const existingBuilder = makeBuilder({ data: [] })  // no existing absences
    const insertBuilder   = makeBuilder()
    mockFromQueue([existingBuilder, insertBuilder])

    const { slice } = makeStore({
      exams: [{ id: 'e1', batch: 'B1', students: [{ name: 'Alice' }] }],
      studentProfiles: fixtureProfiles(),
    })

    const result = await slice.syncExamAbsences('e1')
    expect(result.added).toBe(2)    // Bob, Cara
    expect(result.removed).toBe(0)
    expect(insertBuilder.insert).toHaveBeenCalledOnce()
    const rows = insertBuilder.insert.mock.calls[0][0]
    expect(rows.map(r => r.lws_id).sort()).toEqual(['LWS-002', 'LWS-003'])
    expect(rows[0].exam_id).toBe('e1')
    expect(rows[0].marked_by).toBe('upload')
  })

  it('deletes rows for students who turned out to attend (after re-upload)', async () => {
    mockSession(true)
    // Existing: Bob and Cara marked absent
    const existingBuilder = makeBuilder({ data: [{ lws_id: 'LWS-002' }, { lws_id: 'LWS-003' }] })
    const deleteBuilder   = makeBuilder()
    mockFromQueue([existingBuilder, deleteBuilder])

    const { slice } = makeStore({
      // Re-upload: Bob now attended too; only Cara still absent
      exams: [{ id: 'e1', batch: 'B1', students: [{ name: 'Alice' }, { name: 'Bob' }] }],
      studentProfiles: fixtureProfiles(),
    })

    const result = await slice.syncExamAbsences('e1')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(1)
    expect(result.kept).toBe(1)
    expect(deleteBuilder.delete).toHaveBeenCalled()
    expect(deleteBuilder.in).toHaveBeenCalledWith('lws_id', ['LWS-002'])
  })

  it('preserves rows for students still absent (no INSERT, no DELETE)', async () => {
    mockSession(true)
    const existingBuilder = makeBuilder({ data: [{ lws_id: 'LWS-002' }, { lws_id: 'LWS-003' }] })
    mockFromQueue([existingBuilder])

    const { slice } = makeStore({
      exams: [{ id: 'e1', batch: 'B1', students: [{ name: 'Alice' }] }], // unchanged
      studentProfiles: fixtureProfiles(),
    })

    const result = await slice.syncExamAbsences('e1')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(result.kept).toBe(2)
  })

  it('returns no-op when exam is not found', async () => {
    mockSession(true)
    const { slice } = makeStore({ exams: [], studentProfiles: fixtureProfiles() })
    const result = await slice.syncExamAbsences('missing-id')
    expect(result).toEqual({ added: 0, removed: 0, kept: 0 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns no-op without a Supabase session', async () => {
    mockSession(false)
    const { slice } = makeStore({
      exams: [{ id: 'e1', batch: 'B1', students: [{ name: 'Alice' }] }],
      studentProfiles: fixtureProfiles(),
    })
    const result = await slice.syncExamAbsences('e1')
    expect(result).toEqual({ added: 0, removed: 0, kept: 0 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns no-op when exam.batch is empty (legacy/un-tagged exam)', async () => {
    mockSession(true)
    // No supabase.from call expected; exam has no batches so cohort is empty,
    // but we also don't need to clear any pre-existing rows here — the contract
    // is "compute and replace". An empty cohort with existing rows would DELETE all.
    const existingBuilder = makeBuilder({ data: [] })
    mockFromQueue([existingBuilder])

    const { slice } = makeStore({
      exams: [{ id: 'e1', batch: '', students: [] }],
      studentProfiles: fixtureProfiles(),
    })
    const result = await slice.syncExamAbsences('e1')
    expect(result).toEqual({ added: 0, removed: 0, kept: 0 })
  })
})

// ── getExamAbsencesForExam ───────────────────────────────────────────────────

describe('getExamAbsencesForExam', () => {
  it('returns rows for an exam', async () => {
    mockSession(true)
    const rows = [
      { lws_id: 'LWS-002', exam_id: 'e1', marked_at: '2026-05-21T10:00Z', notified_at: null },
      { lws_id: 'LWS-003', exam_id: 'e1', marked_at: '2026-05-21T10:00Z', notified_at: '2026-05-21T11:00Z' },
    ]
    const builder = makeBuilder({ data: rows })
    mockFromQueue([builder])

    const { slice } = makeStore()
    const result = await slice.getExamAbsencesForExam('e1')
    expect(result).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('exam_id', 'e1')
  })

  it('returns [] without session', async () => {
    mockSession(false)
    const { slice } = makeStore()
    expect(await slice.getExamAbsencesForExam('e1')).toEqual([])
  })

  it('returns [] for missing examId', async () => {
    mockSession(true)
    const { slice } = makeStore()
    expect(await slice.getExamAbsencesForExam('')).toEqual([])
  })
})

// ── getExamAbsencesForStudent ────────────────────────────────────────────────

describe('getExamAbsencesForStudent', () => {
  it('returns rows for a student, latest first', async () => {
    mockSession(true)
    const rows = [
      { lws_id: 'LWS-002', exam_id: 'e2', marked_at: '2026-05-22T10:00Z', notified_at: null },
      { lws_id: 'LWS-002', exam_id: 'e1', marked_at: '2026-05-21T10:00Z', notified_at: null },
    ]
    const builder = makeBuilder({ data: rows })
    mockFromQueue([builder])

    const { slice } = makeStore()
    const result = await slice.getExamAbsencesForStudent('LWS-002')
    expect(result).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('lws_id', 'LWS-002')
    expect(builder.order).toHaveBeenCalledWith('marked_at', { ascending: false })
  })

  it('applies sinceDate filter when provided', async () => {
    mockSession(true)
    const builder = makeBuilder({ data: [] })
    mockFromQueue([builder])

    const { slice } = makeStore()
    await slice.getExamAbsencesForStudent('LWS-002', '2026-05-01')
    expect(builder.gte).toHaveBeenCalledWith('marked_at', '2026-05-01')
  })

  it('returns [] without session or lwsId', async () => {
    mockSession(false)
    const { slice } = makeStore()
    expect(await slice.getExamAbsencesForStudent('LWS-002')).toEqual([])
    mockSession(true)
    expect(await slice.getExamAbsencesForStudent('')).toEqual([])
  })
})

// ── markExamAbsencesNotified ─────────────────────────────────────────────────

describe('markExamAbsencesNotified', () => {
  it('updates notified_at for matching (exam_id, lws_id) rows', async () => {
    mockSession(true)
    const builder = makeBuilder()
    mockFromQueue([builder])

    const { slice } = makeStore()
    const ok = await slice.markExamAbsencesNotified('e1', ['LWS-002', 'LWS-003'])
    expect(ok).toBe(true)
    expect(builder.update).toHaveBeenCalled()
    const patch = builder.update.mock.calls[0][0]
    expect(patch.notified_at).toBeDefined()
    expect(builder.eq).toHaveBeenCalledWith('exam_id', 'e1')
    expect(builder.in).toHaveBeenCalledWith('lws_id', ['LWS-002', 'LWS-003'])
  })

  it('is a no-op (no Supabase call) when lwsIds is empty', async () => {
    mockSession(true)
    const { slice } = makeStore()
    const ok = await slice.markExamAbsencesNotified('e1', [])
    expect(ok).toBe(true)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false without session', async () => {
    mockSession(false)
    const { slice } = makeStore()
    expect(await slice.markExamAbsencesNotified('e1', ['LWS-002'])).toBe(false)
  })
})
