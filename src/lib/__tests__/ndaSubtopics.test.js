import { describe, it, expect } from 'vitest'
import { NDA_SUBTOPIC_SHARES, getSubtopicShares } from '../ndaSubtopics'
import { NDA_FREQ_BY_SUBJECT } from '../ndaFreq'

// The shares table is generated from PYQ Vault (the content master) and joined to
// the chapter weightage table BY NAME. These tests pin the two properties that
// make that join safe; a regeneration that breaks either is a silent scoring bug.

describe('NDA_SUBTOPIC_SHARES — integrity', () => {
  it("every chapter's shares sum to 100", () => {
    Object.entries(NDA_SUBTOPIC_SHARES).forEach(([chapter, subs]) => {
      const sum = subs.reduce((s, r) => s + r.share, 0)
      expect(Math.abs(sum - 100), `${chapter} sums to ${sum}`).toBeLessThan(0.05)
    })
  })

  it('every chapter key exists in the Maths weightage table', () => {
    // marksAtStake is derived as chapterPct × share, so a chapter here that the
    // freq table does not carry contributes rows worth nothing.
    const freqChapters = new Set(NDA_FREQ_BY_SUBJECT.Maths.map(r => r.chapter))
    const orphans = Object.keys(NDA_SUBTOPIC_SHARES).filter(c => !freqChapters.has(c))
    expect(orphans).toEqual([])
  })

  it('subtopic names are globally unique — a row identifies itself without its chapter', () => {
    const seen = new Map()
    Object.entries(NDA_SUBTOPIC_SHARES).forEach(([chapter, subs]) => {
      subs.forEach(({ subtopic }) => {
        expect(seen.has(subtopic), `${subtopic} in both ${seen.get(subtopic)} and ${chapter}`).toBe(false)
        seen.set(subtopic, chapter)
      })
    })
  })

  it('carries a positive share and a sane pctHard for every row', () => {
    Object.values(NDA_SUBTOPIC_SHARES).flat().forEach(r => {
      expect(r.share).toBeGreaterThan(0)
      expect(r.qCount).toBeGreaterThan(0)
      expect(r.pctHard).toBeGreaterThanOrEqual(0)
      expect(r.pctHard).toBeLessThanOrEqual(100)
    })
  })
})

describe('getSubtopicShares', () => {
  it('returns the chapter rows', () => {
    expect(getSubtopicShares('Statistics').map(r => r.subtopic))
      .toContain('Measures of Central Tendency — Mean, Median, Mode')
  })

  it('returns [] for an unknown chapter rather than throwing', () => {
    expect(getSubtopicShares('Not A Chapter')).toEqual([])
    expect(getSubtopicShares(undefined)).toEqual([])
  })
})
