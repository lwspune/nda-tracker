// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { buildExamRow, buildResultRows, migrateExams } from '../../migrate_exams_to_supabase.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_EXAM = {
  id: 'exam_1',
  name: 'NDA Test 1',
  date: '2025-06-01',
  subject: 'Maths',
  batch: 'LWS_NDA_2Y_(25-27)',
  branch: null,
  marking: { correct: 4, wrong: -1 },
  questions: [
    { q: 1, chapter: 'Algebra', subtopic: 'General', difficulty: 'Easy' },
    { q: 2, chapter: 'Trigonometry', subtopic: 'General', difficulty: 'Moderate' },
  ],
  students: [
    {
      name: 'Arjun Sharma',
      rollNo: 'R001',
      totalMarks: 80,
      correct: 20,
      incorrect: 5,
      notAttempted: 5,
      responses: { '1': 1, '2': -1 },
    },
    {
      name: 'Ravi Kumar',
      rollNo: '',
      totalMarks: 60,
      correct: 15,
      incorrect: 5,
      notAttempted: 10,
      responses: { '1': -1, '2': 1 },
    },
  ],
  createdAt: '2025-06-01T10:00:00.000Z',
}

// ── Mock Supabase client ──────────────────────────────────────────────────────

function makeMockClient({ examError = null, resultsError = null } = {}) {
  const examsUpsert = vi.fn().mockResolvedValue({ error: examError })
  const resultsUpsert = vi.fn().mockResolvedValue({ error: resultsError })
  return {
    from: vi.fn(table => {
      if (table === 'exams') return { upsert: examsUpsert }
      if (table === 'exam_results') return { upsert: resultsUpsert }
    }),
    _examsUpsert: examsUpsert,
    _resultsUpsert: resultsUpsert,
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
  it('maps each student to a result row', () => {
    const rows = buildResultRows(MOCK_EXAM)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      exam_id:       'exam_1',
      student_name:  'Arjun Sharma',
      roll_no:       'R001',
      total_marks:   80,
      correct:       20,
      incorrect:     5,
      not_attempted: 5,
      responses:     { '1': 1, '2': -1 },
    })
  })

  it('defaults roll_no to empty string when absent', () => {
    const rows = buildResultRows(MOCK_EXAM)
    expect(rows[1].roll_no).toBe('')
  })

  it('defaults numeric fields to 0 when absent', () => {
    const exam = {
      ...MOCK_EXAM,
      students: [{ name: 'X', responses: {} }],
    }
    const [row] = buildResultRows(exam)
    expect(row.total_marks).toBe(0)
    expect(row.correct).toBe(0)
    expect(row.incorrect).toBe(0)
    expect(row.not_attempted).toBe(0)
  })

  it('defaults responses to empty object when absent', () => {
    const exam = { ...MOCK_EXAM, students: [{ name: 'X' }] }
    const [row] = buildResultRows(exam)
    expect(row.responses).toEqual({})
  })

  it('returns empty array when students is empty', () => {
    expect(buildResultRows({ ...MOCK_EXAM, students: [] })).toEqual([])
  })

  it('returns empty array when students is absent', () => {
    expect(buildResultRows({ ...MOCK_EXAM, students: undefined })).toEqual([])
  })
})

// ── migrateExams ──────────────────────────────────────────────────────────────

describe('migrateExams', () => {
  it('upserts exam rows into exams table', async () => {
    const client = makeMockClient()
    await migrateExams(client, [MOCK_EXAM])
    expect(client._examsUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'exam_1', name: 'NDA Test 1' })],
      { onConflict: 'id' }
    )
  })

  it('upserts result rows into exam_results table', async () => {
    const client = makeMockClient()
    await migrateExams(client, [MOCK_EXAM])
    expect(client._resultsUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ exam_id: 'exam_1', student_name: 'Arjun Sharma' }),
        expect.objectContaining({ exam_id: 'exam_1', student_name: 'Ravi Kumar' }),
      ]),
      { onConflict: 'exam_id,student_name' }
    )
  })

  it('returns counts of migrated exams and results', async () => {
    const client = makeMockClient()
    const result = await migrateExams(client, [MOCK_EXAM])
    expect(result).toEqual({ exams: 1, results: 2 })
  })

  it('handles empty exams array without calling Supabase', async () => {
    const client = makeMockClient()
    const result = await migrateExams(client, [])
    expect(result).toEqual({ exams: 0, results: 0 })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('skips exam_results upsert for exams with no students', async () => {
    const client = makeMockClient()
    const result = await migrateExams(client, [{ ...MOCK_EXAM, students: [] }])
    expect(result).toEqual({ exams: 1, results: 0 })
    expect(client._resultsUpsert).not.toHaveBeenCalled()
  })

  it('migrates multiple exams and accumulates counts', async () => {
    const client = makeMockClient()
    const exam2 = { ...MOCK_EXAM, id: 'exam_2', name: 'NDA Test 2' }
    const result = await migrateExams(client, [MOCK_EXAM, exam2])
    expect(result.exams).toBe(2)
    expect(result.results).toBe(4)
  })

  it('throws when exams upsert fails', async () => {
    const client = makeMockClient({ examError: { message: 'DB error' } })
    await expect(migrateExams(client, [MOCK_EXAM])).rejects.toThrow('exams upsert failed')
  })

  it('throws when exam_results upsert fails', async () => {
    const client = makeMockClient({ resultsError: { message: 'results error' } })
    await expect(migrateExams(client, [MOCK_EXAM])).rejects.toThrow('exam_results upsert failed')
  })
})
