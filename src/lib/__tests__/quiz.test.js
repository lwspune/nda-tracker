import { describe, it, expect } from 'vitest'
import {
  LETTERS,
  blankQuestion,
  quizQuestionComplete,
  quizStatus,
  validateQuizForPublish,
  gradeQuizAttempt,
  stripAnswerKey,
} from '../quiz'

describe('blankQuestion', () => {
  it('creates an empty question shell with the given number', () => {
    const q = blankQuestion(3)
    expect(q.q).toBe(3)
    expect(q.question).toBe('')
    expect(q.optionA).toBe('')
    expect(q.optionD).toBe('')
    expect(q.answer).toBe('')
    expect(q.chapter).toBe('')
  })
})

describe('quizQuestionComplete', () => {
  const full = {
    q: 1, question: 'What is 2+2?',
    optionA: '3', optionB: '4', optionC: '5', optionD: '6',
    answer: 'B',
  }

  it('accepts a fully-filled question', () => {
    expect(quizQuestionComplete(full)).toBe(true)
  })

  it('accepts a lowercase answer letter', () => {
    expect(quizQuestionComplete({ ...full, answer: 'b' })).toBe(true)
  })

  it('rejects missing question text', () => {
    expect(quizQuestionComplete({ ...full, question: '   ' })).toBe(false)
  })

  it('rejects a missing option', () => {
    expect(quizQuestionComplete({ ...full, optionC: '' })).toBe(false)
  })

  it('rejects an answer that is not A-D', () => {
    expect(quizQuestionComplete({ ...full, answer: 'E' })).toBe(false)
    expect(quizQuestionComplete({ ...full, answer: '' })).toBe(false)
  })

  it('rejects null/undefined', () => {
    expect(quizQuestionComplete(null)).toBe(false)
    expect(quizQuestionComplete(undefined)).toBe(false)
  })
})

describe('quizStatus', () => {
  const now = 1_000_000

  it('returns draft when not published', () => {
    expect(quizStatus({ status: 'draft', closesAt: null }, now)).toBe('draft')
  })

  it('returns open when published and before close time', () => {
    expect(quizStatus({ status: 'published', closesAt: new Date(now + 60_000).toISOString() }, now)).toBe('open')
  })

  it('returns closed when published and at/after close time', () => {
    expect(quizStatus({ status: 'published', closesAt: new Date(now - 1).toISOString() }, now)).toBe('closed')
  })

  it('returns open when published with no close time', () => {
    expect(quizStatus({ status: 'published', closesAt: null }, now)).toBe('open')
  })
})

describe('validateQuizForPublish', () => {
  const now = 1_000_000
  const goodQ = { q: 1, question: 'Q?', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', answer: 'A' }
  const base = { title: 'Daily 1', questions: [goodQ], closesAt: new Date(now + 60_000).toISOString() }

  it('passes a valid quiz', () => {
    expect(validateQuizForPublish(base, now)).toEqual({ ok: true })
  })

  it('requires a title', () => {
    expect(validateQuizForPublish({ ...base, title: '  ' }, now)).toEqual({ ok: false, reason: 'title_required' })
  })

  it('requires at least one complete question', () => {
    const incomplete = { ...goodQ, answer: '' }
    expect(validateQuizForPublish({ ...base, questions: [incomplete] }, now)).toEqual({ ok: false, reason: 'no_complete_questions' })
  })

  it('requires a close time', () => {
    expect(validateQuizForPublish({ ...base, closesAt: null }, now)).toEqual({ ok: false, reason: 'close_time_required' })
  })

  it('rejects a close time in the past', () => {
    expect(validateQuizForPublish({ ...base, closesAt: new Date(now - 1).toISOString() }, now)).toEqual({ ok: false, reason: 'close_time_past' })
  })
})

describe('gradeQuizAttempt', () => {
  const questions = [
    { q: 1, answer: 'A' },
    { q: 2, answer: 'B' },
    { q: 3, answer: 'C' },
  ]

  it('grades correct/incorrect/skipped with default +1/0 marking', () => {
    const r = gradeQuizAttempt(questions, { 1: 'A', 2: 'D' }, { correct: 1, wrong: 0 })
    expect(r.correct).toBe(1)
    expect(r.incorrect).toBe(1)
    expect(r.notAttempted).toBe(1)
    expect(r.score).toBe(1)
    expect(r.responses).toEqual({ 1: 1, 2: -1, 3: 0 })
  })

  it('applies negative marking', () => {
    const r = gradeQuizAttempt(questions, { 1: 'A', 2: 'A', 3: 'A' }, { correct: 4, wrong: -1 })
    // 1 correct (+4), 2 wrong (-1 each) => 4 - 2 = 2
    expect(r.score).toBe(2)
    expect(r.correct).toBe(1)
    expect(r.incorrect).toBe(2)
  })

  it('is case-insensitive on the chosen letter', () => {
    const r = gradeQuizAttempt(questions, { 1: 'a' }, { correct: 1, wrong: 0 })
    expect(r.correct).toBe(1)
  })

  it('treats all-unanswered as zero score, all not-attempted', () => {
    const r = gradeQuizAttempt(questions, {}, { correct: 1, wrong: 0 })
    expect(r.notAttempted).toBe(3)
    expect(r.score).toBe(0)
  })

  it('falls back to +1/0 when marking is missing', () => {
    const r = gradeQuizAttempt(questions, { 1: 'A' })
    expect(r.score).toBe(1)
  })
})

describe('stripAnswerKey', () => {
  it('removes answer and solution but keeps the rest', () => {
    const qs = [{ q: 1, question: 'Q?', optionA: 'a', answer: 'A', solution: 'because' }]
    const stripped = stripAnswerKey(qs)
    expect(stripped[0]).not.toHaveProperty('answer')
    expect(stripped[0]).not.toHaveProperty('solution')
    expect(stripped[0].question).toBe('Q?')
    expect(stripped[0].optionA).toBe('a')
  })

  it('returns [] for empty input', () => {
    expect(stripAnswerKey(null)).toEqual([])
  })
})

describe('LETTERS', () => {
  it('is A-D', () => {
    expect(LETTERS).toEqual(['A', 'B', 'C', 'D'])
  })
})
