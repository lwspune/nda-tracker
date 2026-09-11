// Tests for the pure hydration core — merging PYQ Vault question content into
// an exam's stored questions[]. The rules here ARE the invariant: the stored
// copy is the record of what the student actually sat, so hydration fills gaps
// and REPORTS conflicts, it never silently rewrites a past paper.

import { describe, it, expect } from 'vitest'
import { hydrateQuestions, HYDRATABLE_FIELDS } from '../bankHydrate'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

function stored(over = {}) {
  return {
    q: 1, questionId: ID1, chapter: 'Vectors', subtopic: 'Dot Product',
    question: 'find a.b', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd',
    answer: 'B', solution: 'because', difficulty: 'Moderate', context: null,
    ...over,
  }
}

function bank(over = {}) {
  return {
    questionId: ID1, chapter: 'Vectors', subtopic: 'Dot Product',
    question: 'find a.b', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd',
    answer: 'B', solution: 'because', difficulty: 'Moderate', context: null,
    imageUrl: 'https://bank/img.png', solutionImageUrl: null,
    optionImages: { A: null, B: null, C: null, D: null },
    ...over,
  }
}

describe('hydrateQuestions — filling gaps', () => {
  it('fills a field the stored question does not have', () => {
    const out = hydrateQuestions([stored()], { [ID1]: bank() })
    expect(out.questions[0].imageUrl).toBe('https://bank/img.png')
    expect(out.filled).toContainEqual({ q: 1, field: 'imageUrl' })
  })

  it('treats an empty string as absent, not as a value to protect', () => {
    const out = hydrateQuestions([stored({ solution: '' })], { [ID1]: bank({ solution: 'real soln' }) })
    expect(out.questions[0].solution).toBe('real soln')
  })

  it('does not report a fill when the bank has nothing to give', () => {
    const out = hydrateQuestions([stored({ solution: null })], { [ID1]: bank({ solution: null }) })
    expect(out.questions[0].solution).toBeNull()
    expect(out.filled.map(f => f.field)).not.toContain('solution')
    expect(out.differs).toEqual([])
  })
})

describe('hydrateQuestions — an empty container is not a find', () => {
  // Found in the wild 2026-09-11: a 120-question mock reported "236 fields to
  // fill" when the bank held ZERO images for it. 118 x optionImages (an object
  // of four nulls) + 118 x format ('mcq' for every MCQ ever). A count that
  // large reads as "we found a lot"; it was pure noise.
  it('does not count optionImages when the bank has no option images', () => {
    const out = hydrateQuestions([stored()], {
      [ID1]: bank({ optionImages: { A: null, B: null, C: null, D: null } }),
    })
    expect(out.filled.map(f => f.field)).not.toContain('optionImages')
    expect(out.questions[0].optionImages).toBeUndefined()
  })

  it('DOES fill optionImages when at least one option has an image', () => {
    const images = { A: null, B: 'https://bank/b.png', C: null, D: null }
    const out = hydrateQuestions([stored()], { [ID1]: bank({ optionImages: images }) })
    expect(out.filled.map(f => f.field)).toContain('optionImages')
    expect(out.questions[0].optionImages).toEqual(images)
  })

  it('does not hydrate format or numericAnswer — nothing here reads them', () => {
    const out = hydrateQuestions([stored()], {
      [ID1]: bank({ format: 'mcq', numericAnswer: 3.5 }),
    })
    expect(out.questions[0].format).toBeUndefined()
    expect(out.questions[0].numericAnswer).toBeUndefined()
    expect(HYDRATABLE_FIELDS).not.toContain('format')
  })

  it('reports nothing to fill when the bank adds no content', () => {
    const out = hydrateQuestions([stored()], {
      [ID1]: bank({
        imageUrl: null,                                    // the real 2026-09-11 case:
        solutionImageUrl: null,                            // a mock with no diagrams
        optionImages: { A: null, B: null, C: null, D: null },
        format: 'mcq',
      }),
    })
    expect(out.filled).toEqual([])
  })
})

describe('hydrateQuestions — protecting what the student sat', () => {
  it('REPORTS a differing stem instead of overwriting it', () => {
    const out = hydrateQuestions([stored()], { [ID1]: bank({ question: 'REPAIRED STEM' }) })
    expect(out.questions[0].question).toBe('find a.b')   // unchanged
    expect(out.differs).toContainEqual({
      q: 1, field: 'question', stored: 'find a.b', bank: 'REPAIRED STEM',
    })
  })

  it('reports a corrected answer key rather than re-keying the paper', () => {
    const out = hydrateQuestions([stored()], { [ID1]: bank({ answer: 'C' }) })
    expect(out.questions[0].answer).toBe('B')
    expect(out.differs.map(d => d.field)).toContain('answer')
  })

  it('never touches q or questionId', () => {
    const out = hydrateQuestions([stored()], { [ID1]: bank({ q: 99, questionId: ID2 }) })
    expect(out.questions[0].q).toBe(1)
    expect(out.questions[0].questionId).toBe(ID1)
  })

  it('ignores fields outside the allow-list — the bank cannot inject keys', () => {
    const out = hydrateQuestions([stored()], { [ID1]: bank({ evil: 'x', org_id: 'y' }) })
    expect(out.questions[0].evil).toBeUndefined()
    expect(out.questions[0].org_id).toBeUndefined()
    expect(HYDRATABLE_FIELDS).not.toContain('org_id')
  })

  it('does not mutate the input', () => {
    const input = [stored()]
    hydrateQuestions(input, { [ID1]: bank() })
    expect(input[0].imageUrl).toBeUndefined()
  })
})

describe('hydrateQuestions — what it cannot resolve', () => {
  it('leaves a question with no bank id completely untouched', () => {
    const q = stored({ questionId: null })
    const out = hydrateQuestions([q], { [ID1]: bank() })
    expect(out.questions[0]).toEqual(q)
    expect(out.unlinked).toBe(1)
  })

  it('reports an id the bank did not return — a repaired question mints a new uuid', () => {
    const out = hydrateQuestions([stored({ questionId: ID2 })], { [ID1]: bank() })
    expect(out.missing).toEqual([ID2])
    expect(out.questions[0].question).toBe('find a.b')
  })

  it('handles an empty exam and an empty bank response', () => {
    expect(hydrateQuestions([], {})).toEqual({
      questions: [], filled: [], differs: [], missing: [], unlinked: 0,
    })
    const out = hydrateQuestions([stored()], {})
    expect(out.missing).toEqual([ID1])
  })
})
