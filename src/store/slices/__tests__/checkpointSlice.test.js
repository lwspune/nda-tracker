import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createCheckpointSlice } from '../checkpointSlice'

// Chainable query-builder mock — same shape as lectureAbsenceSlice tests, plus
// upsert() for the reconciliation-confirmation write.
function makeQueryBuilder({ data = [], error = null, insertError = null, deleteError = null, upsertError = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.gte    = vi.fn(() => builder)
  builder.in     = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.delete = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ error: deleteError })),
    })),
  }))
  builder.insert = vi.fn(() => Promise.resolve({ error: insertError }))
  builder.upsert = vi.fn(() => Promise.resolve({ error: upsertError }))
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
  return { slice: createCheckpointSlice(set, get) }
}

// ── setCheckpointExceptions ───────────────────────────────────

describe('setCheckpointExceptions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes existing rows for (date, checkpoint) and inserts the new exception set', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.setCheckpointExceptions('08-07-2026', 'dinner', [
      { lwsId: 'S1', status: 'absent' },
      { lwsId: 'S2', status: 'sick', note: 'fever' },
    ])
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    const rows = builder.insert.mock.calls[0][0]
    expect(rows).toEqual([
      { lws_id: 'S1', date: '08-07-2026', checkpoint: 'dinner', status: 'absent', note: null, created_by: 'admin@lws' },
      { lws_id: 'S2', date: '08-07-2026', checkpoint: 'dinner', status: 'sick', note: 'fever', created_by: 'admin@lws' },
    ])
  })

  it('defaults a missing status to absent', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    await slice.setCheckpointExceptions('08-07-2026', 'lunch', [{ lwsId: 'S1' }])
    expect(builder.insert.mock.calls[0][0][0].status).toBe('absent')
  })

  it('clears the checkpoint (delete only) when the set is empty', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.setCheckpointExceptions('08-07-2026', 'lunch', [])
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('rejects an unknown checkpoint', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.setCheckpointExceptions('08-07-2026', 'brunch', [{ lwsId: 'S1' }])).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejects an unknown status', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.setCheckpointExceptions('08-07-2026', 'dinner', [{ lwsId: 'S1', status: 'vanished' }])).toBe(false)
  })

  it('dedupes by lwsId (last write wins)', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    await slice.setCheckpointExceptions('08-07-2026', 'dinner', [
      { lwsId: 'S1', status: 'absent' },
      { lwsId: 'S1', status: 'sick' },
    ])
    const rows = builder.insert.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sick')
  })

  it('returns false with no session and never touches the db', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.setCheckpointExceptions('08-07-2026', 'dinner', [{ lwsId: 'S1' }])).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on insert error', async () => {
    mockSupabase({ insertError: { message: 'boom' } })
    const { slice } = makeStore()
    expect(await slice.setCheckpointExceptions('08-07-2026', 'dinner', [{ lwsId: 'S1' }])).toBe(false)
  })
})

// ── getCheckpointExceptionsForDate ────────────────────────────

describe('getCheckpointExceptionsForDate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows for the date', async () => {
    const rows = [{ lws_id: 'S1', checkpoint: 'dinner', status: 'absent' }]
    const { builder } = mockSupabase({ data: rows })
    const { slice } = makeStore()
    expect(await slice.getCheckpointExceptionsForDate('08-07-2026')).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('date', '08-07-2026')
  })

  it('returns [] with no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.getCheckpointExceptionsForDate('08-07-2026')).toEqual([])
  })
})

// ── confirmRoll (reconciliation gate) ─────────────────────────

describe('confirmRoll', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts a reconciled confirmation when the headcount ties out', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.confirmRoll('08-07-2026', 'hostel_pm', {
      expectedCount: 190, exceptionCount: 3, confirmedPresent: 187,
    })
    expect(ok).toBe(true)
    const row = builder.upsert.mock.calls[0][0]
    expect(row).toMatchObject({
      date: '08-07-2026', checkpoint: 'hostel_pm', branch: 'APJ',
      expected_count: 190, exception_count: 3, confirmed_present: 187,
      reconciled: true, confirmed_by: 'admin@lws',
    })
  })

  it('marks reconciled=false when the headcount does NOT tie (open incident)', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    await slice.confirmRoll('08-07-2026', 'hostel_pm', {
      expectedCount: 190, exceptionCount: 3, confirmedPresent: 186, // one short
    })
    expect(builder.upsert.mock.calls[0][0].reconciled).toBe(false)
  })

  it('rejects a non-roll checkpoint (meals are exception-only, not reconciled)', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.confirmRoll('08-07-2026', 'lunch', {
      expectedCount: 190, exceptionCount: 0, confirmedPresent: 190,
    })).toBe(false)
  })

  it('returns false with no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.confirmRoll('08-07-2026', 'hostel_pm', {
      expectedCount: 1, exceptionCount: 0, confirmedPresent: 1,
    })).toBe(false)
  })
})
