import { describe, it, expect } from 'vitest'
import { validateTags, validateGatSubjects, getValidChapters } from '../validateTags'

// ── validateGatSubjects ────────────────────────────────────────

describe('validateGatSubjects', () => {
  it('passes when all tags have a subject', () => {
    const tags = [
      { q: 1, subject: 'English', chapter: 'Error Spotting' },
      { q: 2, subject: 'Physics', chapter: 'Mechanics' },
      { q: 3, subject: 'Geography', chapter: 'Physical Geography' },
    ]
    const { valid, missingQs } = validateGatSubjects(tags)
    expect(valid).toBe(true)
    expect(missingQs).toEqual([])
  })

  it('fails when a tag has null subject', () => {
    const tags = [
      { q: 1, subject: 'English', chapter: 'Error Spotting' },
      { q: 2, subject: null, chapter: 'Mechanics' },
      { q: 3, subject: 'Geography', chapter: 'Physical Geography' },
    ]
    const { valid, missingQs } = validateGatSubjects(tags)
    expect(valid).toBe(false)
    expect(missingQs).toEqual([2])
  })

  it('fails when a tag has empty-string subject', () => {
    const tags = [
      { q: 5, subject: '', chapter: 'Algebra' },
      { q: 6, subject: 'Physics', chapter: 'Mechanics' },
    ]
    const { valid, missingQs } = validateGatSubjects(tags)
    expect(valid).toBe(false)
    expect(missingQs).toEqual([5])
  })

  it('fails when a tag has whitespace-only subject', () => {
    const tags = [{ q: 10, subject: '   ', chapter: 'Algebra' }]
    const { valid, missingQs } = validateGatSubjects(tags)
    expect(valid).toBe(false)
    expect(missingQs).toEqual([10])
  })

  it('collects all missing question numbers', () => {
    const tags = [
      { q: 1, subject: null, chapter: 'A' },
      { q: 2, subject: 'English', chapter: 'B' },
      { q: 3, subject: null, chapter: 'C' },
      { q: 4, subject: null, chapter: 'D' },
    ]
    const { valid, missingQs } = validateGatSubjects(tags)
    expect(valid).toBe(false)
    expect(missingQs).toEqual([1, 3, 4])
  })

  it('passes for an empty tags array', () => {
    const { valid, missingQs } = validateGatSubjects([])
    expect(valid).toBe(true)
    expect(missingQs).toEqual([])
  })
})

// ── validateTags (existing behaviour — regression) ─────────────

describe('validateTags', () => {
  it('accepts tags whose chapter matches the valid list', () => {
    const validChapter = getValidChapters('Maths')[0]
    const tags = [{ q: 1, subject: null, chapter: validChapter }]
    const { valid } = validateTags(tags, 'Maths')
    expect(valid).toBe(true)
  })

  it('flags unrecognised chapter name', () => {
    const tags = [{ q: 1, subject: null, chapter: 'Totally Unknown Chapter' }]
    const { valid, issues } = validateTags(tags, 'Maths')
    expect(valid).toBe(false)
    expect(issues[0].type).toBe('unrecognised')
  })

  it('skips validation for subjects with no freq data (e.g. GAT)', () => {
    const tags = [{ q: 1, subject: 'GAT', chapter: 'Anything Goes' }]
    const { valid } = validateTags(tags, 'GAT')
    expect(valid).toBe(true)
  })

  it('uses tag.subject over defaultSubject when present', () => {
    const validMathsChapter = getValidChapters('Maths')[0]
    const tags = [{ q: 1, subject: 'Maths', chapter: validMathsChapter }]
    // defaultSubject is wrong, but tag.subject overrides it
    const { valid } = validateTags(tags, 'English')
    expect(valid).toBe(true)
  })
})
