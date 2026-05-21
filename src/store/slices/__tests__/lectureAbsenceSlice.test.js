import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createLectureAbsenceSlice } from '../lectureAbsenceSlice'

// Chainable query-builder mock — same pattern as attendanceSlice tests.
function makeQueryBuilder({ data = [], error = null, insertError = null, deleteError = null } = {}) {
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
  let slice
  const get  = () => state
  const set  = fn  => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createLectureAbsenceSlice(set, get)
  return { slice }
}

// ── setLectureAbsenteesForPeriod ─────────────────────────────

describe('setLectureAbsenteesForPeriod', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes existing rows for (date, subject) and inserts the new set', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.setLectureAbsenteesForPeriod(
      '2026-05-21',
      'Maths',
      ['LWS-001', 'LWS-002', 'LWS-003']
    )
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    // Insert receives rows
    expect(builder.insert).toHaveBeenCalledOnce()
    const rows = builder.insert.mock.calls[0][0]
    expect(rows).toEqual([
      { lws_id: 'LWS-001', date: '2026-05-21', subject: 'Maths', created_by: 'admin@lws' },
      { lws_id: 'LWS-002', date: '2026-05-21', subject: 'Maths', created_by: 'admin@lws' },
      { lws_id: 'LWS-003', date: '2026-05-21', subject: 'Maths', created_by: 'admin@lws' },
    ])
  })

  it('only deletes when the new list is empty (clear-the-period flow)', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.setLectureAbsenteesForPeriod('2026-05-21', 'Maths', [])
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('dedupes lwsIds in the input', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    await slice.setLectureAbsenteesForPeriod(
      '2026-05-21',
      'Maths',
      ['LWS-001', 'LWS-001', 'LWS-002']
    )
    const rows = builder.insert.mock.calls[0][0]
    expect(rows).toHaveLength(2)
  })

  it('returns false when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const ok = await slice.setLectureAbsenteesForPeriod('2026-05-21', 'Maths', ['LWS-001'])
    expect(ok).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on missing args', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.setLectureAbsenteesForPeriod('', 'Maths', ['LWS-001'])).toBe(false)
    expect(await slice.setLectureAbsenteesForPeriod('2026-05-21', '', ['LWS-001'])).toBe(false)
    expect(await slice.setLectureAbsenteesForPeriod('2026-05-21', 'Maths', null)).toBe(false)
  })

  it('tags rows with the authenticated user email as created_by', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    await slice.setLectureAbsenteesForPeriod('2026-05-21', 'Maths', ['LWS-001'])
    const rows = builder.insert.mock.calls[0][0]
    expect(rows[0].created_by).toBe('admin@lws')
  })

  it('returns false when the insert errors', async () => {
    mockSupabase({ insertError: { message: 'boom' } })
    const { slice } = makeStore()
    const ok = await slice.setLectureAbsenteesForPeriod('2026-05-21', 'Maths', ['LWS-001'])
    expect(ok).toBe(false)
  })
})

// ── getLectureAbsencesForDate ────────────────────────────────

describe('getLectureAbsencesForDate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows for the given date', async () => {
    const rows = [
      { lws_id: 'LWS-001', date: '2026-05-21', subject: 'Maths' },
      { lws_id: 'LWS-002', date: '2026-05-21', subject: 'Physics' },
    ]
    const { builder } = mockSupabase({ data: rows })
    const { slice } = makeStore()
    const result = await slice.getLectureAbsencesForDate('2026-05-21')
    expect(result).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('date', '2026-05-21')
  })

  it('returns [] when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const result = await slice.getLectureAbsencesForDate('2026-05-21')
    expect(result).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns [] when date is empty', async () => {
    mockSupabase()
    const { slice } = makeStore()
    const result = await slice.getLectureAbsencesForDate('')
    expect(result).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns [] on supabase error', async () => {
    mockSupabase({ error: { message: 'boom' } })
    const { slice } = makeStore()
    const result = await slice.getLectureAbsencesForDate('2026-05-21')
    expect(result).toEqual([])
  })
})

// ── getLectureAbsencesForStudent ─────────────────────────────

describe('getLectureAbsencesForStudent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows filtered to lwsId and date >= sinceDate', async () => {
    const rows = [
      { lws_id: 'LWS-001', date: '2026-05-21', subject: 'Maths' },
      { lws_id: 'LWS-001', date: '2026-05-15', subject: 'Physics' },
    ]
    const { builder } = mockSupabase({ data: rows })
    const { slice } = makeStore()
    const result = await slice.getLectureAbsencesForStudent('LWS-001', '2026-04-21')
    expect(result).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('lws_id', 'LWS-001')
    expect(builder.gte).toHaveBeenCalledWith('date', '2026-04-21')
  })

  it('returns [] when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const result = await slice.getLectureAbsencesForStudent('LWS-001', '2026-04-21')
    expect(result).toEqual([])
  })

  it('returns [] when lwsId is missing', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.getLectureAbsencesForStudent('', '2026-04-21')).toEqual([])
  })

  it('omits the date filter when sinceDate is falsy', async () => {
    const { builder } = mockSupabase({ data: [] })
    const { slice } = makeStore()
    await slice.getLectureAbsencesForStudent('LWS-001', null)
    expect(builder.gte).not.toHaveBeenCalled()
  })
})
