import { describe, it, expect } from 'vitest'
import { detectSubjectFromName } from '../excel'

// Regression: "NDA Maths Mock 2" was being saved with subject = "2"
// because the old logic stripped subject keywords and kept the leftover.
// detectSubjectFromName must detect the subject by *presence*, not by stripping.

describe('detectSubjectFromName', () => {
  it('returns Maths when the name contains "Maths"', () => {
    expect(detectSubjectFromName('NDA Maths Mock 2')).toBe('Maths')
    expect(detectSubjectFromName('Maths Test 3')).toBe('Maths')
    expect(detectSubjectFromName('NDA Maths Mock 5')).toBe('Maths')
  })

  it('returns Maths when the name contains "Math" (singular)', () => {
    expect(detectSubjectFromName('NDA Math Quiz')).toBe('Maths')
  })

  it('returns GAT when the name contains "GAT"', () => {
    expect(detectSubjectFromName('GAT Mock 1')).toBe('GAT')
    expect(detectSubjectFromName('NDA GAT 2')).toBe('GAT')
    expect(detectSubjectFromName('gat combined mock')).toBe('GAT')
  })

  it('does not match "math" inside an unrelated word', () => {
    // Defensive: "format" contains "mat" but not "\bmath\b"
    expect(detectSubjectFromName('Format Test 1')).toBe('Maths')  // falls through to default
  })

  it('defaults to Maths when no subject keyword is present', () => {
    expect(detectSubjectFromName('Random Exam')).toBe('Maths')
    expect(detectSubjectFromName('')).toBe('Maths')
    expect(detectSubjectFromName(undefined)).toBe('Maths')
    expect(detectSubjectFromName(null)).toBe('Maths')
  })

  it('regression — "NDA Maths Mock 2" must never resolve to "2"', () => {
    expect(detectSubjectFromName('NDA Maths Mock 2')).not.toBe('2')
    expect(detectSubjectFromName('NDA Maths Mock 5')).not.toBe('5')
  })
})
