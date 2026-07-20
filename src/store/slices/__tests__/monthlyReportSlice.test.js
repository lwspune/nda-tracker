import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client BEFORE importing the slice so the module-level
// `import { supabase }` resolves to our test double.
let mockClient = null
vi.mock('../../../lib/supabase', () => ({
  get supabase() { return mockClient },
}))

// Same chainable mock factory as the other slice tests.
function makeBuilder({ data = [], error = null } = {}) {
  const b = {}
  b.select = vi.fn(() => b)
  b.eq     = vi.fn(() => b)
  b.in     = vi.fn(() => b)
  b.gte    = vi.fn(() => b)
  b.lte    = vi.fn(() => b)
  b.then   = (resolve, reject) =>
    Promise.resolve({ data, error }).then(resolve, reject)
  return b
}

function makeMockClient({ session = { user: { id: 'u' } }, builders = {} } = {}) {
  const counts = {}
  return {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session } })),
    },
    from: vi.fn(table => {
      counts[table] = counts[table] || 0
      const queue = builders[table] || []
      const builder = queue[counts[table]] ?? makeBuilder()
      counts[table]++
      return builder
    }),
  }
}

let slice
beforeEach(async () => {
  vi.clearAllMocks()
  mockClient = null
  const mod = await import('../monthlyReportSlice')
  slice = mod.createMonthlyReportSlice(() => {}, () => ({}))
})

describe('fetchMonthlyReportData — no-op cases', () => {
  it('returns null when supabase client is unavailable', async () => {
    mockClient = null
    const result = await slice.fetchMonthlyReportData('2026-01-01', '2026-01-31', ['LWS-001'])
    expect(result).toBeNull()
  })

  it('returns null when no session', async () => {
    mockClient = makeMockClient({ session: null })
    const result = await slice.fetchMonthlyReportData('2026-01-01', '2026-01-31', ['LWS-001'])
    expect(result).toBeNull()
    expect(mockClient.from).not.toHaveBeenCalled()
  })

  it('returns empty groupings when cohort is empty', async () => {
    mockClient = makeMockClient()
    const result = await slice.fetchMonthlyReportData('2026-01-01', '2026-01-31', [])
    expect(result).toEqual({
      attendanceByLwsId: {},
      lectureAbsencesByLwsId: {},
      examAbsencesByLwsId: {},
      homeworkByLwsId: {},
    })
    expect(mockClient.from).not.toHaveBeenCalled()
  })
})

describe('fetchMonthlyReportData — bulk fetch + groupBy', () => {
  it('issues one query per table with .in(lws_ids) and an inclusive .gte/.lte date window for date-bound tables', async () => {
    const att = makeBuilder({ data: [] })
    const lec = makeBuilder({ data: [] })
    const exa = makeBuilder({ data: [] })
    mockClient = makeMockClient({
      builders: {
        student_attendance: [att],
        lecture_absences:   [lec],
        exam_absences:      [exa],
      },
    })

    await slice.fetchMonthlyReportData('2026-01-05', '2026-02-15', ['LWS-001', 'LWS-002'])

    expect(mockClient.from).toHaveBeenCalledWith('student_attendance')
    expect(mockClient.from).toHaveBeenCalledWith('lecture_absences')
    expect(mockClient.from).toHaveBeenCalledWith('exam_absences')

    expect(att.in).toHaveBeenCalledWith('lws_id', ['LWS-001', 'LWS-002'])
    expect(att.gte).toHaveBeenCalledWith('date', '2026-01-05')
    expect(att.lte).toHaveBeenCalledWith('date', '2026-02-15')

    expect(lec.in).toHaveBeenCalledWith('lws_id', ['LWS-001', 'LWS-002'])
    expect(lec.gte).toHaveBeenCalledWith('date', '2026-01-05')
    expect(lec.lte).toHaveBeenCalledWith('date', '2026-02-15')

    expect(exa.in).toHaveBeenCalledWith('lws_id', ['LWS-001', 'LWS-002'])
    // exam_absences are NOT filtered by date at the SQL level — exam.date lives
    // on a different table; we filter client-side via the in-memory exams[] array.
    expect(exa.gte).not.toHaveBeenCalled()
    expect(exa.lte).not.toHaveBeenCalled()
  })

  it('groups rows by lws_id across all three tables', async () => {
    mockClient = makeMockClient({
      builders: {
        student_attendance: [makeBuilder({
          data: [
            { lws_id: 'LWS-001', date: '2026-01-03', status: 'P' },
            { lws_id: 'LWS-001', date: '2026-01-04', status: 'L' },
            { lws_id: 'LWS-002', date: '2026-01-03', status: 'A' },
          ],
        })],
        lecture_absences: [makeBuilder({
          data: [
            { lws_id: 'LWS-001', date: '2026-01-05', slot_id: 's1', subject: 'Maths' },
          ],
        })],
        exam_absences: [makeBuilder({
          data: [
            { lws_id: 'LWS-002', exam_id: 'e1', marked_at: '2026-01-09T10:00Z', notified_at: null },
          ],
        })],
      },
    })

    const result = await slice.fetchMonthlyReportData('2026-01-01', '2026-01-31', ['LWS-001', 'LWS-002'])

    expect(result.attendanceByLwsId['LWS-001']).toHaveLength(2)
    expect(result.attendanceByLwsId['LWS-002']).toHaveLength(1)
    expect(result.lectureAbsencesByLwsId['LWS-001']).toHaveLength(1)
    expect(result.lectureAbsencesByLwsId['LWS-002']).toBeUndefined()
    expect(result.examAbsencesByLwsId['LWS-002']).toHaveLength(1)
    expect(result.examAbsencesByLwsId['LWS-001']).toBeUndefined()
  })

  it('returns null when any of the three queries errors', async () => {
    mockClient = makeMockClient({
      builders: {
        student_attendance: [makeBuilder({ error: { message: 'boom' } })],
        lecture_absences:   [makeBuilder({ data: [] })],
        exam_absences:      [makeBuilder({ data: [] })],
      },
    })
    const result = await slice.fetchMonthlyReportData('2026-01-01', '2026-01-31', ['LWS-001'])
    expect(result).toBeNull()
  })
})
