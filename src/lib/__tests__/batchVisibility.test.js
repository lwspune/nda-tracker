import { describe, it, expect } from 'vitest'
import { visibleBatchOptions, isArchivedBatch } from '../batchVisibility'

const ALL = ['Alpha', 'Retired', 'Beta']

describe('visibleBatchOptions', () => {
  it('drops archived batches', () => {
    expect(visibleBatchOptions(ALL, ['Retired'])).toEqual(['Alpha', 'Beta'])
  })

  it('keeps an archived batch that is already selected (Set)', () => {
    expect(visibleBatchOptions(ALL, ['Retired'], new Set(['Retired']))).toEqual(ALL)
  })

  it('keeps an archived batch that is already selected (array)', () => {
    expect(visibleBatchOptions(ALL, ['Retired'], ['Retired'])).toEqual(ALL)
  })

  it('preserves the source order', () => {
    expect(visibleBatchOptions(ALL, ['Alpha'], ['Alpha'])).toEqual(ALL)
  })

  it('returns a copy when nothing is archived', () => {
    const out = visibleBatchOptions(ALL, [])
    expect(out).toEqual(ALL)
    expect(out).not.toBe(ALL)
  })

  it('tolerates null / undefined inputs', () => {
    expect(visibleBatchOptions(null, null)).toEqual([])
    expect(visibleBatchOptions(ALL, undefined)).toEqual(ALL)
    expect(visibleBatchOptions(ALL, ['Retired'], null)).toEqual(['Alpha', 'Beta'])
  })
})

describe('isArchivedBatch', () => {
  it('reports membership', () => {
    expect(isArchivedBatch(['Retired'], 'Retired')).toBe(true)
    expect(isArchivedBatch(['Retired'], 'Alpha')).toBe(false)
  })

  it('tolerates a missing list', () => {
    expect(isArchivedBatch(undefined, 'Alpha')).toBe(false)
  })
})
