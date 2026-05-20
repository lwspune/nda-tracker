// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { buildNameLookup, migrateInsights } from '../../migrate_insights_to_supabase.js'

describe('buildNameLookup', () => {
  it('maps canonical_name → lws_id', () => {
    const db = { students: [
      { lws_id: 'LWS-001', canonical_name: 'Aarav Sharma', name_variants: [] },
    ]}
    const map = buildNameLookup(db)
    expect(map.get('Aarav Sharma')).toBe('LWS-001')
  })

  it('maps every name_variants entry → lws_id', () => {
    const db = { students: [
      { lws_id: 'LWS-002', canonical_name: 'Nirnit Hemraj Patil', name_variants: ['Nirnit Patil', 'NIRNIT'] },
    ]}
    const map = buildNameLookup(db)
    expect(map.get('Nirnit Patil')).toBe('LWS-002')
    expect(map.get('NIRNIT')).toBe('LWS-002')
    expect(map.get('Nirnit Hemraj Patil')).toBe('LWS-002')
  })

  it('skips rows without lws_id', () => {
    const db = { students: [
      { lws_id: '', canonical_name: 'Ghost' },
      { lws_id: null, canonical_name: 'Other' },
    ]}
    const map = buildNameLookup(db)
    expect(map.has('Ghost')).toBe(false)
    expect(map.has('Other')).toBe(false)
  })

  it('returns empty map for an empty students_db', () => {
    expect(buildNameLookup({}).size).toBe(0)
    expect(buildNameLookup({ students: [] }).size).toBe(0)
  })
})

describe('migrateInsights', () => {
  function makeClient({ duplicateOn = [] } = {}) {
    const insertMock = vi.fn(row => {
      const isDup = duplicateOn.some(d => row.generated_at === d || row.student_name === d)
      if (isDup) return Promise.resolve({ error: { code: '23505', message: 'duplicate' } })
      return Promise.resolve({ error: null })
    })
    const fromMock = vi.fn(() => ({ insert: insertMock }))
    return { from: fromMock, _insertMock: insertMock }
  }

  it('inserts a class_report when classReport is present', async () => {
    const client = makeClient()
    const result = await migrateInsights(client,
      { classReport: { text: 'r', generatedAt: '2025-01-01T00:00:00Z' }, studentPlans: {} },
      new Map())
    expect(result.classReportInserted).toBe(1)
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'r',
      generated_by: 'legacy-import',
      generated_at: '2025-01-01T00:00:00Z',
    }))
  })

  it('skips classReport row that was already migrated (unique constraint)', async () => {
    const client = makeClient({ duplicateOn: ['2025-01-01T00:00:00Z'] })
    const result = await migrateInsights(client,
      { classReport: { text: 'r', generatedAt: '2025-01-01T00:00:00Z' }, studentPlans: {} },
      new Map())
    expect(result.classReportInserted).toBe(0)
    expect(result.classReportSkipped).toBe(1)
  })

  it('inserts one student_plan per name', async () => {
    const client = makeClient()
    const result = await migrateInsights(client,
      {
        classReport: null,
        studentPlans: {
          Aarav: { text: 'plan A', generatedAt: '2025-02-01T00:00:00Z' },
          Bina:  { text: 'plan B', generatedAt: '2025-02-02T00:00:00Z' },
        },
      },
      new Map([['Aarav', 'LWS-001']]))
    expect(result.plansInserted).toBe(2)
    expect(result.unresolved).toEqual(['Bina'])
  })

  it('passes resolved lws_id when name is in the lookup', async () => {
    const client = makeClient()
    await migrateInsights(client,
      { classReport: null, studentPlans: { Aarav: { text: 'p', generatedAt: 't' } } },
      new Map([['Aarav', 'LWS-001']]))
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      lws_id: 'LWS-001',
      student_name: 'Aarav',
    }))
  })

  it('passes lws_id=null when name not in lookup', async () => {
    const client = makeClient()
    await migrateInsights(client,
      { classReport: null, studentPlans: { Ghost: { text: 'p', generatedAt: 't' } } },
      new Map())
    expect(client._insertMock).toHaveBeenCalledWith(expect.objectContaining({
      lws_id: null,
    }))
  })

  it('is a no-op when source is empty', async () => {
    const client = makeClient()
    const result = await migrateInsights(client, { classReport: null, studentPlans: {} }, new Map())
    expect(result.classReportInserted).toBe(0)
    expect(result.plansInserted).toBe(0)
    expect(client._insertMock).not.toHaveBeenCalled()
  })

  it('skips plans whose text is empty', async () => {
    const client = makeClient()
    const result = await migrateInsights(client,
      { classReport: null, studentPlans: { Aarav: { text: '', generatedAt: 't' } } },
      new Map())
    expect(result.plansInserted).toBe(0)
    expect(client._insertMock).not.toHaveBeenCalled()
  })
})
