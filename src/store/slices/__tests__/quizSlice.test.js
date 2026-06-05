import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

import { supabase } from '../../../lib/supabase'
import { createQuizSlice } from '../quizSlice'

function makeStore(initial = {}) {
  let state = { quizzes: [], _save: vi.fn(), ...initial }
  let slice
  const get = () => ({ ...state, ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')) })
  const set = fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createQuizSlice(set, get)
  return { slice, getState: () => state }
}

// Chainable thenable builder (matches attendanceSlice.test): select/eq/delete
// return the builder; awaiting the builder resolves to { data, error }; upsert is terminal.
function mockSupabase({ sessionActive = true, upsertError = null, selectRows = [], selectError = null } = {}) {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: sessionActive ? { user: { id: 'staff' } } : null },
  })
  const builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq     = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.upsert = vi.fn(() => Promise.resolve({ error: upsertError }))
  builder.then   = (resolve) => Promise.resolve({ data: selectRows, error: selectError }).then(resolve)
  supabase.from.mockReturnValue(builder)
  return { builder, eq: builder.eq }
}

const QUIZ = { id: 'q1', title: 'Daily 1', questions: [{ q: 1, answer: 'A' }], status: 'draft' }

describe('addQuiz', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds to local state and writes to Supabase when a session exists', async () => {
    const { builder } = mockSupabase({ sessionActive: true })
    const { slice, getState } = makeStore()
    slice.addQuiz(QUIZ)
    expect(getState().quizzes).toHaveLength(1)
    await Promise.resolve(); await Promise.resolve()
    expect(supabase.from).toHaveBeenCalledWith('quizzes')
    expect(builder.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }), { onConflict: 'id' })
  })

  it('does NOT call _save when a session exists (avoids clobbering faculty_state)', async () => {
    mockSupabase({ sessionActive: true })
    const { slice, getState } = makeStore()
    slice.addQuiz(QUIZ)
    await Promise.resolve(); await Promise.resolve()
    expect(getState()._save).not.toHaveBeenCalled()
  })

  it('persists to disk via _save when there is no session (dev/local)', async () => {
    mockSupabase({ sessionActive: false })
    const { slice, getState } = makeStore()
    slice.addQuiz(QUIZ)
    await Promise.resolve(); await Promise.resolve()
    expect(getState()._save).toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('updateQuiz', () => {
  beforeEach(() => vi.clearAllMocks())

  it('patches the matching quiz and upserts the merged result', async () => {
    const { builder } = mockSupabase({ sessionActive: true })
    const { slice, getState } = makeStore({ quizzes: [QUIZ] })
    slice.updateQuiz('q1', { status: 'published', title: 'Renamed' })
    expect(getState().quizzes[0].status).toBe('published')
    expect(getState().quizzes[0].title).toBe('Renamed')
    await Promise.resolve(); await Promise.resolve()
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q1', status: 'published', title: 'Renamed' }),
      { onConflict: 'id' },
    )
  })

  it('is a no-op for an unknown id', async () => {
    const { builder } = mockSupabase({ sessionActive: true })
    const { slice, getState } = makeStore({ quizzes: [QUIZ] })
    slice.updateQuiz('nope', { status: 'published' })
    expect(getState().quizzes[0].status).toBe('draft')
    await Promise.resolve(); await Promise.resolve()
    expect(builder.upsert).not.toHaveBeenCalled()
  })
})

describe('deleteQuiz', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes from local state and deletes from Supabase when a session exists', async () => {
    const { builder, eq } = mockSupabase({ sessionActive: true })
    const { slice, getState } = makeStore({ quizzes: [QUIZ] })
    slice.deleteQuiz('q1')
    expect(getState().quizzes).toHaveLength(0)
    await Promise.resolve(); await Promise.resolve()
    expect(builder.delete).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('id', 'q1')
  })

  it('persists via _save when there is no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice, getState } = makeStore({ quizzes: [QUIZ] })
    slice.deleteQuiz('q1')
    await Promise.resolve(); await Promise.resolve()
    expect(getState()._save).toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('getQuizAttempts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries quiz_attempts by quiz_id and maps rows to camelCase', async () => {
    const { builder } = mockSupabase({
      selectRows: [{ quiz_id: 'q1', lws_id: 'L1', student_name: 'Arjun', answers: { 1: 'A' }, score: 1, correct: 1, incorrect: 0, not_attempted: 0, submitted_at: 't' }],
    })
    const { slice } = makeStore()
    const rows = await slice.getQuizAttempts('q1')
    expect(supabase.from).toHaveBeenCalledWith('quiz_attempts')
    expect(builder.eq).toHaveBeenCalledWith('quiz_id', 'q1')
    expect(rows[0]).toEqual({ quizId: 'q1', lwsId: 'L1', studentName: 'Arjun', answers: { 1: 'A' }, score: 1, correct: 1, incorrect: 0, notAttempted: 0, submittedAt: 't' })
  })

  it('returns [] when there is no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.getQuizAttempts('q1')).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns [] on query error', async () => {
    mockSupabase({ selectError: { message: 'boom' } })
    const { slice } = makeStore()
    expect(await slice.getQuizAttempts('q1')).toEqual([])
  })
})

describe('getQuizAttemptsForStudent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries quiz_attempts by lws_id', async () => {
    const { builder } = mockSupabase({ selectRows: [] })
    const { slice } = makeStore()
    await slice.getQuizAttemptsForStudent('L1')
    expect(supabase.from).toHaveBeenCalledWith('quiz_attempts')
    expect(builder.eq).toHaveBeenCalledWith('lws_id', 'L1')
  })

  it('returns [] when there is no session', async () => {
    mockSupabase({ sessionActive: false })
    const { slice } = makeStore()
    expect(await slice.getQuizAttemptsForStudent('L1')).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
