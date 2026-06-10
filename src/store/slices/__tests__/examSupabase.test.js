import { describe, it, expect, vi } from 'vitest'
import {
  buildExamRow,
  buildResultRows,
  upsertExam,
  deleteExamById,
  updateExamQuestions,
} from '../examSupabase'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_EXAM = {
  id:        'exam_1',
  name:      'NDA Test 1',
  date:      '2025-06-01',
  subject:   'Maths',
  batch:     'LWS_NDA_2Y_(25-27)',
  branch:    null,
  marking:   { correct: 4, wrong: -1 },
  questions: [{ q: 1, chapter: 'Algebra', subtopic: 'General' }],
  students: [
    { name: 'Arjun Sharma', rollNo: 'R001', totalMarks: 80, correct: 20, incorrect: 5, notAttempted: 5, responses: { '1': 1 } },
    { name: 'Ravi Kumar',   rollNo: '',     totalMarks: 60, correct: 15, incorrect: 5, notAttempted: 10, responses: { '1': -1 } },
  ],
  createdAt: '2025-06-01T10:00:00.000Z',
}

// ── Mock Supabase client ──────────────────────────────────────────────────────

function makeMockClient({
  examErr       = null,  // exams.upsert error
  examDeleteErr = null,  // exams.delete error (deleteExamById)
  deleteErr     = null,  // exam_results.delete error (upsertExam)
  insertErr     = null,
  updateErr     = null,
} = {}) {
  const upsertMock     = vi.fn().mockResolvedValue({ error: examErr })
  const examDeleteEq   = vi.fn().mockResolvedValue({ error: examDeleteErr })
  const examDeleteMock = vi.fn().mockReturnValue({ eq: examDeleteEq })
  const deleteEq       = vi.fn().mockResolvedValue({ error: deleteErr })
  const deleteMock     = vi.fn().mockReturnValue({ eq: deleteEq })
  const insertMock     = vi.fn().mockResolvedValue({ error: insertErr })
  const updateEq       = vi.fn().mockResolvedValue({ error: updateErr })
  const updateMock     = vi.fn().mockReturnValue({ eq: updateEq })

  return {
    from: vi.fn(table => {
      if (table === 'exams')        return { upsert: upsertMock, update: updateMock, delete: examDeleteMock }
      if (table === 'exam_results') return { delete: deleteMock, insert: insertMock }
    }),
    _upsertMock:     upsertMock,
    _examDeleteMock: examDeleteMock,
    _examDeleteEq:   examDeleteEq,
    _deleteEq:       deleteEq,
    _deleteMock:     deleteMock,
    _insertMock:     insertMock,
    _updateMock:     updateMock,
    _updateEq:       updateEq,
  }
}

// ── buildExamRow ──────────────────────────────────────────────────────────────

describe('buildExamRow', () => {
  it('maps exam fields to table columns', () => {
    const row = buildExamRow(MOCK_EXAM)
    expect(row.id).toBe('exam_1')
    expect(row.name).toBe('NDA Test 1')
    expect(row.date).toBe('2025-06-01')
    expect(row.subject).toBe('Maths')
    expect(row.batch).toBe('LWS_NDA_2Y_(25-27)')
    expect(row.branch).toBeNull()
    expect(row.marking).toEqual({ correct: 4, wrong: -1 })
    expect(row.questions).toEqual(MOCK_EXAM.questions)
    expect(row.created_at).toBe('2025-06-01T10:00:00.000Z')
  })

  it('maps maxMarks → max_marks (null for MCQ exams, set for offline)', () => {
    expect(buildExamRow(MOCK_EXAM).max_marks).toBeNull()
    const offline = buildExamRow({ ...MOCK_EXAM, questions: [], maxMarks: 100 })
    expect(offline.max_marks).toBe(100)
  })

  it('coerces empty batch and undefined branch to null', () => {
    const row = buildExamRow({ ...MOCK_EXAM, batch: '', branch: undefined })
    expect(row.batch).toBeNull()
    expect(row.branch).toBeNull()
  })

  it('defaults marking to 4/-1 when absent', () => {
    const row = buildExamRow({ ...MOCK_EXAM, marking: undefined })
    expect(row.marking).toEqual({ correct: 4, wrong: -1 })
  })

  it('defaults questions to empty array when absent', () => {
    const row = buildExamRow({ ...MOCK_EXAM, questions: undefined })
    expect(row.questions).toEqual([])
  })

  it('does not include students field', () => {
    const row = buildExamRow(MOCK_EXAM)
    expect(row).not.toHaveProperty('students')
  })
})

// ── buildResultRows ───────────────────────────────────────────────────────────

describe('buildResultRows', () => {
  it('maps each student to a result row (null cohort snapshot without profiles)', () => {
    const rows = buildResultRows(MOCK_EXAM)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      exam_id:        'exam_1',
      student_name:   'Arjun Sharma',
      roll_no:        'R001',
      total_marks:    80,
      correct:        20,
      incorrect:      5,
      not_attempted:  5,
      responses:      { '1': 1 },
      choices:        {},
      batch_at_exam:  null,
      branch_at_exam: null,
    })
  })

  it('persists the captured choices map (and defaults to {} when absent)', () => {
    const exam = { ...MOCK_EXAM, students: [
      { name: 'A', responses: { '1': 1, '2': -1 }, choices: { '1': 'C', '2': 'A', '3': null } },
      { name: 'B', responses: {} },   // no choices captured (older upload)
    ] }
    const rows = buildResultRows(exam)
    expect(rows[0].choices).toEqual({ '1': 'C', '2': 'A', '3': null })
    expect(rows[1].choices).toEqual({})
  })

  it('snapshots current batch/branch from studentProfiles (canonical + variant; null when unmatched)', () => {
    const profiles = {
      'Arjun Sharma': { name: 'Arjun Sharma', branch: 'LWS Pune', batches: ['LWS_NDA_2Y_(25-27)_A', 'LWS_NDA_2Y_(25-27)_B'], nameVariants: ['Arjun S'] },
      'Arjun S':      { name: 'Arjun Sharma', branch: 'LWS Pune', batches: ['LWS_NDA_2Y_(25-27)_A', 'LWS_NDA_2Y_(25-27)_B'], nameVariants: ['Arjun S'] },
      // Ravi Kumar has no profile → null snapshot
    }
    const rows = buildResultRows(MOCK_EXAM, profiles)
    expect(rows[0].batch_at_exam).toBe('LWS_NDA_2Y_(25-27)_A, LWS_NDA_2Y_(25-27)_B')
    expect(rows[0].branch_at_exam).toBe('LWS Pune')
    expect(rows[1].batch_at_exam).toBeNull()   // Ravi: no profile
    expect(rows[1].branch_at_exam).toBeNull()

    // resolves a variant spelling to the same profile
    const variantExam = { ...MOCK_EXAM, students: [{ name: 'Arjun S', responses: {} }] }
    expect(buildResultRows(variantExam, profiles)[0].branch_at_exam).toBe('LWS Pune')
  })

  it('defaults roll_no to empty string when absent', () => {
    expect(buildResultRows(MOCK_EXAM)[1].roll_no).toBe('')
  })

  it('defaults numeric fields to 0 when absent', () => {
    const [row] = buildResultRows({ ...MOCK_EXAM, students: [{ name: 'X', responses: {} }] })
    expect(row.total_marks).toBe(0)
    expect(row.correct).toBe(0)
    expect(row.incorrect).toBe(0)
    expect(row.not_attempted).toBe(0)
  })

  it('returns empty array when students is absent', () => {
    expect(buildResultRows({ ...MOCK_EXAM, students: undefined })).toEqual([])
  })
})

// ── upsertExam ────────────────────────────────────────────────────────────────

describe('upsertExam', () => {
  it('upserts the exam row to the exams table', async () => {
    const client = makeMockClient()
    await upsertExam(client, MOCK_EXAM)
    expect(client._upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exam_1', name: 'NDA Test 1' }),
      { onConflict: 'id' }
    )
  })

  it('deletes existing results then inserts new ones', async () => {
    const client = makeMockClient()
    await upsertExam(client, MOCK_EXAM)
    expect(client._deleteEq).toHaveBeenCalledWith('exam_id', 'exam_1')
    expect(client._insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ exam_id: 'exam_1', student_name: 'Arjun Sharma' }),
        expect.objectContaining({ exam_id: 'exam_1', student_name: 'Ravi Kumar' }),
      ])
    )
  })

  it('skips insert when exam has no students', async () => {
    const client = makeMockClient()
    await upsertExam(client, { ...MOCK_EXAM, students: [] })
    expect(client._deleteEq).toHaveBeenCalled()
    expect(client._insertMock).not.toHaveBeenCalled()
  })

  it('throws when exam upsert fails', async () => {
    const client = makeMockClient({ examErr: { message: 'conflict' } })
    await expect(upsertExam(client, MOCK_EXAM)).rejects.toThrow('exams upsert failed')
  })

  it('throws when results delete fails', async () => {
    const client = makeMockClient({ deleteErr: { message: 'constraint' } })
    await expect(upsertExam(client, MOCK_EXAM)).rejects.toThrow('exam_results delete failed')
  })

  it('throws when results insert fails', async () => {
    const client = makeMockClient({ insertErr: { message: 'duplicate' } })
    await expect(upsertExam(client, MOCK_EXAM)).rejects.toThrow('exam_results insert failed')
  })
})

// ── deleteExamById ────────────────────────────────────────────────────────────

describe('deleteExamById', () => {
  it('deletes the exam row by id (cascade removes results)', async () => {
    const client = makeMockClient()
    await deleteExamById(client, 'exam_1')
    expect(client._examDeleteEq).toHaveBeenCalledWith('id', 'exam_1')
  })

  it('throws when delete fails', async () => {
    const client = makeMockClient({ examDeleteErr: { message: 'not found' } })
    await expect(deleteExamById(client, 'exam_1')).rejects.toThrow('exams delete failed')
  })
})

// ── updateExamQuestions ───────────────────────────────────────────────────────

describe('updateExamQuestions', () => {
  const QUESTIONS = [{ q: 1, chapter: 'Algebra', subtopic: 'Updated' }]

  it('updates the questions column on the exam row', async () => {
    const client = makeMockClient()
    await updateExamQuestions(client, 'exam_1', QUESTIONS)
    expect(client._updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ questions: QUESTIONS })
    )
    expect(client._updateEq).toHaveBeenCalledWith('id', 'exam_1')
  })

  it('throws when update fails', async () => {
    const client = makeMockClient({ updateErr: { message: 'timeout' } })
    await expect(updateExamQuestions(client, 'exam_1', QUESTIONS)).rejects.toThrow('exam questions update failed')
  })
})
