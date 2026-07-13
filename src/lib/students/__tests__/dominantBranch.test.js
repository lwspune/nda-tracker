import { describe, it, expect } from 'vitest'
import { dominantBranch } from '../dominantBranch'

describe('dominantBranch', () => {
  it('returns the branch when it holds ≥80% of branched students', () => {
    const students = [
      ...Array.from({ length: 9 }, () => ({ branch: 'LWS Pune' })),
      { branch: 'APJ' },
    ]
    expect(dominantBranch(students)).toBe('LWS Pune') // 9/10 = 90%
  })

  it('returns "" when the top branch is below the threshold', () => {
    const students = [
      ...Array.from({ length: 6 }, () => ({ branch: 'LWS Pune' })),
      ...Array.from({ length: 4 }, () => ({ branch: 'APJ' })),
    ]
    expect(dominantBranch(students)).toBe('') // 6/10 = 60% < 80%
  })

  it('returns the branch when 100% share it', () => {
    const students = Array.from({ length: 5 }, () => ({ branch: 'LWS Pune' }))
    expect(dominantBranch(students)).toBe('LWS Pune')
  })

  it('ignores students with a blank/absent branch in the denominator', () => {
    const students = [
      ...Array.from({ length: 8 }, () => ({ branch: 'LWS Pune' })),
      { branch: '' },
      { branch: '   ' },
      { branch: null },
      {},
    ]
    // 8 branched, all LWS Pune → 100% of branched → dominant
    expect(dominantBranch(students)).toBe('LWS Pune')
  })

  it('returns "" when no student has a branch', () => {
    const students = [{ branch: '' }, { branch: null }, {}]
    expect(dominantBranch(students)).toBe('')
  })

  it('returns "" for an empty list', () => {
    expect(dominantBranch([])).toBe('')
  })

  it('trims whitespace when comparing branch names', () => {
    const students = [
      { branch: 'LWS Pune ' },
      { branch: ' LWS Pune' },
      ...Array.from({ length: 8 }, () => ({ branch: 'LWS Pune' })),
    ]
    expect(dominantBranch(students)).toBe('LWS Pune')
  })

  it('respects a custom threshold', () => {
    const students = [
      ...Array.from({ length: 6 }, () => ({ branch: 'LWS Pune' })),
      ...Array.from({ length: 4 }, () => ({ branch: 'APJ' })),
    ]
    expect(dominantBranch(students, 0.5)).toBe('LWS Pune') // 60% ≥ 50%
  })
})
