import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createLeavesSlice } from '../leavesSlice'

function makeQueryBuilder({ data = [], error = null, insertError = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.gte    = vi.fn(() => builder)
  builder.lte    = vi.fn(() => builder)
  builder.or     = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.insert = vi.fn(() => Promise.resolve({ error: insertError }))
  builder.then   = (onFulfilled, onRejected) =>
    Promise.resolve({ data, error }).then(onFulfilled, onRejected)
  return builder
}

function mockSupabase({ sessionActive = true, ...builderOpts } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionActive ? { user: { id: 'admin', email: 'admin@lws' } } : null },
  })
  const builder = makeQueryBuilder(builderOpts)
  supabase.from.mockReturnValue(builder)
  return { builder }
}

function makeStore() {
  let state = {}
  const get = () => state
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  return { slice: createLeavesSlice(set, get) }
}

// ── addLeave ──────────────────────────────────────────────────

describe('addLeave', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a leave stamped with the approving admin', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.addLeave({
      lwsId: 'S1',
      fromTs: '2026-07-08T00:00:00Z',
      toTs: '2026-07-10T00:00:00Z',
      type: 'leave',
      reason: 'family function',
    })
    expect(ok).toBe(true)
    expect(builder.insert.mock.calls[0][0]).toEqual({
      lws_id: 'S1',
      from_ts: '2026-07-08T00:00:00Z',
      to_ts: '2026-07-10T00:00:00Z',
      type: 'leave',
      reason: 'family function',
      approved_by: 'admin@lws',
    })
  })

  it('defaults the type to leave', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    await slice.addLeave({ lwsId: 'S1', fromTs: '2026-07-08T00:00:00Z', toTs: '2026-07-08T18:00:00Z' })
    expect(builder.insert.mock.calls[0][0].type).toBe('leave')
  })

  it('inserts an OPEN-ENDED leave (to_ts null) when toTs is omitted', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.addLeave({ lwsId: 'S1', fromTs: '2026-07-08T00:00:00Z' })
    expect(ok).toBe(true)
    expect(builder.insert.mock.calls[0][0].to_ts).toBe(null)
  })

  it('treats an empty-string toTs as open-ended (to_ts null)', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.addLeave({ lwsId: 'S1', fromTs: '2026-07-08T00:00:00Z', toTs: '' })
    expect(ok).toBe(true)
    expect(builder.insert.mock.calls[0][0].to_ts).toBe(null)
  })

  it('rejects an unknown leave type', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.addLeave({ lwsId: 'S1', fromTs: 'a', toTs: 'b', type: 'holiday' })).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejects an inverted window (to before from)', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.addLeave({
      lwsId: 'S1', fromTs: '2026-07-10T00:00:00Z', toTs: '2026-07-08T00:00:00Z',
    })).toBe(false)
  })

  it('rejects missing required fields (lwsId, fromTs)', async () => {
    mockSupabase()
    const { slice } = makeStore()
    // toTs is now optional (empty/absent = open-ended), so only lwsId + fromTs
    // are required.
    expect(await slice.addLeave({ lwsId: '', fromTs: 'a', toTs: 'b' })).toBe(false)
    expect(await slice.addLeave({ lwsId: 'S1', fromTs: '', toTs: 'b' })).toBe(false)
  })

  it('returns false with no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.addLeave({ lwsId: 'S1', fromTs: '2026-07-08T00:00:00Z', toTs: '2026-07-09T00:00:00Z' })).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on insert error', async () => {
    mockSupabase({ insertError: { message: 'boom' } })
    const { slice } = makeStore()
    expect(await slice.addLeave({ lwsId: 'S1', fromTs: '2026-07-08T00:00:00Z', toTs: '2026-07-09T00:00:00Z' })).toBe(false)
  })
})

// ── getActiveLeaves ───────────────────────────────────────────

describe('getActiveLeaves', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries leaves overlapping the day, including open-ended (to_ts null)', async () => {
    const rows = [{ id: '1', lws_id: 'S1', from_ts: 'x', to_ts: null, type: 'leave' }]
    const { builder } = mockSupabase({ data: rows })
    const { slice } = makeStore()
    const result = await slice.getActiveLeaves('2026-07-08T00:00:00Z', '2026-07-08T23:59:59Z')
    expect(result).toEqual(rows)
    // overlap: from_ts <= dayEnd AND (to_ts IS NULL OR to_ts >= dayStart) — the
    // null branch is critical, else open-ended leaves drop out of the chain.
    expect(builder.lte).toHaveBeenCalledWith('from_ts', '2026-07-08T23:59:59Z')
    expect(builder.or).toHaveBeenCalledWith('to_ts.is.null,to_ts.gte.2026-07-08T00:00:00Z')
  })

  it('returns [] with no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.getActiveLeaves('a', 'b')).toEqual([])
  })
})

// ── deleteLeave ───────────────────────────────────────────────

describe('deleteLeave', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes by id', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.deleteLeave('leave-123')
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'leave-123')
  })

  it('returns false with no session or missing id', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.deleteLeave('leave-123')).toBe(false)
    mockSupabase()
    expect(await slice.deleteLeave('')).toBe(false)
  })
})

// ── endLeave ──────────────────────────────────────────────────
// Close/shorten an open-ended leave by stamping its to_ts (the boarder returned).
// Distinct from deleteLeave (which erases the record); endLeave preserves that
// the student WAS on leave up to the return moment.

describe('endLeave', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps to_ts on the leave id (marks the boarder returned)', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.endLeave('leave-123', '2026-07-11T23:59:59+05:30')
    expect(ok).toBe(true)
    expect(builder.update).toHaveBeenCalledWith({ to_ts: '2026-07-11T23:59:59+05:30' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'leave-123')
  })

  it('returns false on missing id or missing to_ts', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.endLeave('', '2026-07-11T00:00:00Z')).toBe(false)
    expect(await slice.endLeave('leave-123', '')).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false with no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.endLeave('leave-123', '2026-07-11T00:00:00Z')).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on update error', async () => {
    mockSupabase({ error: { message: 'boom' } })
    const { slice } = makeStore()
    expect(await slice.endLeave('leave-123', '2026-07-11T00:00:00Z')).toBe(false)
  })
})
