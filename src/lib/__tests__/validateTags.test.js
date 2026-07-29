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

// ── Configured freq table drives validation ────────────────────
// getValidChapters previously read only the hardcoded NDA_FREQ_BY_SUBJECT
// seed, where every subject except Maths is []. Faculty configure weightage
// through Settings, which writes faculty_state.data.ndaFreqBySubject — a
// different source validation never read. Result: chapter-name validation was
// silently OFF for every GAT subject, and 23% of tagged questions drifted to
// names that score 0 in computeProjectedScore.

describe('getValidChapters — configured ndaFreqBySubject', () => {
  const CONFIG = {
    Maths:   [{ chapter: 'Vectors', pct: 4.5 }],
    Physics: [{ chapter: 'Optics', pct: 5 }, { chapter: 'Electrostatics', pct: 4 }],
    Biology: [],
  }

  it('uses the configured chapter list for a subject the seed leaves empty', () => {
    expect(getValidChapters('Physics', CONFIG)).toEqual(['Optics', 'Electrostatics'])
  })

  it('prefers the configured list over the seed', () => {
    expect(getValidChapters('Maths', CONFIG)).toEqual(['Vectors'])
  })

  it('falls back to the seed when no config is passed', () => {
    expect(getValidChapters('Maths')).toContain('Vectors')
    expect(getValidChapters('Maths').length).toBeGreaterThan(5)
    expect(getValidChapters('Physics')).toEqual([])
  })

  it('falls back to the seed when the configured list is empty', () => {
    expect(getValidChapters('Biology', CONFIG)).toEqual([])
  })

  it('never falls back to Maths for an unconfigured subject', () => {
    // getFreqForSubject falls back to Maths for SCORING. Doing that here would
    // validate Physics tags against Maths chapters and flag every one of them.
    expect(getValidChapters('History', CONFIG)).toEqual([])
  })

  it('tolerates a null/undefined config', () => {
    expect(getValidChapters('Physics', null)).toEqual([])
    expect(getValidChapters('Physics', undefined)).toEqual([])
  })
})

describe('validateTags — configured ndaFreqBySubject', () => {
  const CONFIG = { Physics: [{ chapter: 'Optics', pct: 5 }] }

  it('flags an unrecognised chapter for a subject only the config knows', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Ray Optics' }]
    const { valid, issues } = validateTags(tags, 'Physics', CONFIG)
    expect(valid).toBe(false)
    expect(issues[0]).toMatchObject({ q: 1, chapter: 'Ray Optics', type: 'unrecognised' })
  })

  it('suggests the configured chapter as the closest match', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Ray Optics' }]
    const { issues } = validateTags(tags, 'Physics', CONFIG)
    expect(issues[0].suggestion).toBe('Optics')
  })

  it('accepts a chapter that matches the configured list', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'optics' }]
    expect(validateTags(tags, 'Physics', CONFIG).valid).toBe(true)
  })

  it('still skips validation for a subject with neither seed nor config', () => {
    const tags = [{ q: 1, subject: 'History', chapter: 'Anything At All' }]
    expect(validateTags(tags, 'History', CONFIG).valid).toBe(true)
  })

  it('is unchanged when no config is passed (regression)', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Ray Optics' }]
    expect(validateTags(tags, 'Physics').valid).toBe(true)
  })
})

describe('normaliseChapter — configured ndaFreqBySubject', () => {
  const CONFIG = { Physics: [{ chapter: 'Optics', pct: 5 }] }

  it('normalises case using the configured list', async () => {
    const { normaliseChapter } = await import('../validateTags')
    expect(normaliseChapter('optics', 'Physics', CONFIG)).toBe('Optics')
  })

  it('returns the input unchanged when the subject has no list', async () => {
    const { normaliseChapter } = await import('../validateTags')
    expect(normaliseChapter('Whatever', 'History', CONFIG)).toBe('Whatever')
  })
})
