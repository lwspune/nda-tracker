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
