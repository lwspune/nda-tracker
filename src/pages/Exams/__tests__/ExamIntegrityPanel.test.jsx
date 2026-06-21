// Smoke tests for ExamIntegrityPanel — the copying-detection panel on the Exams
// page. Detection logic itself is covered in lib/analytics/__tests__/examIntegrity.
// QuestionCard (used only inside the per-pair drill-down) reads the store, so we
// stub it; the panel's own render needs no store.

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({
    updateQuestion: vi.fn(),
    studentProfiles: {},
    logIntegrityIncident: vi.fn(async () => true),
    getIntegrityIncidentsForExam: vi.fn(async () => []),
  }),
}))

import ExamIntegrityPanel from '../ExamIntegrityPanel'

const KEY = 'A'
function student(name, rollNo, pattern, totalMarks = 0) {
  const choices = {}, responses = {}
  for (let i = 0; i < pattern.length; i++) {
    const q = String(i + 1), ch = pattern[i]
    if (ch === '-') { choices[q] = null; responses[q] = 0 }
    else { choices[q] = ch; responses[q] = ch === KEY ? 1 : -1 }
  }
  return { name, rollNo, totalMarks, choices, responses }
}
function questions(n) {
  return Array.from({ length: n }, (_, i) => ({ q: String(i + 1), chapter: 'C', answer: KEY }))
}
function makeExam(students, over = {}) {
  return { id: 'e1', name: 'Mock', date: '2026-06-14', questions: questions(20),
    marking: { correct: 4, wrong: -1 }, students, ...over }
}

describe('ExamIntegrityPanel', () => {
  it('shows the not-available notice for an offline exam', () => {
    render(<ExamIntegrityPanel exam={makeExam([student('A', '1', 'A'.repeat(20))], { questions: [] })} />)
    expect(screen.getByText(/offline exam/i)).toBeInTheDocument()
  })

  it('renders flagged pairs with the leads-not-proof disclaimer', () => {
    const exam = makeExam([
      student('Copy One', '00010', 'AA' + 'B'.repeat(18), 30),
      student('Copy Two', '00011', 'AA' + 'B'.repeat(18), 28),
    ])
    render(<ExamIntegrityPanel exam={exam} />)
    expect(screen.getByText(/investigative leads, not proof/i)).toBeInTheDocument()
    expect(screen.getByText(/Copy One/)).toBeInTheDocument()
    expect(screen.getByText(/Flagged pairs/)).toBeInTheDocument()
  })
})
