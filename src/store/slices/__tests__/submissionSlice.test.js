import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createSubmissionSlice } from '../submissionSlice'

// Chainable query-builder mock — same pattern as lectureAbsenceSlice tests.
function makeQueryBuilder({ data = [], error = null, upsertError = null } = {}) {
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.in     = vi.fn(() => builder)
  builder.gte    = vi.fn(() => builder)
  builder.order  = vi.fn(() => builder)
  builder.upsert = vi.fn(() => Promise.resolve({ error: upsertError }))
  builder.then   = (onFulfilled, onRejected) =>
    Promise.resolve({ data, error }).then(onFulfilled, onRejected)
  return builder
}

function mockSupabase({ sessionActive = true, role, ...builderOpts } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: {
      session: sessionActive
        ? { user: { id: 'u1', email: 'akash@lwspune.com', user_metadata: role ? { role } : {} } }
        : null,
    },
  })
  const builder = makeQueryBuilder(builderOpts)
  supabase.from.mockReturnValue(builder)
  return { builder }
}

function makeStore() {
  let state = {}
  const get = () => state
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  return { slice: createSubmissionSlice(set, get) }
}

const ARGS = {
  date: '2026-07-27',
  slotId: 'slot_a',
  batchName: '12th',
  subject: 'Maths',
  teacherId: 't1',
  absentCount: 3,
}

describe('submitLecture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts one filing row keyed by (date, slot_id, batch_name)', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()

    const ok = await slice.submitLecture(ARGS)

    expect(ok).toBe(true)
    expect(supabase.from).toHaveBeenCalledWith('lecture_submissions')
    expect(builder.upsert).toHaveBeenCalledOnce()
    const [row, opts] = builder.upsert.mock.calls[0]
    expect(row).toMatchObject({
      date: '2026-07-27',
      slot_id: 'slot_a',
      batch_name: '12th',
      subject: 'Maths',
      teacher_id: 't1',
      absent_count: 3,
      submitted_by: 'akash@lwspune.com',
      source: 'teacher',
    })
    // Batch is part of the conflict key — slot ids are per-timetable and two
    // batches can legitimately share one.
    expect(opts).toEqual({ onConflict: 'date,slot_id,batch_name' })
  })

  // A filing with nobody absent is the whole point of the table — it must write
  // a row, not be optimised away as "nothing to record".
  it('files a row even when zero students were absent', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()

    const ok = await slice.submitLecture({ ...ARGS, absentCount: 0 })

    expect(ok).toBe(true)
    expect(builder.upsert.mock.calls[0][0]).toMatchObject({ absent_count: 0 })
  })

  it('re-filing refreshes submitted_at rather than leaving the first stamp', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()

    await slice.submitLecture(ARGS)

    // Explicit, not the column default: on the UPDATE half of an upsert the
    // default never re-applies, so a re-file would keep a stale timestamp.
    const row = builder.upsert.mock.calls[0][0]
    expect(row.submitted_at).toEqual(expect.any(String))
    expect(Number.isNaN(Date.parse(row.submitted_at))).toBe(false)
  })

  it('records admin filings distinctly from teacher filings', async () => {
    const { builder } = mockSupabase()
    const { slice } = makeStore()

    await slice.submitLecture({ ...ARGS, source: 'admin' })

    expect(builder.upsert.mock.calls[0][0]).toMatchObject({ source: 'admin' })
  })

  it('returns false without a session and never touches the table', async () => {
    const { builder } = mockSupabase({ sessionActive: false })
    const { slice } = makeStore()

    expect(await slice.submitLecture(ARGS)).toBe(false)
    expect(builder.upsert).not.toHaveBeenCalled()
  })

  it('returns false on missing identifying args', async () => {
    mockSupabase()
    const { slice } = makeStore()

    expect(await slice.submitLecture({ ...ARGS, date: null })).toBe(false)
    expect(await slice.submitLecture({ ...ARGS, slotId: '' })).toBe(false)
    expect(await slice.submitLecture({ ...ARGS, batchName: undefined })).toBe(false)
  })

  it('returns false when the write errors', async () => {
    mockSupabase({ upsertError: { message: 'nope' } })
    const { slice } = makeStore()

    expect(await slice.submitLecture(ARGS)).toBe(false)
  })
})

describe('getSubmissionsForDate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the filings for one date', async () => {
    const rows = [{ slot_id: 'slot_a', batch_name: '12th', absent_count: 2 }]
    const { builder } = mockSupabase({ data: rows })
    const { slice } = makeStore()

    expect(await slice.getSubmissionsForDate('2026-07-27')).toEqual(rows)
    expect(builder.eq).toHaveBeenCalledWith('date', '2026-07-27')
  })

  it('returns [] for a missing date, no session, or a read error', async () => {
    mockSupabase()
    const { slice } = makeStore()
    expect(await slice.getSubmissionsForDate(null)).toEqual([])

    mockSupabase({ sessionActive: false })
    expect(await slice.getSubmissionsForDate('2026-07-27')).toEqual([])

    mockSupabase({ error: { message: 'boom' } })
    expect(await slice.getSubmissionsForDate('2026-07-27')).toEqual([])
  })
})
