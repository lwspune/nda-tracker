import { describe, it, expect, vi, beforeEach } from 'vitest'

// Force the prod (Vercel) branch of initStore: IS_READ_ONLY = true.
vi.mock('../../config', async importOriginal => ({ ...(await importOriginal()), IS_READ_ONLY: true }))

// Supabase present with a controllable session (the prod branch gates on `if (supabase)`).
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }))

vi.mock('../persist', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    loadFromDisk:               vi.fn(),
    saveToStorage:              vi.fn(),
    clearStorage:               vi.fn(),
    loadExamsFromSupabase:      vi.fn().mockResolvedValue(null),
    loadInsightsFromSupabase:   vi.fn().mockResolvedValue(null),
  }
})

import useStore from '../useStore'
import { supabase } from '../../lib/supabase'
import { loadFromDisk } from '../persist'

function session(role) {
  return { data: { session: { user: { user_metadata: role ? { role } : {} } } } }
}

// Regression guard for the two-trap session-flag clobber (2026-06-05): the prod
// data-load set({ ...DEFAULTS, ...saved }) must NOT reset the non-persisted
// isSuperadmin flag back to false after loadFromDisk resolves. See memory
// feedback_session_flag_clobber.
describe('initStore — isSuperadmin survives the DEFAULTS-spread data load (prod)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Stub the fire-and-forget loaders so initStore doesn't reach further into Supabase.
    useStore.setState({
      isSuperadmin: false,
      loadStudentsFromSupabase: vi.fn(),
      loadExamsFromSupabase:    vi.fn(),
      loadInsightsFromSupabase: vi.fn(),
    })
  })

  it('stays true for a superadmin session even though the load spreads ...DEFAULTS', async () => {
    supabase.auth.getSession.mockResolvedValue(session('superadmin'))
    loadFromDisk.mockResolvedValue({ timetables: [] }) // saved truthy → the DEFAULTS-spread set runs
    await useStore.getState().initStore()
    expect(useStore.getState().isSuperadmin).toBe(true)
  })

  it('is false for a normal admin session (no role claim)', async () => {
    supabase.auth.getSession.mockResolvedValue(session(null))
    loadFromDisk.mockResolvedValue({ timetables: [] })
    await useStore.getState().initStore()
    expect(useStore.getState().isSuperadmin).toBe(false)
  })

  it('stays true on the no-saved branch (loadFromDisk null)', async () => {
    supabase.auth.getSession.mockResolvedValue(session('superadmin'))
    loadFromDisk.mockResolvedValue(null)
    await useStore.getState().initStore()
    expect(useStore.getState().isSuperadmin).toBe(true)
  })

  it('is false when there is no session at all', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    await useStore.getState().initStore()
    expect(useStore.getState().isSuperadmin).toBe(false)
  })
})
