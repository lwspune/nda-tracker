import { describe, it, expect, vi } from 'vitest'
import {
  insertClassReport,
  insertStudentPlan,
  deleteAllClassReports,
  deleteStudentPlansByName,
} from '../insightsSupabase'

function makeMockClient({ insertErr = null, deleteErr = null } = {}) {
  const insertMock = vi.fn().mockResolvedValue({ error: insertErr })
  const deleteEq   = vi.fn().mockResolvedValue({ error: deleteErr })
  const deleteNot  = vi.fn().mockResolvedValue({ error: deleteErr })
  const deleteMock = vi.fn().mockReturnValue({ eq: deleteEq, not: deleteNot })

  return {
    from: vi.fn(() => ({ insert: insertMock, delete: deleteMock })),
    _insertMock: insertMock,
    _deleteMock: deleteMock,
    _deleteEq:   deleteEq,
    _deleteNot:  deleteNot,
  }
}

describe('insertClassReport', () => {
  it('inserts text + nullable exam_id + generated_by', async () => {
    const client = makeMockClient()
    await insertClassReport(client, { text: 'great class', examId: 'exam_1', generatedBy: 'claude-opus-4-7' })
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'great class',
      exam_id: 'exam_1',
      generated_by: 'claude-opus-4-7',
    }))
  })

  it('passes generated_at when supplied (used by migration to preserve original timestamp)', async () => {
    const client = makeMockClient()
    await insertClassReport(client, { text: 'x', generatedAt: '2025-01-01T00:00:00.000Z', generatedBy: 'legacy-import' })
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      generated_at: '2025-01-01T00:00:00.000Z',
    }))
  })

  it('omits generated_at when not supplied (lets the DB default to now())', async () => {
    const client = makeMockClient()
    await insertClassReport(client, { text: 'x' })
    const row = client._insertMock.mock.calls[0][0]
    expect(row).not.toHaveProperty('generated_at')
  })

  it('throws when insert fails', async () => {
    const client = makeMockClient({ insertErr: { message: 'rls' } })
    await expect(insertClassReport(client, { text: 'x' })).rejects.toThrow('class_reports insert failed')
  })
})

describe('insertStudentPlan', () => {
  it('inserts student_name + text + nullable lws_id', async () => {
    const client = makeMockClient()
    await insertStudentPlan(client, { studentName: 'Aarav Sharma', text: 'plan body', lwsId: 'LWS-001' })
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      student_name: 'Aarav Sharma',
      text: 'plan body',
      lws_id: 'LWS-001',
    }))
  })

  it('allows null lws_id (for unresolved names)', async () => {
    const client = makeMockClient()
    await insertStudentPlan(client, { studentName: 'Unknown Student', text: 'plan' })
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      lws_id: null,
    }))
  })

  it('passes generated_at when supplied', async () => {
    const client = makeMockClient()
    await insertStudentPlan(client, { studentName: 'X', text: 'p', generatedAt: '2025-01-01T00:00:00.000Z' })
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      generated_at: '2025-01-01T00:00:00.000Z',
    }))
  })

  it('throws when insert fails', async () => {
    const client = makeMockClient({ insertErr: { message: 'fk_violation' } })
    await expect(insertStudentPlan(client, { studentName: 'X', text: 'p' })).rejects.toThrow('student_plans insert failed')
  })
})

describe('deleteAllClassReports', () => {
  it('clears the table', async () => {
    const client = makeMockClient()
    await deleteAllClassReports(client)
    expect(client._deleteMock).toHaveBeenCalled()
  })

  it('throws when delete fails', async () => {
    const client = makeMockClient({ deleteErr: { message: 'rls' } })
    await expect(deleteAllClassReports(client)).rejects.toThrow('class_reports delete failed')
  })
})

describe('deleteStudentPlansByName', () => {
  it('deletes rows matching student_name', async () => {
    const client = makeMockClient()
    await deleteStudentPlansByName(client, 'Aarav Sharma')
    expect(client._deleteEq).toHaveBeenCalledWith('student_name', 'Aarav Sharma')
  })

  it('throws when delete fails', async () => {
    const client = makeMockClient({ deleteErr: { message: 'rls' } })
    await expect(deleteStudentPlansByName(client, 'X')).rejects.toThrow('student_plans delete failed')
  })
})
