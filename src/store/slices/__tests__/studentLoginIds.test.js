import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createStudentSlice } from '../studentSlice'

function makeStore() {
  let state = { studentProfiles: {}, studentList: [] }
  let slice
  const get = () => ({
    ...state,
    _save: () => {},
    ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')),
  })
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createStudentSlice(set, get)
  return { slice }
}

// Chainable builder; `range(from, to)` is terminal and resolves { data, error }.
// `pages` is a list of row-arrays returned in call order.
function makeRangeBuilder({ pages = [[]], error = null } = {}) {
  let call = 0
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.range = vi.fn(() => Promise.resolve({ data: error ? null : (pages[call++] ?? []), error }))
  return builder
}

beforeEach(() => vi.clearAllMocks())

describe('fetchStudentLoginIds', () => {
  it('returns null when there is no session, so callers can tell "unknown" from "nobody"', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    const { slice } = makeStore()
    expect(await slice.fetchStudentLoginIds()).toBe(null)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns the distinct set of lws_ids that have ever logged in', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } })
    const builder = makeRangeBuilder({
      pages: [[{ lws_id: 'L1' }, { lws_id: 'L2' }, { lws_id: 'L1' }]],
    })
    supabase.from.mockReturnValue(builder)

    const { slice } = makeStore()
    const ids = await slice.fetchStudentLoginIds()

    expect(supabase.from).toHaveBeenCalledWith('student_logins')
    expect(builder.select).toHaveBeenCalledWith('lws_id')
    expect(ids).toBeInstanceOf(Set)
    expect([...ids].sort()).toEqual(['L1', 'L2'])
  })

  it('pages through more than one batch of rows', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } })
    const full = Array.from({ length: 1000 }, (_, i) => ({ lws_id: `L${i}` }))
    const builder = makeRangeBuilder({ pages: [full, [{ lws_id: 'LAST' }]] })
    supabase.from.mockReturnValue(builder)

    const { slice } = makeStore()
    const ids = await slice.fetchStudentLoginIds()

    expect(builder.range).toHaveBeenCalledTimes(2)
    expect(builder.range).toHaveBeenNthCalledWith(1, 0, 999)
    expect(builder.range).toHaveBeenNthCalledWith(2, 1000, 1999)
    expect(ids.has('LAST')).toBe(true)
    expect(ids.size).toBe(1001)
  })

  it('returns null on a read error rather than an empty set', async () => {
    // An empty set would mark EVERY student as never-logged-in — a false chase list.
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } })
    supabase.from.mockReturnValue(makeRangeBuilder({ error: { message: 'boom' } }))
    const { slice } = makeStore()
    expect(await slice.fetchStudentLoginIds()).toBe(null)
  })

  it('ignores rows with a blank lws_id', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } })
    supabase.from.mockReturnValue(makeRangeBuilder({
      pages: [[{ lws_id: 'L1' }, { lws_id: null }, { lws_id: '' }]],
    }))
    const { slice } = makeStore()
    expect([...(await slice.fetchStudentLoginIds())]).toEqual(['L1'])
  })
})
