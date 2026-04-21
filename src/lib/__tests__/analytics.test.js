/**
 * analytics.test.js
 *
 * Tests for the registration-date and valid-student helpers added to analytics.js:
 *   filterValidExams(studentExams, regDate)
 *   getValidStudentNames(exams, studentProfiles)
 *
 * All tests are pure — no React, no store.
 */

import { describe, it, expect } from 'vitest'
import { filterValidExams, getValidStudentNames } from '../analytics'

// ── Fixture helpers ───────────────────────────────────────────

function makeExam(id, date, students = []) {
  return {
    id,
    name: `Exam ${id}`,
    date,
    subject: 'Maths',
    batch: null,
    branch: null,
    marking: { correct: 4, wrong: -1 },
    questions: [],
    students,
  }
}

function makeStudentExam(examId, date, studentName = 'Alice') {
  const exam = makeExam(examId, date, [{ name: studentName, totalMarks: 100, responses: {} }])
  const student = exam.students[0]
  return { exam, student }
}

function makeProfile(name, regDate, opts = {}) {
  return {
    lwsId:        opts.lwsId || 'LWS-001',
    name,
    regDate:      regDate || '',
    accountStatus: opts.accountStatus || 'Active',
    nameVariants: opts.nameVariants || [],
    batches: [],
    branch: '',
    mobile: '',
  }
}

// ── filterValidExams ──────────────────────────────────────────

describe('filterValidExams', () => {
  it('returns all exams when regDate is null', () => {
    const entries = [
      makeStudentExam('e1', '2024-01-01'),
      makeStudentExam('e2', '2024-06-01'),
    ]
    expect(filterValidExams(entries, null)).toHaveLength(2)
  })

  it('returns all exams when regDate is empty string', () => {
    const entries = [
      makeStudentExam('e1', '2024-01-01'),
      makeStudentExam('e2', '2024-06-01'),
    ]
    expect(filterValidExams(entries, '')).toHaveLength(2)
  })

  it('includes exam on the exact registration date', () => {
    const entries = [
      makeStudentExam('e1', '2024-03-01'),
      makeStudentExam('e2', '2024-06-15'),
    ]
    const result = filterValidExams(entries, '2024-03-01')
    expect(result).toHaveLength(2)
    expect(result.map(r => r.exam.id)).toEqual(['e1', 'e2'])
  })

  it('excludes exams before registration date', () => {
    const entries = [
      makeStudentExam('e1', '2024-01-10'),  // before reg
      makeStudentExam('e2', '2024-03-01'),  // on reg date
      makeStudentExam('e3', '2024-05-20'),  // after reg
    ]
    const result = filterValidExams(entries, '2024-03-01')
    expect(result).toHaveLength(2)
    expect(result.map(r => r.exam.id)).toEqual(['e2', 'e3'])
  })

  it('returns empty array when all exams are before registration date', () => {
    const entries = [
      makeStudentExam('e1', '2023-01-01'),
      makeStudentExam('e2', '2023-06-01'),
    ]
    expect(filterValidExams(entries, '2024-01-01')).toHaveLength(0)
  })

  it('returns empty array unchanged for empty input', () => {
    expect(filterValidExams([], '2024-01-01')).toHaveLength(0)
  })
})

// ── getValidStudentNames ──────────────────────────────────────

describe('getValidStudentNames', () => {
  it('returns empty Set when studentProfiles is empty', () => {
    const exams = [makeExam('e1', '2024-01-01', [{ name: 'Alice', responses: {} }])]
    expect(getValidStudentNames(exams, {})).toEqual(new Set())
  })

  it('includes names whose matched profile has a regDate', () => {
    const exams = [
      makeExam('e1', '2024-01-01', [
        { name: 'Alice', responses: {} },
        { name: 'Bob',   responses: {} },
      ]),
    ]
    const profiles = {
      Alice: makeProfile('Alice', '2024-01-01'),
      Bob:   makeProfile('Bob',   '2023-09-01'),
    }
    const result = getValidStudentNames(exams, profiles)
    expect(result.has('Alice')).toBe(true)
    expect(result.has('Bob')).toBe(true)
  })

  it('excludes names whose profile has no regDate', () => {
    const exams = [
      makeExam('e1', '2024-01-01', [
        { name: 'Alice', responses: {} },
        { name: 'Bob',   responses: {} },
      ]),
    ]
    const profiles = {
      Alice: makeProfile('Alice', '2024-01-01'),
      Bob:   makeProfile('Bob',   null),           // no regDate
    }
    const result = getValidStudentNames(exams, profiles)
    expect(result.has('Alice')).toBe(true)
    expect(result.has('Bob')).toBe(false)
  })

  it('excludes names with no matching profile at all', () => {
    const exams = [
      makeExam('e1', '2024-01-01', [
        { name: 'Alice',   responses: {} },
        { name: 'Unknown', responses: {} },  // not in profiles
      ]),
    ]
    const profiles = {
      Alice: makeProfile('Alice', '2024-01-01'),
    }
    const result = getValidStudentNames(exams, profiles)
    expect(result.has('Alice')).toBe(true)
    expect(result.has('Unknown')).toBe(false)
  })

  it('matches via nameVariants (case-insensitive)', () => {
    const exams = [
      makeExam('e1', '2024-01-01', [
        { name: 'Alicia Singh', responses: {} },   // variant of Alice Singh
      ]),
    ]
    const profiles = {
      'Alice Singh': makeProfile('Alice Singh', '2024-01-01', {
        nameVariants: ['Alicia Singh'],
      }),
    }
    const result = getValidStudentNames(exams, profiles)
    expect(result.has('Alicia Singh')).toBe(true)
  })

  it('matches case-insensitively against canonical name', () => {
    const exams = [
      makeExam('e1', '2024-01-01', [
        { name: 'alice', responses: {} },  // lower-case in exam data
      ]),
    ]
    const profiles = {
      Alice: makeProfile('Alice', '2024-01-01'),
    }
    const result = getValidStudentNames(exams, profiles)
    expect(result.has('alice')).toBe(true)
  })

  it('handles multiple exams without duplicating work', () => {
    const exams = [
      makeExam('e1', '2024-01-01', [{ name: 'Alice', responses: {} }]),
      makeExam('e2', '2024-03-01', [{ name: 'Alice', responses: {} }]),
      makeExam('e3', '2024-06-01', [{ name: 'Bob',   responses: {} }]),
    ]
    const profiles = {
      Alice: makeProfile('Alice', '2024-01-01'),
      Bob:   makeProfile('Bob',   ''),  // no regDate
    }
    const result = getValidStudentNames(exams, profiles)
    expect(result.size).toBe(1)
    expect(result.has('Alice')).toBe(true)
  })
})
