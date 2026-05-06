import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../lib/supabase'
import { loadFromSupabase, saveToSupabase } from '../persist'

describe('loadFromSupabase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the data column from faculty_state row', async () => {
    const mockData = { exams: [], studentProfiles: {} }
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { data: mockData }, error: null }),
        }),
      }),
    })
    expect(await loadFromSupabase()).toEqual(mockData)
  })

  it('returns null on query error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })
    expect(await loadFromSupabase()).toBeNull()
  })

  it('returns null when data column is null (fresh install)', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { data: null }, error: null }),
        }),
      }),
    })
    expect(await loadFromSupabase()).toBeNull()
  })
})

describe('saveToSupabase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls update when faculty session is active', async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    supabase.from.mockReturnValue({ update: mockUpdate })
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'faculty-id' } } },
    })

    saveToSupabase({ exams: [] })
    await new Promise(r => setTimeout(r, 0))

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { exams: [] } })
    )
    expect(mockEq).toHaveBeenCalledWith('id', 1)
  })

  it('skips update when no session (teacher/student mode)', async () => {
    const mockUpdate = vi.fn()
    supabase.from.mockReturnValue({ update: mockUpdate })
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })

    saveToSupabase({ exams: [] })
    await new Promise(r => setTimeout(r, 0))

    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
