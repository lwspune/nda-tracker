import { describe, it, expect } from 'vitest'
import {
  NDA_GAT_TAXONOMY,
  AMBIGUOUS_SUBTOPICS,
  getTaxonomyChapters,
  getTaxonomySubtopics,
  getChaptersForSubtopic,
  findChapterForSubtopic,
  hasTaxonomy,
} from '../gatTaxonomy'
import { NDA_FREQ_BY_SUBJECT } from '../ndaFreq'

describe('NDA_GAT_TAXONOMY shape', () => {
  it('covers every GAT subject the exams actually use', () => {
    for (const s of ['English', 'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Polity', 'Others'])
      expect(hasTaxonomy(s), s).toBe(true)
  })

  it('does NOT cover Maths — ndaSubtopics.js owns that level', () => {
    expect(hasTaxonomy('Maths')).toBe(false)
    expect(hasTaxonomy('Mathematics')).toBe(false)
  })

  it('every chapter has at least one subtopic', () => {
    for (const [subject, chapters] of Object.entries(NDA_GAT_TAXONOMY))
      for (const [chapter, subs] of Object.entries(chapters))
        expect(subs.length, `${subject} / ${chapter}`).toBeGreaterThan(0)
  })

  it('the only subtopics under two chapters are the known, declared ones', () => {
    // Not a uniqueness assertion — a containment one. Assuming uniqueness is
    // exactly what misfiled W09 Q49 in the 2026-08-08 repair. A regeneration
    // that introduces a new ambiguity must fail here and be declared.
    const found = {}
    for (const [subject, chapters] of Object.entries(NDA_GAT_TAXONOMY)) {
      const where = new Map()
      for (const [chapter, subs] of Object.entries(chapters))
        for (const s of subs) {
          const k = s.toLowerCase()
          if (!where.has(k)) where.set(k, [])
          where.get(k).push(chapter)
        }
      const dupes = [...where.entries()].filter(([, chs]) => chs.length > 1).map(([k]) => k)
      if (dupes.length) found[subject] = dupes.sort()
    }
    const declared = Object.fromEntries(
      Object.entries(AMBIGUOUS_SUBTOPICS).map(([s, list]) => [s, list.map(x => x.toLowerCase()).sort()])
    )
    expect(found).toEqual(declared)
  })
})

describe('the chapters that were missing from the picker', () => {
  // Each of these is a real parent chapter from the 2026-08-08 repair. None was
  // in ndaFreqBySubject, which is why correct tags rendered blank and got
  // overwritten. Pinning them stops a regeneration from quietly dropping one.
  const REQUIRED = {
    Physics: ['Electricity and Magnetism', 'Light and Optics', 'Kinematics and Motion', 'Units, Measurement and Dimensions'],
    Chemistry: ['Acids, Bases and Salts', 'Chemical Bonding', 'Industrial and Applied Chemistry', 'Atomic Structure and Periodic Classification'],
    Biology: ['Microbiology and Disease', 'Human Physiology', 'Reproduction'],
    Geography: ['Climatology, Atmosphere and Weather', "Earth's Structure, Landforms and Geological Time", 'World and Human Geography'],
    English: ['Cloze Test', 'Fill in the Blanks'],
    Others: ['Government Schemes, Policy and Governance', 'International Affairs and Relations'],
  }

  for (const [subject, chapters] of Object.entries(REQUIRED))
    it(`${subject} carries its real chapters`, () => {
      const have = getTaxonomyChapters(subject)
      for (const c of chapters) expect(have, c).toContain(c)
    })
})

describe('findChapterForSubtopic', () => {
  // The exact pairings that were wrong in the database before the repair.
  it.each([
    ['Physics', 'Electrostatics', 'Electricity and Magnetism'],
    ['Physics', 'Combination of Resistors', 'Electricity and Magnetism'],
    ['Physics', 'Prisms and Dispersion', 'Light and Optics'],
    ['Physics', 'Lenses and Lens Formula', 'Light and Optics'],
    ['English', 'Word Selection in Passage', 'Cloze Test'],
  ])('%s / %s -> %s', (subject, subtopic, chapter) => {
    expect(findChapterForSubtopic(subject, subtopic)).toBe(chapter)
  })

  it('matches case-insensitively and ignores surrounding space', () => {
    expect(findChapterForSubtopic('Physics', '  electrostatics ')).toBe('Electricity and Magnetism')
  })

  it('returns null for an unknown subtopic rather than guessing', () => {
    expect(findChapterForSubtopic('Physics', 'Not A Real Subtopic')).toBeNull()
    expect(findChapterForSubtopic('Physics', '')).toBeNull()
    expect(findChapterForSubtopic('Nonsense', 'Electrostatics')).toBeNull()
  })
})

describe('getTaxonomySubtopics', () => {
  it('returns the subtopics under a chapter', () => {
    expect(getTaxonomySubtopics('English', 'Cloze Test')).toContain('Word Selection in Passage')
  })

  it('returns [] for unknown subject or chapter — never undefined', () => {
    expect(getTaxonomySubtopics('Physics', 'No Such Chapter')).toEqual([])
    expect(getTaxonomySubtopics('Nonsense', 'Whatever')).toEqual([])
  })

  it('every unambiguous subtopic resolves back to its own chapter', () => {
    for (const [subject, chapters] of Object.entries(NDA_GAT_TAXONOMY))
      for (const [chapter, subs] of Object.entries(chapters))
        for (const s of subs) {
          if (getChaptersForSubtopic(subject, s).length > 1) continue
          expect(findChapterForSubtopic(subject, s), `${subject}/${s}`).toBe(chapter)
        }
  })
})

describe('ambiguous subtopics refuse to guess', () => {
  it('findChapterForSubtopic returns null when a subtopic has two parents', () => {
    // The exact defect: W09 Q49 "The committee _____ in their opinions" is a
    // fill-in-the-blank filed under Grammar, and was moved to Spotting Errors
    // because both chapters carry Subject-Verb Agreement.
    expect(getChaptersForSubtopic('English', 'Subject-Verb Agreement').sort())
      .toEqual(['Grammar', 'Spotting Errors'])
    expect(findChapterForSubtopic('English', 'Subject-Verb Agreement')).toBeNull()
  })

  it.each([
    ['English', 'Correct Sentence Identification'],
    ['Chemistry', 'Physical vs Chemical Changes'],
  ])('%s / %s is ambiguous and returns null', (subject, subtopic) => {
    expect(getChaptersForSubtopic(subject, subtopic).length).toBe(2)
    expect(findChapterForSubtopic(subject, subtopic)).toBeNull()
  })

  it('every declared ambiguous subtopic really is ambiguous', () => {
    for (const [subject, list] of Object.entries(AMBIGUOUS_SUBTOPICS))
      for (const s of list)
        expect(getChaptersForSubtopic(subject, s).length, `${subject}/${s}`).toBeGreaterThan(1)
  })
})

describe('relationship to NDA_FREQ_BY_SUBJECT', () => {
  it('fills the gap: GAT subjects are empty in the freq seed', () => {
    for (const s of ['Physics', 'Chemistry', 'Biology', 'Geography', 'English'])
      expect(NDA_FREQ_BY_SUBJECT[s], s).toEqual([])
  })
})
