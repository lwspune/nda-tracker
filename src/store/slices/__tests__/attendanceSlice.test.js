import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createAttendanceSlice } from '../attendanceSlice'

// ── helpers ──────────────────────────────────────────────────

function makeStore(profileOverrides = {}) {
  const defaultProfiles = {
    'Arjun Sharma': { lwsId: 'LWS-001', mobile: '9876543210', nameVariants: [] },
    'Ravi Kumar':   { lwsId: 'LWS-002', mobile: '9123456780', nameVariants: [] },
  }
  let state = { studentProfiles: { ...defaultProfiles, ...profileOverrides } }
  let slice
  const get  = () => ({ ...state, ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')) })
  const set  = fn  => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createAttendanceSlice(set, get)
  return { slice, getState: () => state }
}

// Chainable query-builder mock. `select`/`eq`/`in`/`delete` all return the builder.
// Awaiting the builder resolves to `{ data, error }`.
// `upsert(...)` returns its own promise (terminal).
function makeQueryBuilder({ data = [], error = null, upsertError = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.in     = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.limit  = vi.fn(() => builder)
  builder.gte    = vi.fn(() => builder)
  builder.range  = vi.fn(() => builder)
  builder.upsert = vi.fn(() => Promise.resolve({ error: upsertError }))
  builder.then   = (onFulfilled, onRejected) =>
    Promise.resolve({ data, error }).then(onFulfilled, onRejected)
  return builder
}

function mockSupabase({ sessionActive = true, upsertError = null, lateRows = [] } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionActive ? { user: { id: 'admin' } } : null },
  })
  const builder = makeQueryBuilder({ data: lateRows, upsertError })
  supabase.from.mockReturnValue(builder)
  return { builder, mockUpsert: builder.upsert }
}

const PARSED = {
  students: [
    { name: 'Arjun Sharma', mobile: '9876543210', dates: { '2026-05-07': 'P', '2026-05-06': 'A' } },
    { name: 'Ravi Kumar',   mobile: '9123456780', dates: { '2026-05-07': 'A' } },
  ],
}

// ── importAttendance tests ───────────────────────────────────

describe('importAttendance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('matches by mobile and upserts attendance records', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore()
    const result = await slice.importAttendance(PARSED)

    expect(result.matched).toBe(2)
    expect(result.unmatched).toBe(0)
    expect(mockUpsert).toHaveBeenCalledOnce()
    const records = mockUpsert.mock.calls[0][0]
    expect(records).toHaveLength(3) // 2 + 1 dates
    expect(records).toContainEqual({ lws_id: 'LWS-001', date: '2026-05-07', status: 'P' })
    expect(records).toContainEqual({ lws_id: 'LWS-001', date: '2026-05-06', status: 'A' })
    expect(records).toContainEqual({ lws_id: 'LWS-002', date: '2026-05-07', status: 'A' })
  })

  it('upserts with onConflict lws_id,date for idempotent re-import', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore()
    await slice.importAttendance(PARSED)
    expect(mockUpsert).toHaveBeenCalledWith(expect.any(Array), { onConflict: 'lws_id,date' })
  })

  it('falls back to name match when mobile is absent', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore()
    const parsed = { students: [{ name: 'Arjun Sharma', mobile: '', dates: { '2026-05-07': 'P' } }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(1)
    const records = mockUpsert.mock.calls[0][0]
    expect(records[0].lws_id).toBe('LWS-001')
  })

  it('falls back to name match when mobile does not match any profile', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore()
    const parsed = { students: [{ name: 'Arjun Sharma', mobile: '9999999999', dates: { '2026-05-07': 'P' } }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(1)
    expect(mockUpsert.mock.calls[0][0][0].lws_id).toBe('LWS-001')
  })

  it('drops students matching neither mobile nor name', async () => {
    mockSupabase()
    const { slice } = makeStore()
    const parsed = { students: [{ name: 'Unknown Person', mobile: '0000000000', dates: { '2026-05-07': 'P' } }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(0)
    expect(result.unmatched).toBe(1)
  })

  it('normalises 10-digit mobile (strips leading 0)', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore({
      'Test Student': { lwsId: 'LWS-003', mobile: '7890123456', nameVariants: [] },
    })
    // File has 0-prefixed 11-digit
    const parsed = { students: [{ name: 'Test Student', mobile: '07890123456', dates: { '2026-05-07': 'P' } }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(1)
    expect(mockUpsert.mock.calls[0][0][0].lws_id).toBe('LWS-003')
  })

  it('normalises 91-prefixed 12-digit mobile', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore({
      'Test Student': { lwsId: 'LWS-003', mobile: '7890123456', nameVariants: [] },
    })
    const parsed = { students: [{ name: 'Test Student', mobile: '917890123456', dates: { '2026-05-07': 'P' } }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(1)
    expect(mockUpsert.mock.calls[0][0][0].lws_id).toBe('LWS-003')
  })

  it('matched student with empty dates contributes 0 records but counts as matched', async () => {
    mockSupabase()
    const { slice } = makeStore()
    const parsed = { students: [{ name: 'Arjun Sharma', mobile: '9876543210', dates: {} }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(1)
    expect(result.upserted).toBe(0)
    // supabase.from should not be called when there are no records
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('skips upsert when no session (teacher/student mode)', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const result = await slice.importAttendance(PARSED)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(result.upserted).toBe(0)
  })

  it('matches via name variant', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore({
      'Arjun Sharma': { lwsId: 'LWS-001', mobile: '0000000000', nameVariants: ['Arjun S'] },
      'Arjun S':      { lwsId: 'LWS-001', mobile: '0000000000', nameVariants: ['Arjun S'] },
    })
    const parsed = { students: [{ name: 'Arjun S', mobile: '9999999999', dates: { '2026-05-07': 'P' } }] }
    const result = await slice.importAttendance(parsed)
    expect(result.matched).toBe(1)
    expect(mockUpsert.mock.calls[0][0][0].lws_id).toBe('LWS-001')
  })

  // ── New: L-status protection ───────────────────────────────

  it('does NOT overwrite existing L (late) markings on import', async () => {
    // Arjun marked L on 2026-05-07 already. XLS says P. Must NOT overwrite.
    const { mockUpsert } = mockSupabase({
      lateRows: [{ lws_id: 'LWS-001', date: '2026-05-07' }],
    })
    const { slice } = makeStore()
    const result = await slice.importAttendance(PARSED)

    expect(mockUpsert).toHaveBeenCalledOnce()
    const records = mockUpsert.mock.calls[0][0]
    // 3 total expected, 1 protected → 2 upserted
    expect(records).toHaveLength(2)
    expect(records).not.toContainEqual(expect.objectContaining({ lws_id: 'LWS-001', date: '2026-05-07' }))
    expect(records).toContainEqual({ lws_id: 'LWS-001', date: '2026-05-06', status: 'A' })
    expect(records).toContainEqual({ lws_id: 'LWS-002', date: '2026-05-07', status: 'A' })
    expect(result.lateProtected).toBe(1)
  })

  it('does not call upsert when every row is protected by L', async () => {
    // Both rows in parsed match an existing L row.
    const { mockUpsert } = mockSupabase({
      lateRows: [
        { lws_id: 'LWS-001', date: '2026-05-07' },
        { lws_id: 'LWS-001', date: '2026-05-06' },
        { lws_id: 'LWS-002', date: '2026-05-07' },
      ],
    })
    const { slice } = makeStore()
    const result = await slice.importAttendance(PARSED)

    expect(mockUpsert).not.toHaveBeenCalled()
    expect(result.upserted).toBe(0)
    expect(result.lateProtected).toBe(3)
  })
})

// ── markLate / unmarkLate / getLateStudentsForDate tests ─────

describe('markLate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts an L row for (lwsId, date)', async () => {
    const { mockUpsert } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.markLate('LWS-001', '2026-05-21')
    expect(ok).toBe(true)
    expect(mockUpsert).toHaveBeenCalledWith(
      { lws_id: 'LWS-001', date: '2026-05-21', status: 'L' },
      { onConflict: 'lws_id,date' },
    )
  })

  it('returns false when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const ok = await slice.markLate('LWS-001', '2026-05-21')
    expect(ok).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false when lwsId or date is missing', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.markLate('', '2026-05-21')).toBe(false)
    expect(await slice.markLate('LWS-001', '')).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on supabase error', async () => {
    mockSupabase({ upsertError: { message: 'boom' } })
    const { slice } = makeStore()
    const ok = await slice.markLate('LWS-001', '2026-05-21')
    expect(ok).toBe(false)
  })
})

describe('unmarkLate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the L row scoped to (lwsId, date) and status=L', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()
    const ok = await slice.unmarkLate('LWS-001', '2026-05-21')
    expect(ok).toBe(true)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('lws_id', 'LWS-001')
    expect(builder.eq).toHaveBeenCalledWith('date', '2026-05-21')
    expect(builder.eq).toHaveBeenCalledWith('status', 'L')
  })

  it('returns false when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const ok = await slice.unmarkLate('LWS-001', '2026-05-21')
    expect(ok).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('getLateStudentsForDate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns array of lws_ids with status=L for the given date', async () => {
    const { builder } = mockSupabase({
      lateRows: [{ lws_id: 'LWS-001' }, { lws_id: 'LWS-007' }],
    })
    const { slice } = makeStore()
    const result = await slice.getLateStudentsForDate('2026-05-21')
    expect(result).toEqual(['LWS-001', 'LWS-007'])
    expect(builder.select).toHaveBeenCalledWith('lws_id')
    expect(builder.eq).toHaveBeenCalledWith('date', '2026-05-21')
    expect(builder.eq).toHaveBeenCalledWith('status', 'L')
  })

  it('returns [] when no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    const result = await slice.getLateStudentsForDate('2026-05-21')
    expect(result).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

// ── fetchDailyAttendance tests ───────────────────────────────

describe('fetchDailyAttendance', () => {
  beforeEach(() => vi.clearAllMocks())

  function sessionOn() {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } })
  }

  it('resolves to the latest recorded date when called with null, then returns its rows', async () => {
    sessionOn()
    const dateBuilder = makeQueryBuilder({ data: [{ date: '2026-06-05' }] })
    const rowsBuilder = makeQueryBuilder({ data: [
      { lws_id: 'LWS-001', status: 'P' },
      { lws_id: 'LWS-002', status: 'A' },
    ] })
    supabase.from.mockReturnValueOnce(dateBuilder).mockReturnValueOnce(rowsBuilder)

    const { slice } = makeStore()
    const result = await slice.fetchDailyAttendance(null)

    expect(dateBuilder.order).toHaveBeenCalledWith('date', { ascending: false })
    expect(dateBuilder.limit).toHaveBeenCalledWith(1)
    expect(rowsBuilder.eq).toHaveBeenCalledWith('date', '2026-06-05')
    expect(result.date).toBe('2026-06-05')
    expect(result.rows).toHaveLength(2)
  })

  it('uses the supplied date directly (no latest-date lookup)', async () => {
    sessionOn()
    const rowsBuilder = makeQueryBuilder({ data: [{ lws_id: 'LWS-001', status: 'P' }] })
    supabase.from.mockReturnValueOnce(rowsBuilder)

    const { slice } = makeStore()
    const result = await slice.fetchDailyAttendance('2026-05-21')

    expect(supabase.from).toHaveBeenCalledTimes(1)  // no date lookup
    expect(rowsBuilder.eq).toHaveBeenCalledWith('date', '2026-05-21')
    expect(result.date).toBe('2026-05-21')
  })

  it('returns { date: null, rows: [] } when no session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    const { slice } = makeStore()
    const result = await slice.fetchDailyAttendance(null)
    expect(result).toEqual({ date: null, rows: [] })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns { date: null, rows: [] } when there is no recorded attendance', async () => {
    sessionOn()
    supabase.from.mockReturnValueOnce(makeQueryBuilder({ data: [] }))  // empty latest-date lookup
    const { slice } = makeStore()
    const result = await slice.fetchDailyAttendance(null)
    expect(result).toEqual({ date: null, rows: [] })
  })
})

describe('fetchAttendanceLeadersData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty rows when there is no session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    const { slice } = makeStore()
    const result = await slice.fetchAttendanceLeadersData('2026-05-10')
    expect(result).toEqual({ attendanceRows: [], lectureRows: [], homeworkRows: [] })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('reads the three tables windowed by sinceIso and returns their rows', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } })
    const attendance = makeQueryBuilder({ data: [{ lws_id: 'L1', status: 'A' }] })
    const lecture    = makeQueryBuilder({ data: [{ lws_id: 'L2' }] })
    const homework   = makeQueryBuilder({ data: [{ lws_id: 'L3' }] })
    supabase.from.mockImplementation(table =>
      table === 'student_attendance' ? attendance
      : table === 'lecture_absences' ? lecture
      : homework)

    const { slice } = makeStore()
    const result = await slice.fetchAttendanceLeadersData('2026-05-10')

    // attendance scoped to A/L statuses + the window; all three windowed by date
    expect(attendance.in).toHaveBeenCalledWith('status', ['A', 'L'])
    expect(attendance.gte).toHaveBeenCalledWith('date', '2026-05-10')
    expect(lecture.gte).toHaveBeenCalledWith('date', '2026-05-10')
    expect(homework.gte).toHaveBeenCalledWith('date', '2026-05-10')

    expect(result.attendanceRows).toEqual([{ lws_id: 'L1', status: 'A' }])
    expect(result.lectureRows).toEqual([{ lws_id: 'L2' }])
    expect(result.homeworkRows).toEqual([{ lws_id: 'L3' }])
  })
})
