import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}))

import { supabase } from '../../../lib/supabase'
import { createTeacherFeedbackSlice } from '../teacherFeedbackSlice'

function makeQueryBuilder({ selectData = [], selectError = null, insertError = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.insert = vi.fn(() => Promise.resolve({ error: insertError }))
  builder.then   = (res, rej) => Promise.resolve({ data: selectData, error: selectError }).then(res, rej)
  return builder
}

function mockSupabase({ sessionActive = true, ...opts } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionActive ? { user: { id: 'sa', email: 'super@lws' } } : null },
  })
  const builder = makeQueryBuilder(opts)
  supabase.from.mockReturnValue(builder)
  return { builder }
}

function makeStore() {
  let state = {}
  const get = () => state
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  return { slice: createTeacherFeedbackSlice(set, get) }
}

describe('loadTeacherFeedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows ordered by submitted_at', async () => {
    const rows = [{ id: 'r1', teacher_name: 'Akash Rathod Sir', clarity: 4 }]
    const { builder } = mockSupabase({ selectData: rows })
    const { slice } = makeStore()
    expect(await slice.loadTeacherFeedback()).toEqual(rows)
    expect(builder.order).toHaveBeenCalledWith('submitted_at', { ascending: false })
  })

  it('returns [] without a session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.loadTeacherFeedback()).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns [] on error (e.g. RLS denies a non-superadmin)', async () => {
    mockSupabase({ selectError: { message: 'permission denied' } })
    const { slice } = makeStore()
    expect(await slice.loadTeacherFeedback()).toEqual([])
  })
})

describe('importTeacherFeedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts rows tagged with created_by and normalised nulls', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const res = await slice.importTeacherFeedback([
      { cycle: 'C1', branch: 'LWS Pune', submitted_at: '2026-05-30T16:40:37+05:30', teacher_name: 'Akash Rathod Sir',
        clarity: 4, engagement: 4, support: 4, feedback: 5, pace: 4, respect: 4, organization: 4, availability: 4, comment: 'More practice' },
    ])
    expect(res).toEqual({ ok: true, inserted: 1 })
    const payload = builder.insert.mock.calls[0][0]
    expect(payload[0].created_by).toBe('super@lws')
    expect(payload[0].teacher_name).toBe('Akash Rathod Sir')
  })

  it('returns reason=empty for empty input', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.importTeacherFeedback([])).toEqual({ ok: false, inserted: 0, reason: 'empty' })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns reason=no_session without a session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.importTeacherFeedback([{ cycle: 'C1', teacher_name: 'A' }])).toEqual({ ok: false, inserted: 0, reason: 'no_session' })
  })

  it('surfaces the insert error reason (RLS denial)', async () => {
    mockSupabase({ insertError: { message: 'new row violates row-level security policy' } })
    const { slice } = makeStore()
    const res = await slice.importTeacherFeedback([{ cycle: 'C1', teacher_name: 'A' }])
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/row-level security/)
  })
})
