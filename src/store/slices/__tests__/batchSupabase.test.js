import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cascadeBatchRenameToSupabase } from '../batchSupabase'

// ── Chainable mock factory ────────────────────────────────────────────────────
// Each `client.from(table)` call returns a fresh builder. The builder is a
// thenable that resolves to whatever `data`/`error` we set for that call.

function makeBuilder({ data = [], error = null } = {}) {
  const b = {}
  b.select = vi.fn(() => b)
  b.eq     = vi.fn(() => b)
  b.like   = vi.fn(() => b)
  b.in     = vi.fn(() => b)
  b.delete = vi.fn(() => b)
  b.insert = vi.fn(() => b)
  b.upsert = vi.fn(() => b)
  b.update = vi.fn(() => b)
  b.then   = (resolve, reject) =>
    Promise.resolve({ data, error }).then(resolve, reject)
  return b
}

// queueByTable: { table_name: [builder1, builder2, ...] } — successive
// from(table) calls pull from the queue in order. Tests preset what each
// call should return.
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
    _builderForCall: (table, idx) => (queueByTable[table] || [])[idx],
  }
}

beforeEach(() => vi.clearAllMocks())

// ── No-op cases ──────────────────────────────────────────────────────────────

describe('cascadeBatchRenameToSupabase — no-op cases', () => {
  it('does nothing when oldName equals newName', async () => {
    const client = makeClient({})
    const result = await cascadeBatchRenameToSupabase(client, 'A', 'A')
    expect(result).toEqual({ studentBatchRows: 0, examRows: 0 })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('does nothing when either name is empty / null', async () => {
    const client = makeClient({})
    expect(await cascadeBatchRenameToSupabase(client, '',    'B')).toEqual({ studentBatchRows: 0, examRows: 0 })
    expect(await cascadeBatchRenameToSupabase(client, 'A',   ''))  .toEqual({ studentBatchRows: 0, examRows: 0 })
    expect(await cascadeBatchRenameToSupabase(client, null,  'B')).toEqual({ studentBatchRows: 0, examRows: 0 })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('does nothing when client is null (legacy / GH Pages — same guard as other slices)', async () => {
    const result = await cascadeBatchRenameToSupabase(null, 'A', 'B')
    expect(result).toEqual({ studentBatchRows: 0, examRows: 0 })
  })
})

// ── student_batches cascade ──────────────────────────────────────────────────

describe('cascadeBatchRenameToSupabase — student_batches', () => {
  it('reads affected lws_ids, deletes old rows, inserts new rows (delete + upsert pattern)', async () => {
    const sbRead   = makeBuilder({ data: [{ lws_id: 'LWS-001' }, { lws_id: 'LWS-002' }] })
    const sbDelete = makeBuilder()
    const sbInsert = makeBuilder()
    const exRead   = makeBuilder({ data: [] }) // no affected exams
    const client = makeClient({
      student_batches: [sbRead, sbDelete, sbInsert],
      exams:           [exRead],
    })

    const result = await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')
    expect(result.studentBatchRows).toBe(2)

    // 1) Read
    expect(sbRead.select).toHaveBeenCalledWith('lws_id')
    expect(sbRead.eq).toHaveBeenCalledWith('batch_name', 'OldName')

    // 2) Delete old
    expect(sbDelete.delete).toHaveBeenCalled()
    expect(sbDelete.eq).toHaveBeenCalledWith('batch_name', 'OldName')

    // 3) Insert new (upsert with ignoreDuplicates to handle the edge case
    //    where a student already has both old + new entries)
    expect(sbInsert.upsert).toHaveBeenCalledTimes(1)
    const rows = sbInsert.upsert.mock.calls[0][0]
    expect(rows).toEqual([
      { lws_id: 'LWS-001', batch_name: 'NewName' },
      { lws_id: 'LWS-002', batch_name: 'NewName' },
    ])
    const opts = sbInsert.upsert.mock.calls[0][1]
    expect(opts?.onConflict).toBe('lws_id,batch_name')
    expect(opts?.ignoreDuplicates).toBe(true)
  })

  it('skips the delete + upsert entirely when no rows match', async () => {
    const sbRead = makeBuilder({ data: [] })
    const exRead = makeBuilder({ data: [] })
    const client = makeClient({
      student_batches: [sbRead],
      exams:           [exRead],
    })

    const result = await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')
    expect(result.studentBatchRows).toBe(0)
    // Only the read happened — no second from('student_batches') call.
    expect(client.from.mock.calls.filter(c => c[0] === 'student_batches').length).toBe(1)
  })
})

// ── exams.batch cascade ──────────────────────────────────────────────────────

describe('cascadeBatchRenameToSupabase — exams.batch', () => {
  it('replaces a single-name batch tag with the new name', async () => {
    const sbRead = makeBuilder({ data: [] })
    const exRead = makeBuilder({ data: [
      { id: 'e1', batch: 'OldName' },
    ] })
    const exUpdate = makeBuilder()
    const client = makeClient({
      student_batches: [sbRead],
      exams:           [exRead, exUpdate],
    })

    const result = await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')
    expect(result.examRows).toBe(1)

    expect(exRead.select).toHaveBeenCalledWith('id, batch')
    expect(exRead.like).toHaveBeenCalledWith('batch', '%OldName%')

    expect(exUpdate.update).toHaveBeenCalledWith({ batch: 'NewName' })
    expect(exUpdate.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('replaces only the matching token in a comma-joined multi-batch tag, preserving the others and the order', async () => {
    const sbRead = makeBuilder({ data: [] })
    const exRead = makeBuilder({ data: [
      { id: 'e1', batch: 'APJ_X, OldName, LWS_Y' },
    ] })
    const exUpdate = makeBuilder()
    const client = makeClient({
      student_batches: [sbRead],
      exams:           [exRead, exUpdate],
    })

    await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')

    expect(exUpdate.update).toHaveBeenCalledWith({ batch: 'APJ_X, NewName, LWS_Y' })
    expect(exUpdate.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('rejects partial-string matches — only exact token matches are rewritten', async () => {
    // LIKE %OldName% will match these via SQL, but the token split must reject them.
    const sbRead = makeBuilder({ data: [] })
    const exRead = makeBuilder({ data: [
      { id: 'e1', batch: 'OldName_extra' },        // token doesn't equal OldName
      { id: 'e2', batch: 'pre_OldName' },          // ditto
      { id: 'e3', batch: 'OldName' },              // exact match
    ] })
    const exUpdate3 = makeBuilder()
    const client = makeClient({
      student_batches: [sbRead],
      exams:           [exRead, exUpdate3],
    })

    const result = await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')
    expect(result.examRows).toBe(1)
    expect(exUpdate3.eq).toHaveBeenCalledWith('id', 'e3')
    expect(exUpdate3.update).toHaveBeenCalledWith({ batch: 'NewName' })
  })

  it('skips exams whose batch contains OldName only as a substring (LIKE false positive)', async () => {
    const sbRead = makeBuilder({ data: [] })
    const exRead = makeBuilder({ data: [
      { id: 'e1', batch: 'XX_OldName_YY' },
    ] })
    const client = makeClient({
      student_batches: [sbRead],
      exams:           [exRead],
    })

    const result = await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')
    expect(result.examRows).toBe(0)
    // No update call — only the read happened
    expect(client.from.mock.calls.filter(c => c[0] === 'exams').length).toBe(1)
  })

  it('issues one UPDATE per affected exam (multiple matches → multiple updates)', async () => {
    const sbRead = makeBuilder({ data: [] })
    const exRead = makeBuilder({ data: [
      { id: 'e1', batch: 'OldName' },
      { id: 'e2', batch: 'OldName, X' },
      { id: 'e3', batch: 'Y, OldName' },
    ] })
    const u1 = makeBuilder()
    const u2 = makeBuilder()
    const u3 = makeBuilder()
    const client = makeClient({
      student_batches: [sbRead],
      exams:           [exRead, u1, u2, u3],
    })

    const result = await cascadeBatchRenameToSupabase(client, 'OldName', 'NewName')
    expect(result.examRows).toBe(3)
    expect(u1.update).toHaveBeenCalledWith({ batch: 'NewName' })
    expect(u2.update).toHaveBeenCalledWith({ batch: 'NewName, X' })
    expect(u3.update).toHaveBeenCalledWith({ batch: 'Y, NewName' })
  })

  it('skips the read when oldName contains a comma (would never match a token)', async () => {
    // OldName with a comma can't have been a valid central batch — addBatch
    // rejects comma names. Defensive guard.
    const client = makeClient({})
    const result = await cascadeBatchRenameToSupabase(client, 'A,B', 'New')
    expect(result).toEqual({ studentBatchRows: 0, examRows: 0 })
    expect(client.from).not.toHaveBeenCalled()
  })
})
