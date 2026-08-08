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

  // SUPERSEDED 2026-08-08 for GAT subjects. Letting the configured list decide
  // was right while it was the only knowledge we had of GAT chapters; it is
  // wrong now that gatTaxonomy.js carries the real one. The configured list had
  // accreted from past uploads into a junk drawer — 33 "Physics" chapters with
  // nine overlapping Optics variants — while lacking the chapters the tags files
  // actually use ("Light and Optics", "Electricity and Magnetism"). Step3Tags
  // renders chapter as a control bound to this list, so 95 of 150 correct
  // chapters in one mock read as untagged and were overwritten.
  //
  // Maths is unaffected: it keeps configured-then-seed precedence.

  it('prefers the taxonomy over the configured list for a GAT subject', () => {
    const chapters = getValidChapters('Physics', CONFIG)
    expect(chapters).toContain('Light and Optics')
    expect(chapters).toContain('Electricity and Magnetism')
    // the accreted near-duplicates no longer reach the picker
    expect(chapters).not.toContain('Optics')
    expect(chapters).not.toContain('Electrostatics')
  })

  it('uses the taxonomy even when nothing is configured', () => {
    expect(getValidChapters('Physics')).toContain('Light and Optics')
    expect(getValidChapters('English')).toContain('Cloze Test')
    expect(getValidChapters('Biology', CONFIG)).toContain('Microbiology and Disease')
  })

  it('prefers the configured list over the seed for Maths', () => {
    expect(getValidChapters('Maths', CONFIG)).toEqual(['Vectors'])
  })

  it('falls back to the Maths seed when no config is passed', () => {
    expect(getValidChapters('Maths')).toContain('Vectors')
    expect(getValidChapters('Maths').length).toBeGreaterThan(5)
  })

  it('never falls back to Maths for a subject with no taxonomy and no config', () => {
    // getFreqForSubject falls back to Maths for SCORING. Doing that here would
    // validate tags against Maths chapters and flag every one of them.
    expect(getValidChapters('Nonsense', CONFIG)).toEqual([])
  })

  it('tolerates a null/undefined config', () => {
    expect(getValidChapters('Physics', null)).toContain('Light and Optics')
    expect(getValidChapters('Nonsense', undefined)).toEqual([])
  })

  it('the chapters that were missing are now offered for every affected subject', () => {
    // One assertion per subject that lost data on 2026-08-08.
    expect(getValidChapters('Chemistry', CONFIG)).toContain('Acids, Bases and Salts')
    expect(getValidChapters('Geography', CONFIG)).toContain('Climatology, Atmosphere and Weather')
    expect(getValidChapters('Others', CONFIG)).toContain('Government Schemes, Policy and Governance')
  })
})

describe('validateTags — GAT subjects validate against the taxonomy', () => {
  // "Optics" and "Ray Optics" were the fixtures here while the configured list
  // was authoritative. Both are exactly the accreted near-duplicates the
  // taxonomy replaced, so the fixtures move to the real chapter name.
  const CONFIG = { Physics: [{ chapter: 'Optics', pct: 5 }] }

  it('flags a chapter that is not in the taxonomy', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Ray Optics' }]
    const { valid, issues } = validateTags(tags, 'Physics', CONFIG)
    expect(valid).toBe(false)
    expect(issues[0]).toMatchObject({ q: 1, chapter: 'Ray Optics', type: 'unrecognised' })
  })

  it('suggests the taxonomy chapter for a near-miss spelling', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Light and Optic' }]
    const { issues } = validateTags(tags, 'Physics', CONFIG)
    expect(issues[0].suggestion).toBe('Light and Optics')
  })

  it('offers no suggestion when nothing is genuinely close', () => {
    // "Ray Optics" is a different chapter name, not a typo of one. Suggesting
    // a distant match is how a wrong chapter gets accepted in one click.
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Ray Optics' }]
    const { issues } = validateTags(tags, 'Physics', CONFIG)
    expect(issues[0].suggestion).toBeNull()
  })

  it('accepts a chapter that matches the taxonomy, case-insensitively', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'light and optics' }]
    expect(validateTags(tags, 'Physics', CONFIG).valid).toBe(true)
  })

  it('accepts the real tags-file chapters that used to be flagged', () => {
    // Verbatim from Tags_NDA_GAT_Mock_W2.xlsx — these read as "needs tagging"
    // before the taxonomy landed.
    const tags = [
      { q: 1, subject: 'English', chapter: 'Cloze Test' },
      { q: 2, subject: 'Chemistry', chapter: 'Acids, Bases and Salts' },
      { q: 3, subject: 'Biology', chapter: 'Microbiology and Disease' },
      { q: 4, subject: 'Geography', chapter: 'Climatology, Atmosphere and Weather' },
    ]
    expect(validateTags(tags, 'GAT', CONFIG)).toMatchObject({ valid: true })
  })

  it('still skips validation for a subject with neither taxonomy nor config', () => {
    const tags = [{ q: 1, subject: 'Nonsense', chapter: 'Anything At All' }]
    expect(validateTags(tags, 'Nonsense', CONFIG).valid).toBe(true)
  })

  it('validates from the taxonomy even when no config is passed', () => {
    const tags = [{ q: 1, subject: 'Physics', chapter: 'Ray Optics' }]
    expect(validateTags(tags, 'Physics').valid).toBe(false)
  })
})

describe('normaliseChapter — configured ndaFreqBySubject', () => {
  const CONFIG = { Physics: [{ chapter: 'Optics', pct: 5 }] }

  it('normalises case using the taxonomy list', async () => {
    const { normaliseChapter } = await import('../validateTags')
    expect(normaliseChapter('light and optics', 'Physics', CONFIG)).toBe('Light and Optics')
  })

  it('returns the input unchanged when the subject has no list', async () => {
    const { normaliseChapter } = await import('../validateTags')
    expect(normaliseChapter('Whatever', 'History', CONFIG)).toBe('Whatever')
  })
})
