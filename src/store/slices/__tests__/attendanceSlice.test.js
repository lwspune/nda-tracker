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

function mockSupabase({ sessionActive = true, upsertError = null } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionActive ? { user: { id: 'admin' } } : null },
  })
  const mockUpsert = vi.fn().mockResolvedValue({ error: upsertError })
  supabase.from.mockReturnValue({ upsert: mockUpsert })
  return { mockUpsert }
}

const PARSED = {
  students: [
    { name: 'Arjun Sharma', mobile: '9876543210', dates: { '2026-05-07': 'P', '2026-05-06': 'A' } },
    { name: 'Ravi Kumar',   mobile: '9123456780', dates: { '2026-05-07': 'A' } },
  ],
}

// ── tests ────────────────────────────────────────────────────

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
    // upsert should not be called when there are no records
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
})
