import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createExamsSlice } from '../examsSlice'

// No Supabase session in tests → all mutations use the _save() (dev) path.
vi.mock('../../../lib/supabase', () => ({ supabase: null }))

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore(initialExams = []) {
  let state = { exams: initialExams }
  const save = vi.fn()
  const syncExamAbsences = vi.fn().mockResolvedValue({ added: 0, removed: 0, kept: 0 })
  const get  = () => ({ ...state, _save: save, syncExamAbsences })
  const set  = fn  => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  const slice = createExamsSlice(set, get)
  return { slice, state: () => state, save, syncExamAbsences }
}

function makeExam(overrides = {}) {
  return {
    id:        'exam_1',
    name:      'NDA Test 1',
    date:      '2025-06-01',
    subject:   'Maths',
    batch:     'BatchA',
    branch:    'Pune',
    marking:   { correct: 4, wrong: -1 },
    questions: [{ q: 1, chapter: 'Algebra', subtopic: 'General' }],
    students:  [{ name: 'Arjun Sharma', correct: 20, incorrect: 5, notAttempted: 5 }],
    createdAt: '2025-06-01T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

// ── addExam ───────────────────────────────────────────────────────────────────

describe('addExam', () => {
  it('appends the exam to state', () => {
    const { slice, state } = makeStore()
    slice.addExam(makeExam())
    expect(state().exams).toHaveLength(1)
    expect(state().exams[0].id).toBe('exam_1')
  })

  it('normalises empty batch to null', () => {
    const { slice, state } = makeStore()
    slice.addExam(makeExam({ batch: '' }))
    expect(state().exams[0].batch).toBeNull()
  })

  it('normalises empty branch to null', () => {
    const { slice, state } = makeStore()
    slice.addExam(makeExam({ branch: '' }))
    expect(state().exams[0].branch).toBeNull()
  })

  it('calls _save()', () => {
    const { slice, save } = makeStore()
    slice.addExam(makeExam())
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('appends without disturbing existing exams', () => {
    const existing = makeExam({ id: 'exam_0', name: 'Old Exam' })
    const { slice, state } = makeStore([existing])
    slice.addExam(makeExam())
    expect(state().exams).toHaveLength(2)
    expect(state().exams[0].id).toBe('exam_0')
  })

  it('triggers syncExamAbsences(examId) so the absence audit log reflects the new exam', () => {
    const { slice, syncExamAbsences } = makeStore()
    slice.addExam(makeExam({ id: 'exam_99' }))
    expect(syncExamAbsences).toHaveBeenCalledWith('exam_99')
  })
})

// ── replaceExam ───────────────────────────────────────────────────────────────

describe('replaceExam', () => {
  it('replaces the exam matching the given id', () => {
    const { slice, state } = makeStore([makeExam()])
    const updated = makeExam({ name: 'NDA Test 1 — Updated' })
    slice.replaceExam('exam_1', updated)
    expect(state().exams).toHaveLength(1)
    expect(state().exams[0].name).toBe('NDA Test 1 — Updated')
  })

  it('does not affect other exams', () => {
    const other = makeExam({ id: 'exam_2', name: 'Other Exam' })
    const { slice, state } = makeStore([makeExam(), other])
    slice.replaceExam('exam_1', makeExam({ name: 'Updated' }))
    expect(state().exams[1].name).toBe('Other Exam')
  })

  it('calls _save()', () => {
    const { slice, save } = makeStore([makeExam()])
    slice.replaceExam('exam_1', makeExam())
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('triggers syncExamAbsences so an attended-now student loses their stale absent row', () => {
    const { slice, syncExamAbsences } = makeStore([makeExam()])
    slice.replaceExam('exam_1', makeExam({ name: 'Updated' }))
    expect(syncExamAbsences).toHaveBeenCalledWith('exam_1')
  })
})

// ── deleteExam ────────────────────────────────────────────────────────────────

describe('deleteExam', () => {
  it('removes the exam with the given id', () => {
    const { slice, state } = makeStore([makeExam()])
    slice.deleteExam('exam_1')
    expect(state().exams).toHaveLength(0)
  })

  it('does not remove other exams', () => {
    const other = makeExam({ id: 'exam_2' })
    const { slice, state } = makeStore([makeExam(), other])
    slice.deleteExam('exam_1')
    expect(state().exams).toHaveLength(1)
    expect(state().exams[0].id).toBe('exam_2')
  })

  it('calls _save()', () => {
    const { slice, save } = makeStore([makeExam()])
    slice.deleteExam('exam_1')
    expect(save).toHaveBeenCalledTimes(1)
  })
})

// ── updateQuestion ────────────────────────────────────────────────────────────

describe('updateQuestion', () => {
  it('patches the matching question by number', () => {
    const exam = makeExam({
      questions: [
        { q: 1, chapter: 'Algebra',      subtopic: 'General' },
        { q: 2, chapter: 'Trigonometry', subtopic: 'General' },
      ],
    })
    const { slice, state } = makeStore([exam])
    slice.updateQuestion('exam_1', 1, { subtopic: 'Polynomials' })
    expect(state().exams[0].questions[0].subtopic).toBe('Polynomials')
    expect(state().exams[0].questions[0].chapter).toBe('Algebra')
  })

  it('does not affect other questions in the exam', () => {
    const exam = makeExam({
      questions: [
        { q: 1, chapter: 'Algebra',      subtopic: 'General' },
        { q: 2, chapter: 'Trigonometry', subtopic: 'General' },
      ],
    })
    const { slice, state } = makeStore([exam])
    slice.updateQuestion('exam_1', 1, { subtopic: 'Polynomials' })
    expect(state().exams[0].questions[1].subtopic).toBe('General')
  })

  it('does not affect other exams', () => {
    const other = makeExam({ id: 'exam_2', questions: [{ q: 1, chapter: 'Matrices', subtopic: 'General' }] })
    const { slice, state } = makeStore([makeExam(), other])
    slice.updateQuestion('exam_1', 1, { subtopic: 'Polynomials' })
    expect(state().exams[1].questions[0].subtopic).toBe('General')
  })

  it('calls _save()', () => {
    const { slice, save } = makeStore([makeExam()])
    slice.updateQuestion('exam_1', 1, { subtopic: 'X' })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
