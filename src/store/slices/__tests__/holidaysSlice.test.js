import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createHolidaysSlice } from '../holidaysSlice'

const ROW = {
  id: 'h1', name: 'Diwali', from_date: '2026-11-09', to_date: '2026-11-11',
  branch: 'APJ', batch_names: [], created_by: 'admin@lws',
}

function makeQueryBuilder({ data = [], error = null, insertError = null, deleteError = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.eq     = vi.fn(() => Promise.resolve({ error: deleteError }))
  builder.delete = vi.fn(() => builder)
  builder.insert = vi.fn(() => Promise.resolve({ error: insertError }))
  builder.then   = (onFulfilled, onRejected) =>
    Promise.resolve({ data, error }).then(onFulfilled, onRejected)
  return builder
}

function mockSupabase({ sessionActive = true, ...builderOpts } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionActive ? { user: { email: 'admin@lws' } } : null },
  })
  const builder = makeQueryBuilder(builderOpts)
  supabase.from.mockReturnValue(builder)
  return { builder }
}

function makeStore() {
  let state = {}
  const get = () => state
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  state = createHolidaysSlice(set, get)
  return { get }
}

describe('holidaysSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('starts empty and not loaded', () => {
    const { get } = makeStore()
    expect(get().holidays).toEqual([])
    expect(get().holidaysLoaded).toBe(false)
  })

  describe('loadHolidays', () => {
    it('reads the table into the client shape', async () => {
      const { builder } = mockSupabase({ data: [ROW] })
      const { get } = makeStore()
      expect(await get().loadHolidays()).toBe(true)
      expect(supabase.from).toHaveBeenCalledWith('attendance_holidays')
      expect(builder.order).toHaveBeenCalledWith('from_date', { ascending: true })
      expect(get().holidays).toEqual([{
        id: 'h1', name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11',
        branch: 'APJ', batchNames: [], createdBy: 'admin@lws',
      }])
      expect(get().holidaysLoaded).toBe(true)
    })

    it('without a session loads nothing and stays not-loaded', async () => {
      mockSupabase({ sessionActive: false })
      const { get } = makeStore()
      expect(await get().loadHolidays()).toBe(false)
      expect(supabase.from).not.toHaveBeenCalled()
      expect(get().holidaysLoaded).toBe(false)
    })

    it('two callers at once share one read', async () => {
      mockSupabase({ data: [ROW] })
      const { get } = makeStore()
      await Promise.all([get().loadHolidays(), get().loadHolidays()])
      expect(supabase.from).toHaveBeenCalledTimes(1)
    })

    it('a read error keeps what was loaded and reports failure', async () => {
      mockSupabase({ error: { message: 'boom' } })
      const { get } = makeStore()
      expect(await get().loadHolidays()).toBe(false)
      expect(get().holidays).toEqual([])
      expect(get().holidaysLoaded).toBe(false)
    })
  })

  describe('addHolidays', () => {
    const input = {
      name: 'Diwali', fromDate: '2026-11-09', toDate: '2026-11-11',
      scopes: [{ branch: 'APJ', batchNames: [] }, { branch: 'LWS Pune', batchNames: ['B1'] }],
    }

    it('inserts one row per branch, stamped with who added it, then reloads', async () => {
      const { builder } = mockSupabase({ data: [ROW] })
      const { get } = makeStore()
      expect(await get().addHolidays(input)).toEqual({ ok: true })
      expect(builder.insert).toHaveBeenCalledWith([
        { name: 'Diwali', from_date: '2026-11-09', to_date: '2026-11-11', branch: 'APJ', batch_names: [], created_by: 'admin@lws' },
        { name: 'Diwali', from_date: '2026-11-09', to_date: '2026-11-11', branch: 'LWS Pune', batch_names: ['B1'], created_by: 'admin@lws' },
      ])
      expect(get().holidays).toHaveLength(1)
    })

    it('refuses invalid input before touching the database', async () => {
      mockSupabase()
      const { get } = makeStore()
      const out = await get().addHolidays({ ...input, name: '' })
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/name/i)
      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('says so when not signed in', async () => {
      mockSupabase({ sessionActive: false })
      const { get } = makeStore()
      const out = await get().addHolidays(input)
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/sign in/i)
    })

    it('reports a failed insert', async () => {
      mockSupabase({ insertError: { message: 'denied' } })
      const { get } = makeStore()
      const out = await get().addHolidays(input)
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/could not save/i)
    })
  })

  describe('deleteHoliday', () => {
    it('deletes by id and drops it from the list', async () => {
      const { builder } = mockSupabase({ data: [ROW] })
      const { get } = makeStore()
      await get().loadHolidays()
      expect(await get().deleteHoliday('h1')).toBe(true)
      expect(builder.delete).toHaveBeenCalled()
      expect(builder.eq).toHaveBeenCalledWith('id', 'h1')
      expect(get().holidays).toEqual([])
    })

    it('keeps the row when the delete fails', async () => {
      mockSupabase({ data: [ROW], deleteError: { message: 'denied' } })
      const { get } = makeStore()
      await get().loadHolidays()
      expect(await get().deleteHoliday('h1')).toBe(false)
      expect(get().holidays).toHaveLength(1)
    })
  })
})
