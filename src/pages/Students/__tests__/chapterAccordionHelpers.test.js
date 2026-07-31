import { describe, it, expect } from 'vitest'
import { getSubtopicQuestions } from '../chapterAccordionHelpers'

describe('getSubtopicQuestions — chosen-option capture', () => {
  const exams = [{
    id: 'e1', name: 'T1', date: '2026-06-01',
    questions: [
      { q: 1, chapter: 'Algebra', subtopic: 'Quadratics' },
      { q: 2, chapter: 'Algebra', subtopic: 'Quadratics' },
      { q: 3, chapter: 'Algebra', subtopic: 'Other' },        // different subtopic → ignored
    ],
    students: [{ name: 'Alice', responses: { 1: -1, 2: 0 }, choices: { 1: 'B', 2: null } }],
  }]

  it('attaches the chosen option to a wrong item', () => {
    const { wrong } = getSubtopicQuestions('Algebra', 'Quadratics', 'Alice', exams)
    expect(wrong).toHaveLength(1)
    expect(wrong[0]).toMatchObject({ studentResult: -1, studentAnswer: 'B' })
  })

  it('skipped items carry a null chosen option', () => {
    const { skipped } = getSubtopicQuestions('Algebra', 'Quadratics', 'Alice', exams)
    expect(skipped[0]).toMatchObject({ studentResult: 0, studentAnswer: null })
  })

  it('studentAnswer is null when the exam predates choice capture', () => {
    const old = [{ ...exams[0], students: [{ name: 'Alice', responses: { 1: -1 } }] }]
    const { wrong } = getSubtopicQuestions('Algebra', 'Quadratics', 'Alice', old)
    expect(wrong[0].studentAnswer).toBeNull()
  })
})

describe('getSubtopicQuestions — correct bucket', () => {
  // Correct answers were previously discarded. They are kept now so the
  // opportunity card can show "N Right" alongside wrong and skipped.
  const exams = [{
    id: 'e1', name: 'T1', date: '2026-06-01',
    questions: [
      { q: 1, chapter: 'Algebra', subtopic: 'Quadratics' },
      { q: 2, chapter: 'Algebra', subtopic: 'Quadratics' },
      { q: 3, chapter: 'Algebra', subtopic: 'Quadratics' },
      { q: 4, chapter: 'Algebra', subtopic: 'Other' },        // different subtopic → ignored
    ],
    students: [{
      name: 'Alice',
      responses: { 1: 1, 2: -1, 3: 0, 4: 1 },
      choices:   { 1: 'A', 2: 'B', 3: null, 4: 'C' },
    }],
  }]

  it('returns the correct answers with their chosen option', () => {
    const { correct } = getSubtopicQuestions('Algebra', 'Quadratics', 'Alice', exams)
    expect(correct).toHaveLength(1)
    expect(correct[0]).toMatchObject({ studentResult: 1, studentAnswer: 'A', examName: 'T1' })
  })

  it('keeps the three buckets disjoint', () => {
    const { correct, wrong, skipped } = getSubtopicQuestions('Algebra', 'Quadratics', 'Alice', exams)
    expect([correct.length, wrong.length, skipped.length]).toEqual([1, 1, 1])
    const qs = [...correct, ...wrong, ...skipped].map(i => i.qObj.q)
    expect(new Set(qs).size).toBe(qs.length)
  })

  it('still honours the subtopic filter', () => {
    const { correct } = getSubtopicQuestions('Algebra', 'Quadratics', 'Alice', exams)
    expect(correct.map(i => i.qObj.q)).not.toContain(4)
  })

  it('returns an empty bucket for a student who sat nothing in the subtopic', () => {
    const { correct, wrong, skipped } = getSubtopicQuestions('Algebra', 'Quadratics', 'Nobody', exams)
    expect([correct, wrong, skipped]).toEqual([[], [], []])
  })
})
