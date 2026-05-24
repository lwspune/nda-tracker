import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanStaleAbsencesForVariant } from '../absenceCleanup'

// Same chainable mock pattern as batchSupabase.test.js — each from(table) call
// pulls the next pre-set builder from a per-table queue.

function makeBuilder({ data = [], error = null } = {}) {
  const b = {}
  b.select = vi.fn(() => b)
  b.eq     = vi.fn(() => b)
  b.in     = vi.fn(() => b)
  b.delete = vi.fn(() => b)
  b.then   = (resolve, reject) =>
    Promise.resolve({ data, error }).then(resolve, reject)
  return b
}

function makeClient(queueByTable) {
  const counts = {}
  return {
    from: vi.fn(table => {
      counts[table] = (counts[table] || 0)
      const q = queueByTable[table] || []
      const b = q[counts[table]] ?? makeBuilder()
      counts[table]++
      return b
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('cleanStaleAbsencesForVariant — no-op cases', () => {
  it('returns 0 when client is null', async () => {
    expect(await cleanStaleAbsencesForVariant(null, 'LWS-001', 'A B')).toEqual({ deleted: 0 })
  })

  it('returns 0 when lwsId is empty', async () => {
    const client = makeClient({})
    expect(await cleanStaleAbsencesForVariant(client, '', 'A B')).toEqual({ deleted: 0 })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('returns 0 when variantName is empty', async () => {
    const client = makeClient({})
    expect(await cleanStaleAbsencesForVariant(client, 'LWS-001', '')).toEqual({ deleted: 0 })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('returns 0 when no exam_results row uses the variant (nothing to clean)', async () => {
    const erRead = makeBuilder({ data: [] })
    const client = makeClient({ exam_results: [erRead] })
    const result = await cleanStaleAbsencesForVariant(client, 'LWS-001', 'Aaditya Suryawanshi')
    expect(result).toEqual({ deleted: 0 })
    expect(erRead.eq).toHaveBeenCalledWith('student_name', 'Aaditya Suryawanshi')
    // No exam_absences call
    expect(client.from).toHaveBeenCalledTimes(1)
  })
})

describe('cleanStaleAbsencesForVariant — happy path', () => {
  it('deletes exam_absences rows for the (lws_id, exam_ids[]) when matching exam_results exist', async () => {
    const erRead = makeBuilder({ data: [{ exam_id: 'exam_1' }, { exam_id: 'exam_2' }] })
    const eaDelete = makeBuilder()
    const client = makeClient({ exam_results: [erRead], exam_absences: [eaDelete] })

    const result = await cleanStaleAbsencesForVariant(client, 'LWS-366', 'Aaditya Suryawanshi')
    expect(result).toEqual({ deleted: 2 })

    expect(erRead.select).toHaveBeenCalledWith('exam_id')
    expect(erRead.eq).toHaveBeenCalledWith('student_name', 'Aaditya Suryawanshi')

    expect(eaDelete.delete).toHaveBeenCalled()
    expect(eaDelete.eq).toHaveBeenCalledWith('lws_id', 'LWS-366')
    expect(eaDelete.in).toHaveBeenCalledWith('exam_id', ['exam_1', 'exam_2'])
  })

  it('dedupes exam_ids when exam_results has duplicate rows for the same exam', async () => {
    const erRead = makeBuilder({
      data: [{ exam_id: 'exam_1' }, { exam_id: 'exam_1' }, { exam_id: 'exam_2' }],
    })
    const eaDelete = makeBuilder()
    const client = makeClient({ exam_results: [erRead], exam_absences: [eaDelete] })

    const result = await cleanStaleAbsencesForVariant(client, 'LWS-366', 'Foo Bar')
    expect(result).toEqual({ deleted: 2 })
    expect(eaDelete.in).toHaveBeenCalledWith('exam_id', ['exam_1', 'exam_2'])
  })
})

describe('cleanStaleAbsencesForVariant — error handling', () => {
  it('returns 0 and does not delete when exam_results read errors', async () => {
    const erRead = makeBuilder({ error: { message: 'boom' } })
    const client = makeClient({ exam_results: [erRead] })
    const result = await cleanStaleAbsencesForVariant(client, 'LWS-001', 'A B')
    expect(result).toEqual({ deleted: 0 })
    expect(client.from).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when delete errors (but did attempt the call)', async () => {
    const erRead = makeBuilder({ data: [{ exam_id: 'exam_1' }] })
    const eaDelete = makeBuilder({ error: { message: 'boom' } })
    const client = makeClient({ exam_results: [erRead], exam_absences: [eaDelete] })
    const result = await cleanStaleAbsencesForVariant(client, 'LWS-001', 'A B')
    expect(result).toEqual({ deleted: 0 })
    expect(eaDelete.delete).toHaveBeenCalled()
  })
})
