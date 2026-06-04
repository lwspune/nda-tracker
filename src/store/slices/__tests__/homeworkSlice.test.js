import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createHomeworkSlice } from '../homeworkSlice'

// Chainable query-builder mock. select/eq/gte/is/in (for select) stay chainable
// and resolve via `then` to { data: selectData, error }. delete()/update() return
// a fresh terminal object whose .in/.eq resolves to { error }. insert resolves.
function makeQueryBuilder({
  selectData = [], selectError = null,
  deleteError = null, insertError = null, updateError = null,
} = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.gte    = vi.fn(() => builder)
  builder.is     = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.in     = vi.fn(() => builder) // chainable form (select … .in(lwsIds))
  builder.delete = vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ error: deleteError })) }))
  builder.update = vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ error: updateError })),
    in: vi.fn(() => Promise.resolve({ error: updateError })),
  }))
  builder.insert = vi.fn(() => Promise.resolve({ error: insertError }))
  builder.then   = (onFulfilled, onRejected) =>
    Promise.resolve({ data: selectData, error: selectError }).then(onFulfilled, onRejected)
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
  return { slice: createHomeworkSlice(set, get) }
}

// ── setHomeworkDefaultersForItem ─────────────────────────────

describe('setHomeworkDefaultersForItem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts all when nothing exists yet', async () => {
    const { builder } = mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    const ok = await slice.setHomeworkDefaultersForItem(
      '2026-06-04', 'Maths', 'Trigonometry', 'both', ['LWS-001', 'LWS-002']
    )
    expect(ok).toBe(true)
    expect(builder.insert).toHaveBeenCalledOnce()
    expect(builder.insert.mock.calls[0][0]).toEqual([
      { lws_id: 'LWS-001', date: '2026-06-04', subject: 'Maths', chapter: 'Trigonometry', type: 'both', created_by: 'admin@lws' },
      { lws_id: 'LWS-002', date: '2026-06-04', subject: 'Maths', chapter: 'Trigonometry', type: 'both', created_by: 'admin@lws' },
    ])
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('preserves existing rows (and their resolved_at) — only inserts the new ones', async () => {
    // LWS-001 already flagged; re-saving with [001, 002] must NOT re-insert 001.
    const { builder } = mockSupabase({ selectData: [{ id: 'r1', lws_id: 'LWS-001' }] })
    const { slice } = makeStore()
    await slice.setHomeworkDefaultersForItem(
      '2026-06-04', 'Maths', 'Trigonometry', 'homework', ['LWS-001', 'LWS-002']
    )
    const inserted = builder.insert.mock.calls[0][0]
    expect(inserted).toHaveLength(1)
    expect(inserted[0].lws_id).toBe('LWS-002')
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('deletes rows for students removed from the set', async () => {
    // LWS-009 was flagged but is no longer in the saved set → delete it.
    const { builder } = mockSupabase({
      selectData: [{ id: 'r9', lws_id: 'LWS-009' }, { id: 'r1', lws_id: 'LWS-001' }],
    })
    const { slice } = makeStore()
    await slice.setHomeworkDefaultersForItem(
      '2026-06-04', 'Maths', 'Trigonometry', 'notes', ['LWS-001']
    )
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.insert).not.toHaveBeenCalled() // LWS-001 already exists
  })

  it('clears the whole item when given an empty set (delete all, no insert)', async () => {
    const { builder } = mockSupabase({ selectData: [{ id: 'r1', lws_id: 'LWS-001' }] })
    const { slice } = makeStore()
    const ok = await slice.setHomeworkDefaultersForItem(
      '2026-06-04', 'Maths', 'Trigonometry', 'both', []
    )
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('dedupes lwsIds before inserting', async () => {
    const { builder } = mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    await slice.setHomeworkDefaultersForItem(
      '2026-06-04', 'Maths', 'Trigonometry', 'both', ['LWS-001', 'LWS-001', 'LWS-002']
    )
    expect(builder.insert.mock.calls[0][0]).toHaveLength(2)
  })

  it('rejects an invalid type', async () => {
    mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    expect(await slice.setHomeworkDefaultersForItem('2026-06-04', 'Maths', 'Trig', 'essay', ['LWS-001'])).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on missing args', async () => {
    mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    expect(await slice.setHomeworkDefaultersForItem('', 'Maths', 'Trig', 'both', ['LWS-001'])).toBe(false)
    expect(await slice.setHomeworkDefaultersForItem('2026-06-04', '', 'Trig', 'both', ['LWS-001'])).toBe(false)
    expect(await slice.setHomeworkDefaultersForItem('2026-06-04', 'Maths', '', 'both', ['LWS-001'])).toBe(false)
    expect(await slice.setHomeworkDefaultersForItem('2026-06-04', 'Maths', 'Trig', 'both', null)).toBe(false)
  })

  it('returns false when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.setHomeworkDefaultersForItem('2026-06-04', 'Maths', 'Trig', 'both', ['LWS-001'])).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('tags inserts with the authenticated email', async () => {
    const { builder } = mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    await slice.setHomeworkDefaultersForItem('2026-06-04', 'Maths', 'Trig', 'both', ['LWS-001'])
    expect(builder.insert.mock.calls[0][0][0].created_by).toBe('admin@lws')
  })

  it('returns false when the insert errors', async () => {
    mockSupabase({ selectData: [], insertError: { message: 'boom' } })
    const { slice } = makeStore()
    expect(await slice.setHomeworkDefaultersForItem('2026-06-04', 'Maths', 'Trig', 'both', ['LWS-001'])).toBe(false)
  })
})

// ── resolve / reopen ─────────────────────────────────────────

describe('resolveHomeworkItem / reopenHomeworkItem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolve stamps resolved_at + resolved_by for the id', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.resolveHomeworkItem('r1')
    expect(ok).toBe(true)
    const patch = builder.update.mock.calls[0][0]
    expect(patch.resolved_at).toBeTruthy()
    expect(patch.resolved_by).toBe('admin@lws')
  })

  it('reopen clears resolved_at', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.reopenHomeworkItem('r1')
    expect(ok).toBe(true)
    expect(builder.update.mock.calls[0][0]).toEqual({ resolved_at: null, resolved_by: null })
  })

  it('both return false without an id or session', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.resolveHomeworkItem('')).toBe(false)
    mockSupabase({ sessionActive: false })
    expect(await slice.reopenHomeworkItem('r1')).toBe(false)
  })
})

// ── getters ──────────────────────────────────────────────────

describe('getHomeworkForDate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows for the date', async () => {
    const rows = [{ id: 'r1', lws_id: 'LWS-001', date: '2026-06-04', subject: 'Maths', chapter: 'Trig', type: 'both' }]
    const { builder } = mockSupabase({ selectData: rows })
    const { slice } = makeStore()
    expect(await slice.getHomeworkForDate('2026-06-04')).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('date', '2026-06-04')
  })

  it('returns [] without session / date / on error', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.getHomeworkForDate('2026-06-04')).toEqual([])
    mockSupabase()
    expect(await slice.getHomeworkForDate('')).toEqual([])
    mockSupabase({ selectError: { message: 'boom' } })
    expect(await slice.getHomeworkForDate('2026-06-04')).toEqual([])
  })
})

describe('getOpenHomeworkForBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters to unresolved and the given lwsIds', async () => {
    const rows = [{ id: 'r1', lws_id: 'LWS-001', resolved_at: null }]
    const { builder } = mockSupabase({ selectData: rows })
    const { slice } = makeStore()
    expect(await slice.getOpenHomeworkForBatch(['LWS-001', 'LWS-002'])).toEqual(rows)
    expect(builder.is).toHaveBeenCalledWith('resolved_at', null)
    expect(builder.in).toHaveBeenCalledWith('lws_id', ['LWS-001', 'LWS-002'])
  })

  it('omits the lws filter when no ids supplied', async () => {
    const { builder } = mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    await slice.getOpenHomeworkForBatch([])
    expect(builder.in).not.toHaveBeenCalled()
  })
})

describe('getHomeworkForStudent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters to lwsId and date >= sinceDate', async () => {
    const rows = [{ id: 'r1', lws_id: 'LWS-001', date: '2026-06-04' }]
    const { builder } = mockSupabase({ selectData: rows })
    const { slice } = makeStore()
    expect(await slice.getHomeworkForStudent('LWS-001', '2026-05-05')).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('lws_id', 'LWS-001')
    expect(builder.gte).toHaveBeenCalledWith('date', '2026-05-05')
  })

  it('omits the date filter when sinceDate falsy', async () => {
    const { builder } = mockSupabase({ selectData: [] })
    const { slice } = makeStore()
    await slice.getHomeworkForStudent('LWS-001', null)
    expect(builder.gte).not.toHaveBeenCalled()
  })

  it('returns [] without lwsId', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.getHomeworkForStudent('', '2026-05-05')).toEqual([])
  })
})

// ── markHomeworkNotified ─────────────────────────────────────

describe('markHomeworkNotified', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps notified_at for the given ids', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.markHomeworkNotified(['r1', 'r2'])
    expect(ok).toBe(true)
    expect(builder.update.mock.calls[0][0].notified_at).toBeTruthy()
  })

  it('returns false on empty ids or no session', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.markHomeworkNotified([])).toBe(false)
    mockSupabase({ sessionActive: false })
    expect(await slice.markHomeworkNotified(['r1'])).toBe(false)
  })
})
