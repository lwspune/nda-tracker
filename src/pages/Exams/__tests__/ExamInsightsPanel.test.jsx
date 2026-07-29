// The insights panel serves two exam formats from one place.
//
// MCQ exams keep the three-tab view (students / questions / toppers). Written
// exams have no per-question data at all, so two of those tabs would be empty
// shells — they get a single view built from what a hand-graded paper actually
// records: every mark, the shape of the class, and who didn't sit it.

import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import ExamInsightsPanel from '../ExamInsightsPanel'

const PROFILES = {
  Alice: { lwsId: 'L1', name: 'Alice', batches: ['B1'], accountStatus: 'Active', regDate: '2026-01-01' },
  Bob:   { lwsId: 'L2', name: 'Bob',   batches: ['B1'], accountStatus: 'Active', regDate: '2026-01-01' },
  Carol: { lwsId: 'L3', name: 'Carol', batches: ['B1'], accountStatus: 'Active', regDate: '2026-01-01' },
}

function writtenExam(overrides = {}) {
  return {
    id: 'wq_1',
    name: 'Sets',
    date: '2026-07-27',
    subject: 'Maths',
    batch: 'B1',
    marking: { correct: 1, wrong: 0 },
    questions: [],
    maxMarks: 20,
    students: [
      { name: 'Alice', totalMarks: 18, responses: {} },
      { name: 'Bob',   totalMarks: 8,  responses: {} },
    ],
    ...overrides,
  }
}

function mcqExam() {
  return {
    id: 'e1',
    name: 'Mock 1',
    date: '2026-07-25',
    subject: 'Maths',
    batch: 'B1',
    marking: { correct: 4, wrong: -1 },
    questions: [{ q: 1, chapter: 'Sets', subtopic: 'Venn', answer: 'A' }],
    students: [{ name: 'Alice', totalMarks: 4, responses: { 1: 1 } }],
  }
}

const renderPanel = (exam, profiles = PROFILES) =>
  render(<ExamInsightsPanel exam={exam} studentProfiles={profiles} />)

describe('ExamInsightsPanel — written exams', () => {
  it('drops the tab bar — there is only one view to show', () => {
    renderPanel(writtenExam())
    expect(screen.queryByRole('button', { name: /^questions$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^toppers$/i })).not.toBeInTheDocument()
  })

  it('lists every student, not just the top and bottom five', () => {
    const exam = writtenExam({
      students: Array.from({ length: 13 }, (_, i) => ({
        name: `Student ${i + 1}`, totalMarks: i + 1, responses: {},
      })),
    })
    renderPanel(exam, {})
    const table = screen.getByRole('table', { name: /all students/i })
    expect(within(table).getAllByRole('row')).toHaveLength(14)  // 13 + header
  })

  it('ranks students by mark, highest first', () => {
    renderPanel(writtenExam())
    const rows = within(screen.getByRole('table', { name: /all students/i })).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Alice')
    expect(rows[2]).toHaveTextContent('Bob')
  })

  it('shows each mark against the paper ceiling, never bare', () => {
    renderPanel(writtenExam())
    const rows = within(screen.getByRole('table', { name: /all students/i })).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('18 / 20')
    expect(rows[1]).toHaveTextContent('90%')
  })

  it('reports the median and the spread', () => {
    renderPanel(writtenExam())
    expect(screen.getByText(/median/i)).toBeInTheDocument()
    expect(screen.getByTestId('written-median')).toHaveTextContent('13')
  })

  it('buckets the class into the same bands the score colours use', () => {
    renderPanel(writtenExam())
    expect(screen.getByTestId('band-strong')).toHaveTextContent('1')  // Alice 90%
    expect(screen.getByTestId('band-weak')).toHaveTextContent('1')    // Bob 40%
  })

  it('names the rostered students who have no mark', () => {
    renderPanel(writtenExam())
    const absent = screen.getByTestId('written-absentees')
    expect(within(absent).getByText(/carol/i)).toBeInTheDocument()
    expect(within(absent).queryByText(/alice/i)).not.toBeInTheDocument()
  })

  it('says so plainly when the whole batch sat the exam', () => {
    const exam = writtenExam({
      students: [
        { name: 'Alice', totalMarks: 18, responses: {} },
        { name: 'Bob',   totalMarks: 8,  responses: {} },
        { name: 'Carol', totalMarks: 12, responses: {} },
      ],
    })
    renderPanel(exam)
    expect(screen.getByTestId('written-absentees')).toHaveTextContent(/everyone/i)
  })

  it('offers no per-question analysis, since none exists', () => {
    renderPanel(writtenExam())
    expect(screen.queryByText(/wrong questions/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unattempted questions/i)).not.toBeInTheDocument()
  })
})

describe('ExamInsightsPanel — MCQ exams keep their tabs', () => {
  it('still shows the three-tab view', () => {
    renderPanel(mcqExam())
    expect(screen.getByRole('button', { name: /^students$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^questions$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^toppers$/i })).toBeInTheDocument()
  })

  it('does not render the written all-students table', () => {
    renderPanel(mcqExam())
    expect(screen.queryByRole('table', { name: /all students/i })).not.toBeInTheDocument()
  })
})
