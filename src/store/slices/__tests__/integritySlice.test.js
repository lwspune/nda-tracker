import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createIntegritySlice } from '../integritySlice'

function makeBuilder({ data = [], error = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.upsert = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.then   = (onF, onR) => Promise.resolve({ data, error }).then(onF, onR)
  return builder
}

function mockSession(active = true, email = 'teacher@lws.test') {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: active ? { user: { id: 'u1', email } } : null },
  })
}

const slice = createIntegritySlice(() => {}, () => ({}))

const PAYLOAD = {
  lwsId: 'LWS-1', studentName: 'Manas Shirsat',
  examId: 'exam_1', examName: "Math's mock test", examDate: '2026-06-14',
  counterpartName: 'Saarth Deshmukh', counterpartLwsId: 'LWS-2',
  sharedWrong: 18, sameCorrect: 22, diff: 8, bothAnswered: 48,
}

beforeEach(() => vi.clearAllMocks())

describe('logIntegrityIncident', () => {
  it('upserts a snake_cased row (onConflict lws_id,exam_id) with admitted status + recorder email', async () => {
    mockSession(true, 'teacher@lws.test')
    const b = makeBuilder()
    supabase.from.mockReturnValue(b)

    const ok = await slice.logIntegrityIncident(PAYLOAD)
    expect(ok).toBe(true)
    expect(supabase.from).toHaveBeenCalledWith('integrity_incidents')
    expect(b.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lws_id: 'LWS-1', student_name: 'Manas Shirsat',
        exam_id: 'exam_1', exam_name: "Math's mock test", exam_date: '2026-06-14',
        counterpart_name: 'Saarth Deshmukh', counterpart_lws_id: 'LWS-2',
        shared_wrong: 18, same_correct: 22, diff: 8, both_answered: 48,
        status: 'admitted', created_by: 'teacher@lws.test',
      }),
      { onConflict: 'lws_id,exam_id' },
    )
  })

  it('returns false when lwsId or examId is missing', async () => {
    mockSession(true)
    expect(await slice.logIntegrityIncident({ ...PAYLOAD, lwsId: '' })).toBe(false)
    expect(await slice.logIntegrityIncident({ ...PAYLOAD, examId: '' })).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false with no session', async () => {
    mockSession(false)
    expect(await slice.logIntegrityIncident(PAYLOAD)).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns false on a Supabase error', async () => {
    mockSession(true)
    supabase.from.mockReturnValue(makeBuilder({ error: { message: 'boom' } }))
    expect(await slice.logIntegrityIncident(PAYLOAD)).toBe(false)
  })
})

describe('getIntegrityIncidentsForStudent', () => {
  it('returns rows for the student, newest first', async () => {
    mockSession(true)
    const rows = [{ id: 'i1', lws_id: 'LWS-1', exam_name: 'X' }]
    const b = makeBuilder({ data: rows })
    supabase.from.mockReturnValue(b)
    const out = await slice.getIntegrityIncidentsForStudent('LWS-1')
    expect(out).toEqual(rows)
    expect(b.eq).toHaveBeenCalledWith('lws_id', 'LWS-1')
    expect(b.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('returns [] with no session and on missing id', async () => {
    mockSession(false)
    expect(await slice.getIntegrityIncidentsForStudent('LWS-1')).toEqual([])
    mockSession(true)
    expect(await slice.getIntegrityIncidentsForStudent('')).toEqual([])
  })
})

describe('getAllIntegrityIncidents', () => {
  it('returns all incident rows newest-first (Dashboard rollup)', async () => {
    mockSession(true)
    const rows = [{ id: 'a', lws_id: 'L1' }, { id: 'b', lws_id: 'L2' }]
    const b = makeBuilder({ data: rows })
    supabase.from.mockReturnValue(b)
    const out = await slice.getAllIntegrityIncidents()
    expect(out).toEqual(rows)
    expect(supabase.from).toHaveBeenCalledWith('integrity_incidents')
    expect(b.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('returns [] with no session', async () => {
    mockSession(false)
    expect(await slice.getAllIntegrityIncidents()).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('getIntegrityIncidentsForExam', () => {
  it('returns rows for the exam (drives the panel "logged" badge)', async () => {
    mockSession(true)
    const rows = [{ id: 'i1', lws_id: 'LWS-1', exam_id: 'exam_1' }]
    const b = makeBuilder({ data: rows })
    supabase.from.mockReturnValue(b)
    const out = await slice.getIntegrityIncidentsForExam('exam_1')
    expect(out).toEqual(rows)
    expect(b.eq).toHaveBeenCalledWith('exam_id', 'exam_1')
  })

  it('returns [] with no session', async () => {
    mockSession(false)
    expect(await slice.getIntegrityIncidentsForExam('exam_1')).toEqual([])
  })
})

describe('deleteIntegrityIncident', () => {
  it('deletes by id and returns true', async () => {
    mockSession(true)
    const b = makeBuilder()
    supabase.from.mockReturnValue(b)
    const ok = await slice.deleteIntegrityIncident('i1')
    expect(ok).toBe(true)
    expect(b.delete).toHaveBeenCalled()
    expect(b.eq).toHaveBeenCalledWith('id', 'i1')
  })

  it('returns false with no session or missing id', async () => {
    mockSession(false)
    expect(await slice.deleteIntegrityIncident('i1')).toBe(false)
    mockSession(true)
    expect(await slice.deleteIntegrityIncident('')).toBe(false)
  })
})
