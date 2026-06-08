import { describe, it, expect, vi } from 'vitest'
import { buildQuizRow, upsertQuiz, deleteQuizById } from '../quizSupabase'

describe('buildQuizRow', () => {
  it('maps camelCase quiz to snake_case row with defaults', () => {
    const row = buildQuizRow({
      id: 'uuid-1',
      title: 'Daily 1',
      subject: 'Maths',
      batch: 'LWS_NDA_2Y_(26-28)_A',
      branch: 'LWS Pune',
      exam: 'NDA',
      chapter: 'Probability',
      theme: 'formula',
      questions: [{ q: 1, answer: 'A' }],
      status: 'published',
      opensAt: '2026-06-05T03:00:00.000Z',
      closesAt: '2026-06-05T12:00:00.000Z',
      createdBy: 'teacher@lws.com',
      createdAt: '2026-06-05T02:00:00.000Z',
    })
    expect(row.id).toBe('uuid-1')
    expect(row.title).toBe('Daily 1')
    expect(row.batch).toBe('LWS_NDA_2Y_(26-28)_A')
    expect(row.status).toBe('published')
    expect(row.opens_at).toBe('2026-06-05T03:00:00.000Z')
    expect(row.closes_at).toBe('2026-06-05T12:00:00.000Z')
    expect(row.created_by).toBe('teacher@lws.com')
    expect(row.created_at).toBe('2026-06-05T02:00:00.000Z')
    expect(row.marking).toEqual({ correct: 1, wrong: 0 })
    expect(row.exam).toBe('NDA')
    expect(row.chapter).toBe('Probability')
    expect(row.theme).toBe('formula')
    expect(row.updated_at).toBeTypeOf('string')
  })

  it('nulls empty optional fields and defaults status to draft', () => {
    const row = buildQuizRow({ id: 'u', title: 'T', questions: [] })
    expect(row.subject).toBeNull()
    expect(row.batch).toBeNull()
    expect(row.branch).toBeNull()
    expect(row.exam).toBeNull()
    expect(row.chapter).toBeNull()
    expect(row.theme).toBeNull()
    expect(row.opens_at).toBeNull()
    expect(row.closes_at).toBeNull()
    expect(row.status).toBe('draft')
    expect(row.questions).toEqual([])
  })
})

describe('upsertQuiz', () => {
  it('upserts on id conflict', async () => {
    const upsert = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = { from: vi.fn(() => ({ upsert })) }
    await upsertQuiz(supabase, { id: 'u', title: 'T', questions: [] })
    expect(supabase.from).toHaveBeenCalledWith('quizzes')
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'u' }), { onConflict: 'id' })
  })

  it('throws on error', async () => {
    const supabase = { from: vi.fn(() => ({ upsert: vi.fn(() => Promise.resolve({ error: { message: 'boom' } })) })) }
    await expect(upsertQuiz(supabase, { id: 'u', title: 'T' })).rejects.toThrow('boom')
  })
})

describe('deleteQuizById', () => {
  it('deletes by id', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const del = vi.fn(() => ({ eq }))
    const supabase = { from: vi.fn(() => ({ delete: del })) }
    await deleteQuizById(supabase, 'u')
    expect(supabase.from).toHaveBeenCalledWith('quizzes')
    expect(eq).toHaveBeenCalledWith('id', 'u')
  })

  it('throws on error', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: { message: 'nope' } }))
    const supabase = { from: vi.fn(() => ({ delete: vi.fn(() => ({ eq })) })) }
    await expect(deleteQuizById(supabase, 'u')).rejects.toThrow('nope')
  })
})
