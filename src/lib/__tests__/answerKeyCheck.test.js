import { describe, it, expect } from 'vitest'
import { findKeyMismatches } from '../answerKeyCheck'

describe('findKeyMismatches', () => {
  it('flags a question where both keys are valid but differ', () => {
    const tags = [{ q: 17, answer: 'C' }]
    const answerKeys = { 17: 'B' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([
      { q: 17, tagsAnswer: 'C', resultsAnswer: 'B' },
    ])
  })

  it('returns none when the two keys agree', () => {
    const tags = [{ q: 1, answer: 'A' }, { q: 2, answer: 'D' }]
    const answerKeys = { 1: 'A', 2: 'D' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([])
  })

  it('ignores a question with a blank tags answer (silent fill, not a mismatch)', () => {
    const tags = [{ q: 5, answer: null }, { q: 6, answer: '' }]
    const answerKeys = { 5: 'B', 6: 'C' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([])
  })

  it('ignores a question with a missing results key (silent fill, not a mismatch)', () => {
    const tags = [{ q: 8, answer: 'A' }]
    const answerKeys = {}
    expect(findKeyMismatches(tags, answerKeys)).toEqual([])
  })

  it('ignores non-A-D letters on either side', () => {
    const tags = [{ q: 1, answer: 'E' }, { q: 2, answer: 'B' }]
    const answerKeys = { 1: 'A', 2: 'Z' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([])
  })

  it('normalizes case and surrounding whitespace before comparing', () => {
    const tags = [{ q: 1, answer: ' c ' }, { q: 2, answer: 'b' }]
    const answerKeys = { 1: 'C', 2: 'B' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([])
  })

  it('flags multiple mismatches in question order', () => {
    const tags = [{ q: 33, answer: 'A' }, { q: 17, answer: 'C' }, { q: 2, answer: 'D' }]
    const answerKeys = { 33: 'D', 17: 'B', 2: 'D' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([
      { q: 17, tagsAnswer: 'C', resultsAnswer: 'B' },
      { q: 33, tagsAnswer: 'A', resultsAnswer: 'D' },
    ])
  })

  it('returns [] for empty / missing inputs', () => {
    expect(findKeyMismatches([], {})).toEqual([])
    expect(findKeyMismatches(null, { 1: 'A' })).toEqual([])
    expect(findKeyMismatches([{ q: 1, answer: 'A' }], null)).toEqual([])
  })
})
