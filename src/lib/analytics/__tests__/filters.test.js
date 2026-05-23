import { describe, it, expect } from 'vitest'
import { getExamBatches, getExamAbsentees } from '../filters'

describe('getExamBatches', () => {
  it('returns single-element array for a single batch', () => {
    expect(getExamBatches({ batch: 'APJ_NDA_2Y_(26-28)' })).toEqual(['APJ_NDA_2Y_(26-28)'])
  })

  it('splits comma-joined batches into a trimmed array', () => {
    expect(getExamBatches({ batch: 'APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A' }))
      .toEqual(['APJ_NDA_2Y_(26-28)', 'LWS_NDA_2Y_(26-28)_A'])
  })

  it('handles three or more batches', () => {
    expect(getExamBatches({ batch: 'A, B, C' })).toEqual(['A', 'B', 'C'])
  })

  it('returns empty array for missing batch field', () => {
    expect(getExamBatches({})).toEqual([])
    expect(getExamBatches({ batch: null })).toEqual([])
    expect(getExamBatches({ batch: undefined })).toEqual([])
  })

  it('returns empty array for empty / whitespace-only batch string', () => {
    expect(getExamBatches({ batch: '' })).toEqual([])
    expect(getExamBatches({ batch: '   ' })).toEqual([])
  })

  it('drops empty segments produced by stray commas', () => {
    expect(getExamBatches({ batch: 'A,,B' })).toEqual(['A', 'B'])
    expect(getExamBatches({ batch: ',A,' })).toEqual(['A'])
    expect(getExamBatches({ batch: 'A, , B' })).toEqual(['A', 'B'])
  })

  it('trims whitespace around each segment without requiring a space after the comma', () => {
    expect(getExamBatches({ batch: 'A,B' })).toEqual(['A', 'B'])
    expect(getExamBatches({ batch: '  A , B  ' })).toEqual(['A', 'B'])
  })

  it('returns empty array for non-exam input', () => {
    expect(getExamBatches(null)).toEqual([])
    expect(getExamBatches(undefined)).toEqual([])
  })
})

// ── getExamAbsentees ─────────────────────────────────────────────────────────

describe('getExamAbsentees', () => {
  const profiles = {
    'Alice': { lwsId: 'LWS-001', name: 'Alice', branch: 'APJ', batches: ['APJ_NDA_2Y_(26-28)'], mobile: '111', parentMobiles: ['100'], nameVariants: [] },
    'Bob':   { lwsId: 'LWS-002', name: 'Bob',   branch: 'APJ', batches: ['APJ_NDA_2Y_(26-28)'], mobile: '222', parentMobiles: ['200'], nameVariants: [] },
    'Cara':  { lwsId: 'LWS-003', name: 'Cara',  branch: 'LWS Pune', batches: ['LWS_NDA_2Y_(26-28)_A'], mobile: '333', parentMobiles: ['300'], nameVariants: [] },
    'Drew':  { lwsId: 'LWS-004', name: 'Drew',  branch: 'APJ', batches: ['LWS_NDA_2Y_(25-27)_A'], mobile: '444', parentMobiles: ['400'], nameVariants: [] },
    'Eli':   { lwsId: 'LWS-005', name: 'Eli',   branch: 'APJ', batches: [], mobile: '555', parentMobiles: ['500'], nameVariants: [] },
  }

  it('returns expected attendees minus those in exam.students[] (single batch)', () => {
    const exam = {
      batch: 'APJ_NDA_2Y_(26-28)',
      students: [{ name: 'Alice' }], // Bob absent
    }
    const result = getExamAbsentees(exam, profiles)
    expect(result.map(r => r.name)).toEqual(['Bob'])
    expect(result[0].lwsId).toBe('LWS-002')
    expect(result[0].parentMobiles).toEqual(['200'])
  })

  it('returns union of expected attendees across multiple batches (deduplicated)', () => {
    const exam = {
      batch: 'APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A',
      students: [{ name: 'Alice' }], // Bob + Cara absent
    }
    const result = getExamAbsentees(exam, profiles)
    expect(result.map(r => r.name).sort()).toEqual(['Bob', 'Cara'])
  })

  it('excludes profiles whose batches[] does not intersect exam.batches', () => {
    const exam = { batch: 'APJ_NDA_2Y_(26-28)', students: [] }
    const result = getExamAbsentees(exam, profiles)
    // Drew (LWS_NDA_2Y_(25-27)_A) and Cara (LWS_NDA_2Y_(26-28)_A) and Eli (no batches) are not expected
    expect(result.map(r => r.name).sort()).toEqual(['Alice', 'Bob'])
  })

  it('matches attendee names via name_variants — variant in exam.students excludes the canonical from absentees', () => {
    const profilesWithVariant = {
      ...profiles,
      'Bob': { ...profiles['Bob'], nameVariants: ['Bobby'] },
    }
    const exam = {
      batch: 'APJ_NDA_2Y_(26-28)',
      students: [{ name: 'Bobby' }], // variant — should resolve to Bob
    }
    const result = getExamAbsentees(exam, profilesWithVariant)
    expect(result.map(r => r.name)).toEqual(['Alice'])
  })

  it('returns empty array when exam has no batches set', () => {
    expect(getExamAbsentees({ batch: '', students: [] }, profiles)).toEqual([])
    expect(getExamAbsentees({ batch: null, students: [] }, profiles)).toEqual([])
  })

  it('returns empty array when all expected attendees were present', () => {
    const exam = {
      batch: 'APJ_NDA_2Y_(26-28)',
      students: [{ name: 'Alice' }, { name: 'Bob' }],
    }
    expect(getExamAbsentees(exam, profiles)).toEqual([])
  })

  it('returns empty array when studentProfiles is empty/missing', () => {
    expect(getExamAbsentees({ batch: 'APJ_NDA_2Y_(26-28)', students: [] }, {})).toEqual([])
    expect(getExamAbsentees({ batch: 'APJ_NDA_2Y_(26-28)', students: [] }, null)).toEqual([])
  })

  it('returns each absentee once even if multiple batches both include them', () => {
    const dualBatchProfiles = {
      'Alice': { lwsId: 'LWS-001', name: 'Alice', batches: ['APJ_NDA_2Y_(26-28)', 'LWS_NDA_2Y_(26-28)_A'], parentMobiles: [], nameVariants: [] },
    }
    const exam = { batch: 'APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A', students: [] }
    const result = getExamAbsentees(exam, dualBatchProfiles)
    expect(result.map(r => r.name)).toEqual(['Alice'])
  })

  it('only includes canonical profiles (skips variant-keyed entries)', () => {
    // studentProfiles is keyed by both canonical name AND variants — only count canonical
    const dupedProfiles = {
      'Alice':  profiles['Alice'],
      'Alicia': profiles['Alice'], // variant entry pointing to same profile
    }
    const exam = { batch: 'APJ_NDA_2Y_(26-28)', students: [] }
    const result = getExamAbsentees(exam, dupedProfiles)
    expect(result.map(r => r.name)).toEqual(['Alice'])
  })
})
