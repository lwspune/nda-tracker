import { describe, it, expect } from 'vitest'
import { findKeyMismatches, applyKeyChoices } from '../answerKeyCheck'

describe('findKeyMismatches', () => {
  it('flags a question where both keys are valid but differ', () => {
    const tags = [{ q: 17, answer: 'C' }]
    const answerKeys = { 17: 'B' }
    expect(findKeyMismatches(tags, answerKeys)).toEqual([
      { q: 17, storedAnswer: 'C', resultsAnswer: 'B' },
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
      { q: 17, storedAnswer: 'C', resultsAnswer: 'B' },
      { q: 33, storedAnswer: 'A', resultsAnswer: 'D' },
    ])
  })

  it('returns [] for empty / missing inputs', () => {
    expect(findKeyMismatches([], {})).toEqual([])
    expect(findKeyMismatches(null, { 1: 'A' })).toEqual([])
    expect(findKeyMismatches([{ q: 1, answer: 'A' }], null)).toEqual([])
  })

  // The results re-upload path feeds this an exam's STORED questions rather than a
  // freshly parsed tags file. It only ever reads `.q` and `.answer`, which
  // `exams.questions[]` carries verbatim — so that path needs no second detector
  // and no adapter. This test pins that, because a field rename here would
  // silently make one of the two callers stop finding conflicts.
  it('accepts an exam\'s stored questions[] unchanged — extra fields are ignored', () => {
    const questions = [
      { q: 19, chapter: 'Atmosphere', subtopic: 'Clouds', answer: 'B',
        questionId: 'a3f1-…', solution: 'because', optionA: 'x', imageUrl: null },
      { q: 20, chapter: 'Atmosphere', answer: 'C', questionId: 'b7c2-…' },
    ]
    expect(findKeyMismatches(questions, { 19: 'A', 20: 'C' })).toEqual([
      { q: 19, storedAnswer: 'B', resultsAnswer: 'A' },
    ])
  })
})

// Resolving the conflicts is the same rule on both callers — the upload wizard and
// the results re-upload — so it lives here rather than being written twice. A
// second copy is how one path silently stops honouring a faculty decision.
describe('applyKeyChoices', () => {
  const QUESTIONS = [
    { q: 1, chapter: 'Algebra', answer: 'A' },
    { q: 2, chapter: 'Algebra', answer: 'B' },   // conflicts: results says D
    { q: 3, chapter: 'Trig',    answer: null },  // blank: results fills it
    { q: 4, chapter: 'Trig',    answer: 'C' },   // results has no key: untouched
  ]
  const ANSWER_KEYS = { 1: 'A', 2: 'D', 3: 'B' }
  const MISMATCHES = [{ q: 2, storedAnswer: 'B', resultsAnswer: 'D' }]

  it('defaults an unresolved conflict to the results key', () => {
    const out = applyKeyChoices(QUESTIONS, MISMATCHES, {}, ANSWER_KEYS)
    expect(out.find(q => q.q === 2).answer).toBe('D')
  })

  it('honours an explicit choice of the stored key', () => {
    const out = applyKeyChoices(QUESTIONS, MISMATCHES, { 2: 'stored' }, ANSWER_KEYS)
    expect(out.find(q => q.q === 2).answer).toBe('B')
  })

  it('fills a blank stored answer from the results key', () => {
    const out = applyKeyChoices(QUESTIONS, MISMATCHES, {}, ANSWER_KEYS)
    expect(out.find(q => q.q === 3).answer).toBe('B')
  })

  it('leaves a question the results file has no key for untouched', () => {
    const out = applyKeyChoices(QUESTIONS, MISMATCHES, {}, ANSWER_KEYS)
    expect(out.find(q => q.q === 4).answer).toBe('C')
  })

  it('preserves every other field on the question', () => {
    const rich = [{ q: 2, answer: 'B', chapter: 'Algebra', subtopic: 'Sets', questionId: 'x-1', solution: 's' }]
    const out = applyKeyChoices(rich, MISMATCHES, { 2: 'stored' }, ANSWER_KEYS)
    expect(out[0]).toEqual({ q: 2, answer: 'B', chapter: 'Algebra', subtopic: 'Sets', questionId: 'x-1', solution: 's' })
  })

  it('does not mutate the input array or its questions', () => {
    const input = [{ q: 2, answer: 'B' }]
    applyKeyChoices(input, MISMATCHES, {}, ANSWER_KEYS)
    expect(input[0].answer).toBe('B')
  })

  it('returns the input unchanged when there are no results keys at all', () => {
    const out = applyKeyChoices(QUESTIONS, [], {}, {})
    expect(out.map(q => q.answer)).toEqual(['A', 'B', null, 'C'])
  })

  it('returns [] for a missing questions array rather than throwing', () => {
    expect(applyKeyChoices(null, [], {}, {})).toEqual([])
  })
})
