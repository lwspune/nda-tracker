// Tests for WhatsAppPreviewModal — the pre-send review table for the exam-result
// WhatsApp flow. The "Score (as sent)" column exists to be a cross-check: it must
// render the exact values api/send-whatsapp.js will put in the template, which is
// only true while both call src/lib/whatsappResultScore.
//
// Regression: an offline exam's rows carry 0 in correct/incorrect/notAttempted
// (marks live in totalMarks). Scoring off the counters sent 13 families
// "Score: 0%, Correct Qs: 0, Total Qs: 0" with no surface that would have shown
// it before pressing send (2026-07-28).

import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { examScoreBasis, resultScore } from '../../../lib/whatsappResultScore'

let mockStudentProfiles = {}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({ studentProfiles: mockStudentProfiles }),
}))

import WhatsAppPreviewModal from '../WhatsAppPreviewModal'

const OFFLINE_EXAM = {
  id: 'exam_offline', name: 'Sets',
  questions: [], marking: { correct: 1, wrong: 0 }, maxMarks: 5,
  students: [
    { name: 'Satyam Pune',  totalMarks: 4, correct: 0, incorrect: 0, notAttempted: 0 },
    { name: 'Unnati Takalkar', totalMarks: 0, correct: 0, incorrect: 0, notAttempted: 0 },
  ],
}

const MCQ_EXAM = {
  id: 'exam_mcq', name: 'NDA Test 1',
  questions: Array.from({ length: 30 }, (_, i) => ({ q: i + 1 })),
  marking: { correct: 1, wrong: 0 }, maxMarks: null,
  students: [
    { name: 'Arjun Sharma', totalMarks: 20, correct: 20, incorrect: 5, notAttempted: 5 },
  ],
}

function renderModal(exam, over = {}) {
  return render(
    <WhatsAppPreviewModal
      exam={exam}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      sending={false}
      failedNames={null}
      {...over}
    />
  )
}

const rowFor = name => screen.getByText(name).closest('tr')

beforeEach(() => {
  vi.clearAllMocks()
  mockStudentProfiles = {
    'Satyam Pune':      { lwsId: 'LWS-186', branch: 'APJ', mobile: '9373573740', parentMobiles: [] },
    'Unnati Takalkar':  { lwsId: 'LWS-187', branch: 'APJ', mobile: '9000000002', parentMobiles: [] },
    'Arjun Sharma':     { lwsId: 'LWS-001', branch: 'LWS', mobile: '9876543210', parentMobiles: [] },
  }
})

describe('WhatsAppPreviewModal — Score (as sent) column', () => {
  it('renders the score column header', () => {
    renderModal(OFFLINE_EXAM)
    expect(screen.getByText('Score (as sent)')).toBeInTheDocument()
  })

  it('shows marks-based score for an offline exam, not the 0/0 from the counters', () => {
    renderModal(OFFLINE_EXAM)
    const row = rowFor('Satyam Pune')
    expect(within(row).getByText('80%')).toBeInTheDocument()
    expect(within(row).getByText('4 / 5')).toBeInTheDocument()
    expect(within(row).queryByText('0 / 0')).not.toBeInTheDocument()
  })

  it('shows a genuine zero as 0% out of the paper max', () => {
    renderModal(OFFLINE_EXAM)
    const row = rowFor('Unnati Takalkar')
    expect(within(row).getByText('0%')).toBeInTheDocument()
    expect(within(row).getByText('0 / 5')).toBeInTheDocument()
  })

  it('shows counter-based score for an MCQ exam', () => {
    renderModal(MCQ_EXAM)
    const row = rowFor('Arjun Sharma')
    expect(within(row).getByText('67%')).toBeInTheDocument()
    expect(within(row).getByText('20 / 30')).toBeInTheDocument()
  })

  // The point of the column: what it shows and what the endpoint sends are the
  // same computation. If this drifts, the preview silently vouches for a number
  // the parent never receives.
  it.each([
    ['offline', OFFLINE_EXAM],
    ['MCQ',     MCQ_EXAM],
  ])('matches resultScore (the endpoint formula) for every %s row', (_label, exam) => {
    renderModal(exam)
    const basis = examScoreBasis(exam)
    for (const student of exam.students) {
      const { pct, scored, outOf } = resultScore(basis, student)
      const row = rowFor(student.name)
      expect(within(row).getByText(`${pct}%`)).toBeInTheDocument()
      expect(within(row).getByText(`${scored} / ${outOf}`)).toBeInTheDocument()
    }
  })

  it('leaves the editable contact fields intact alongside the new column', () => {
    renderModal(OFFLINE_EXAM)
    const row = rowFor('Satyam Pune')
    expect(within(row).getByDisplayValue('9373573740')).toBeInTheDocument()
  })
})
