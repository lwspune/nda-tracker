import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked Supabase client — replaced per-test by reaching into the mock module.
vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../supabase'
import { loadExistingStudents } from '../loadExistingStudents'

function mockSupabaseSelect(rows) {
  supabase.from.mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
  })
}

function mockSupabaseSelectError() {
  supabase.from.mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
  })
}

describe('loadExistingStudents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads from Supabase when a faculty session is active', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'faculty' } } },
    })
    mockSupabaseSelect([
      {
        lws_id: 'LWS-001',
        canonical_name: 'Alice',
        mobile: '999',
        eis_reg_no: 'E1',
        student_batches: [{ batch_name: 'B1' }, { batch_name: 'B2' }],
      },
    ])

    const result = await loadExistingStudents()

    expect(result).toEqual([
      expect.objectContaining({
        lws_id: 'LWS-001',
        canonical_name: 'Alice',
        mobile: '999',
        eis_reg_no: 'E1',
        batches: ['B1', 'B2'],
      }),
    ])
    expect(result[0].student_batches).toBeUndefined()
  })

  it('does NOT fall through to fetch when Supabase returns an empty array', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'faculty' } } },
    })
    mockSupabaseSelect([])
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await loadExistingStudents()

    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to /api/students-db when there is no Supabase session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ students: [{ lws_id: 'LWS-001', canonical_name: 'Alice' }] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await loadExistingStudents()

    expect(fetchSpy).toHaveBeenCalledWith('/api/students-db')
    expect(result).toEqual([{ lws_id: 'LWS-001', canonical_name: 'Alice' }])
  })

  it('falls back to /api/students-db when Supabase query errors', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'faculty' } } },
    })
    mockSupabaseSelectError()
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ students: [{ lws_id: 'LWS-001' }] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await loadExistingStudents()

    expect(fetchSpy).toHaveBeenCalled()
    expect(result).toEqual([{ lws_id: 'LWS-001' }])
  })

  it('returns [] when both Supabase and fetch fail', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('404')))

    const result = await loadExistingStudents()

    expect(result).toEqual([])
  })

  it('returns [] when fetch returns no students field (legacy / empty file)', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
    }))

    const result = await loadExistingStudents()

    expect(result).toEqual([])
  })
})
