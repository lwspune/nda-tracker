import { describe, it, expect } from 'vitest'
import { buildLeaveReportGroups, classOfBatch, STD_ORDER } from '../hostelLeaveReportPdf'

// Helper to build a minimal on-leave report row.
const row = (over = {}) => ({
  lwsId: over.lwsId || Math.random().toString(36).slice(2),
  name: 'A',
  gender: 'Male',
  batch: 'APJ_NDA_9th_(26-27)',
  since: '10-07-2026',
  daysOut: 1,
  mobile: '',
  parent: '',
  ...over,
})

describe('classOfBatch', () => {
  it('extracts the class level from a full batch name', () => {
    expect(classOfBatch('APJ_NDA_9th_(26-27)')).toBe('9th')
    expect(classOfBatch('APJ_NDA_10th_(26-27)')).toBe('10th')
    expect(classOfBatch('APJ_NDA_12th_(26-27)')).toBe('12th')
    expect(classOfBatch('APJ_NDA_6M_(Sep26)')).toBe('6M')
  })

  it('collapses 11th A and 11th B to a single 11th bucket', () => {
    expect(classOfBatch('APJ_NDA_11th_(26-27)_A')).toBe('11th')
    expect(classOfBatch('APJ_NDA_11th_(26-27)_B')).toBe('11th')
  })

  it('does not confuse 10th/12th with a bare digit', () => {
    expect(classOfBatch('APJ_NDA_10th_(26-27)')).not.toBe('9th')
    expect(classOfBatch('APJ_NDA_10th_(26-27)')).not.toBe('1th')
  })

  it('returns null for an empty or unrecognised batch', () => {
    expect(classOfBatch('')).toBeNull()
    expect(classOfBatch(null)).toBeNull()
    expect(classOfBatch('APJ_NDA_Foundation_(26-27)')).toBeNull()
  })
})

describe('buildLeaveReportGroups', () => {
  it('returns an empty array for no rows', () => {
    expect(buildLeaveReportGroups([])).toEqual([])
  })

  it('splits into Boys then Girls sections in that order', () => {
    const groups = buildLeaveReportGroups([
      row({ gender: 'Female', name: 'Fem' }),
      row({ gender: 'Male', name: 'Man' }),
    ])
    expect(groups.map(g => g.gender)).toEqual(['Boys', 'Girls'])
    expect(groups[0].count).toBe(1)
    expect(groups[1].count).toBe(1)
  })

  it('omits a gender section when nobody in it is on leave', () => {
    const groups = buildLeaveReportGroups([row({ gender: 'Male' })])
    expect(groups.map(g => g.gender)).toEqual(['Boys'])
  })

  it('orders batch groups 9th, 10th, 11th, 12th, 6M — not alphabetical', () => {
    const groups = buildLeaveReportGroups([
      row({ batch: 'APJ_NDA_6M_(Sep26)' }),
      row({ batch: 'APJ_NDA_12th_(26-27)' }),
      row({ batch: 'APJ_NDA_9th_(26-27)' }),
      row({ batch: 'APJ_NDA_11th_(26-27)_A' }),
      row({ batch: 'APJ_NDA_10th_(26-27)' }),
    ])
    expect(groups[0].groups.map(g => g.batch)).toEqual(['9th', '10th', '11th', '12th', '6M'])
  })

  it('collapses 11th A and 11th B into one 11th group with a combined count', () => {
    const groups = buildLeaveReportGroups([
      row({ batch: 'APJ_NDA_11th_(26-27)_A', name: 'Alpha' }),
      row({ batch: 'APJ_NDA_11th_(26-27)_B', name: 'Bravo' }),
    ])
    const eleventh = groups[0].groups
    expect(eleventh).toHaveLength(1)
    expect(eleventh[0].batch).toBe('11th')
    expect(eleventh[0].count).toBe(2)
  })

  it('buckets an unrecognised/empty batch under Other, sorted last', () => {
    const groups = buildLeaveReportGroups([
      row({ batch: '' }),
      row({ batch: 'APJ_NDA_9th_(26-27)' }),
    ])
    expect(groups[0].groups.map(g => g.batch)).toEqual(['9th', 'Other'])
  })

  it('puts blank/unknown gender in an Unspecified section after Girls', () => {
    const groups = buildLeaveReportGroups([
      row({ gender: '' }),
      row({ gender: 'Female' }),
      row({ gender: 'Male' }),
    ])
    expect(groups.map(g => g.gender)).toEqual(['Boys', 'Girls', 'Unspecified'])
  })

  it('sorts students by name within a batch group', () => {
    const groups = buildLeaveReportGroups([
      row({ name: 'Zara', batch: 'APJ_NDA_9th_(26-27)' }),
      row({ name: 'Aman', batch: 'APJ_NDA_9th_(26-27)' }),
    ])
    expect(groups[0].groups[0].students.map(s => s.name)).toEqual(['Aman', 'Zara'])
  })

  it('exposes the canonical class order', () => {
    expect(STD_ORDER).toEqual(['9th', '10th', '11th', '12th', '6M'])
  })
})
