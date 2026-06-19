import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createMentorSlice } from '../mentorSlice'

function makeBuilder({ data = [], error = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.upsert = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.then   = (onF, onR) => Promise.resolve({ data, error }).then(onF, onR)
  return builder
}

function mockSession(active = true) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: active ? { user: { id: 'admin' } } : null },
  })
}

const slice = createMentorSlice(() => {}, () => ({}))

beforeEach(() => vi.clearAllMocks())

describe('fetchMentorAssignments', () => {
  it('returns camelCased rows when a session is active', async () => {
    mockSession(true)
    supabase.from.mockReturnValue(makeBuilder({ data: [
      { lws_id: 'LWS-1', teacher_id: 't1' },
      { lws_id: 'LWS-2', teacher_id: 't2' },
    ] }))
    const rows = await slice.fetchMentorAssignments()
    expect(supabase.from).toHaveBeenCalledWith('mentor_assignments')
    expect(rows).toEqual([
      { lwsId: 'LWS-1', teacherId: 't1' },
      { lwsId: 'LWS-2', teacherId: 't2' },
    ])
  })

  it('returns [] with no session', async () => {
    mockSession(false)
    const rows = await slice.fetchMentorAssignments()
    expect(rows).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns [] on error', async () => {
    mockSession(true)
    supabase.from.mockReturnValue(makeBuilder({ data: null, error: { message: 'boom' } }))
    expect(await slice.fetchMentorAssignments()).toEqual([])
  })
})

describe('setMentorAssignment', () => {
  it('upserts on lws_id and returns true', async () => {
    mockSession(true)
    const b = makeBuilder()
    supabase.from.mockReturnValue(b)
    const ok = await slice.setMentorAssignment('LWS-9', 't3')
    expect(ok).toBe(true)
    expect(supabase.from).toHaveBeenCalledWith('mentor_assignments')
    expect(b.upsert).toHaveBeenCalledWith(
      { lws_id: 'LWS-9', teacher_id: 't3' },
      { onConflict: 'lws_id' },
    )
  })

  it('returns false on missing args', async () => {
    mockSession(true)
    expect(await slice.setMentorAssignment('', 't3')).toBe(false)
    expect(await slice.setMentorAssignment('LWS-9', '')).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false with no session', async () => {
    mockSession(false)
    expect(await slice.setMentorAssignment('LWS-9', 't3')).toBe(false)
  })

  it('returns false on error', async () => {
    mockSession(true)
    supabase.from.mockReturnValue(makeBuilder({ error: { message: 'nope' } }))
    expect(await slice.setMentorAssignment('LWS-9', 't3')).toBe(false)
  })
})

describe('removeMentorAssignment', () => {
  it('deletes by lws_id and returns true', async () => {
    mockSession(true)
    const b = makeBuilder()
    supabase.from.mockReturnValue(b)
    const ok = await slice.removeMentorAssignment('LWS-9')
    expect(ok).toBe(true)
    expect(b.delete).toHaveBeenCalled()
    expect(b.eq).toHaveBeenCalledWith('lws_id', 'LWS-9')
  })

  it('returns false with no session', async () => {
    mockSession(false)
    expect(await slice.removeMentorAssignment('LWS-9')).toBe(false)
  })
})
