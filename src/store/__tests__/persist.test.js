import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../lib/supabase'
import { loadFromSupabase, loadExamsFromSupabase, saveToSupabase, saveToStorage } from '../persist'

describe('loadFromSupabase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the data column from faculty_state row', async () => {
    const mockData = { exams: [], studentProfiles: {} }
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { data: mockData }, error: null }),
        }),
      }),
    })
    expect(await loadFromSupabase()).toEqual(mockData)
  })

  it('returns null on query error', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })
    expect(await loadFromSupabase()).toBeNull()
  })

  it('returns null when data column is null (fresh install)', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { data: null }, error: null }),
        }),
      }),
    })
    expect(await loadFromSupabase()).toBeNull()
  })
})

describe('saveToSupabase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls update when faculty session is active', async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    supabase.from.mockReturnValue({ update: mockUpdate })
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'faculty-id' } } },
    })

    saveToSupabase({ exams: [], studentProfiles: {} })
    await new Promise(r => setTimeout(r, 0))

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('id', 1)
  })

  it('strips exams from the JSONB blob before saving to faculty_state', async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    supabase.from.mockReturnValue({ update: mockUpdate })
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'faculty-id' } } },
    })

    saveToSupabase({ exams: [{ id: 'exam1' }], quizzes: [{ id: 'q1' }], studentProfiles: { Alice: {} } })
    await new Promise(r => setTimeout(r, 0))

    const savedData = mockUpdate.mock.calls[0][0].data
    expect(savedData).not.toHaveProperty('exams')
    expect(savedData).not.toHaveProperty('quizzes')
    expect(savedData).toHaveProperty('studentProfiles')
  })

  it('skips update when no session (teacher/student mode)', async () => {
    const mockUpdate = vi.fn()
    supabase.from.mockReturnValue({ update: mockUpdate })
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })

    saveToSupabase({ exams: [] })
    await new Promise(r => setTimeout(r, 0))

    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// ── saveToStorage allow-list ─────────────────────────────────────────────────
// In the jsdom test env the hostname is `localhost`, so IS_DEV is true and
// saveToStorage POSTs the data object to /api/data. We stub fetch and inspect
// the serialized body to assert which store keys survive the allow-list.
describe('saveToStorage allow-list (dev path)', () => {
  beforeEach(() => vi.clearAllMocks())

  function captureSavedPayload(state) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    saveToStorage(state)
    const body = fetchMock.mock.calls[0][1].body
    vi.unstubAllGlobals()
    return JSON.parse(body)
  }

  it('persists send-history keys and branches (regression: silently stripped before 2026-06-01)', () => {
    const state = {
      exams: [], quizzes: [{ id: 'q1', title: 'Daily 1' }], studentProfiles: {},
      whatsappSendHistory: { exam1: { sentAt: 'x' } },
      examAbsenceSendHistory: { exam1: { sentAt: 'y' } },
      lateSendHistory: { '2026-06-01': { sentAt: 'z', sent: 5, skipped: 0, failedNames: [] } },
      lectureMissSendHistory: { '2026-06-01|LWS_NDA_2Y_(26-28)': { sentAt: 'w', sent: 3 } },
      homeworkSendHistory: { '2026-06-04|LWS_NDA_2Y_(26-28)': { sentAt: 'h', sent: 2 } },
      branches: ['APJ', 'LWS Pune'],
      monitorMobiles: ['9021869427'],
    }
    const saved = captureSavedPayload(state)
    expect(saved.quizzes).toEqual(state.quizzes) // dev disk persists quizzes; prod strips them (own table)
    expect(saved.lateSendHistory).toEqual(state.lateSendHistory)
    expect(saved.lectureMissSendHistory).toEqual(state.lectureMissSendHistory)
    expect(saved.homeworkSendHistory).toEqual(state.homeworkSendHistory)
    expect(saved.branches).toEqual(state.branches)
    expect(saved.monitorMobiles).toEqual(state.monitorMobiles)
    // existing keys still round-trip
    expect(saved.whatsappSendHistory).toEqual(state.whatsappSendHistory)
    expect(saved.examAbsenceSendHistory).toEqual(state.examAbsenceSendHistory)
  })
})

// ── loadExamsFromSupabase ─────────────────────────────────────────────────────

const MOCK_EXAM_ROWS = [
  { id: 'exam_1', name: 'NDA Test 1', date: '2025-06-01', subject: 'Maths',
    batch: 'LWS_NDA_2Y_(25-27)', branch: null,
    marking: { correct: 4, wrong: -1 },
    questions: [{ q: 1, chapter: 'Algebra', subtopic: 'General' }],
    created_at: '2025-06-01T10:00:00.000Z', updated_at: '2025-06-01T10:00:00.000Z' },
]

const MOCK_RESULT_ROWS = [
  { exam_id: 'exam_1', student_name: 'Arjun Sharma', roll_no: 'R001',
    total_marks: 80, correct: 20, incorrect: 5, not_attempted: 5,
    responses: { '1': 1 } },
  { exam_id: 'exam_1', student_name: 'Ravi Kumar', roll_no: '',
    total_marks: 60, correct: 15, incorrect: 5, not_attempted: 10,
    responses: { '1': -1 } },
]

// loadExamsFromSupabase paginates via .select().range(from, to).
// The mock returns all rows on the first page (length < PAGE_SIZE signals end).
function makeExamsFromMock({ examsErr = null, resultsErr = null, examRows = MOCK_EXAM_ROWS, resultRows = MOCK_RESULT_ROWS } = {}) {
  supabase.from.mockImplementation(table => {
    if (table === 'exams') {
      const range = vi.fn().mockResolvedValue({ data: examRows, error: examsErr })
      return { select: vi.fn().mockReturnValue({ range }) }
    }
    if (table === 'exam_results') {
      const range = vi.fn().mockResolvedValue({ data: resultRows, error: resultsErr })
      return { select: vi.fn().mockReturnValue({ range }) }
    }
  })
}

describe('loadExamsFromSupabase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns reconstructed exams with students array', async () => {
    makeExamsFromMock()
    const result = await loadExamsFromSupabase()
    expect(result).toHaveLength(1)
    const exam = result[0]
    expect(exam.id).toBe('exam_1')
    expect(exam.name).toBe('NDA Test 1')
    expect(exam.subject).toBe('Maths')
    expect(exam.batch).toBe('LWS_NDA_2Y_(25-27)')
    expect(exam.branch).toBeNull()
    expect(exam.marking).toEqual({ correct: 4, wrong: -1 })
    expect(exam.questions).toEqual([{ q: 1, chapter: 'Algebra', subtopic: 'General' }])
    expect(exam.createdAt).toBe('2025-06-01T10:00:00.000Z')
  })

  it('maps result rows back to camelCase student objects', async () => {
    makeExamsFromMock()
    const [exam] = await loadExamsFromSupabase()
    expect(exam.students).toHaveLength(2)
    expect(exam.students[0]).toEqual({
      name:         'Arjun Sharma',
      rollNo:       'R001',
      totalMarks:   80,
      correct:      20,
      incorrect:    5,
      notAttempted: 5,
      responses:    { '1': 1 },
      choices:      {},   // additive; defaults to {} when the row has no choices column
    })
  })

  it('returns empty students array when exam has no result rows', async () => {
    makeExamsFromMock({ resultRows: [] })
    const [exam] = await loadExamsFromSupabase()
    expect(exam.students).toEqual([])
  })

  it('returns empty array when exams table is empty', async () => {
    makeExamsFromMock({ examRows: [], resultRows: [] })
    const result = await loadExamsFromSupabase()
    expect(result).toEqual([])
  })

  it('returns null when exams query errors', async () => {
    makeExamsFromMock({ examsErr: { message: 'permission denied' } })
    expect(await loadExamsFromSupabase()).toBeNull()
  })

  it('returns null when exam_results query errors', async () => {
    makeExamsFromMock({ resultsErr: { message: 'timeout' } })
    expect(await loadExamsFromSupabase()).toBeNull()
  })

  it('groups result rows correctly across multiple exams', async () => {
    const examRows = [
      { ...MOCK_EXAM_ROWS[0], id: 'exam_1' },
      { ...MOCK_EXAM_ROWS[0], id: 'exam_2', name: 'NDA Test 2' },
    ]
    const resultRows = [
      { ...MOCK_RESULT_ROWS[0], exam_id: 'exam_1' },
      { ...MOCK_RESULT_ROWS[1], exam_id: 'exam_2' },
    ]
    makeExamsFromMock({ examRows, resultRows })
    const exams = await loadExamsFromSupabase()
    expect(exams).toHaveLength(2)
    expect(exams.find(e => e.id === 'exam_1').students).toHaveLength(1)
    expect(exams.find(e => e.id === 'exam_2').students).toHaveLength(1)
  })

  it('paginates exam_results when first page is full (> default 1000 row limit)', async () => {
    const PAGE = 1000
    // First page: exactly PAGE rows → triggers a second fetch
    const page1 = Array.from({ length: PAGE }, (_, i) => ({
      ...MOCK_RESULT_ROWS[0], student_name: `Student ${i}`,
    }))
    // Second page: 2 rows → signals end of data
    const page2 = MOCK_RESULT_ROWS

    const rangeMock = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null })
    supabase.from.mockImplementation(table => {
      if (table === 'exams') {
        return { select: vi.fn().mockReturnValue({
          range: vi.fn().mockResolvedValue({ data: MOCK_EXAM_ROWS, error: null }),
        }) }
      }
      if (table === 'exam_results') {
        return { select: vi.fn().mockReturnValue({ range: rangeMock }) }
      }
    })

    const [exam] = await loadExamsFromSupabase()
    expect(exam.students).toHaveLength(PAGE + 2)
    expect(rangeMock).toHaveBeenCalledTimes(2)
    expect(rangeMock).toHaveBeenNthCalledWith(1, 0, PAGE - 1)
    expect(rangeMock).toHaveBeenNthCalledWith(2, PAGE, PAGE * 2 - 1)
  })
})
