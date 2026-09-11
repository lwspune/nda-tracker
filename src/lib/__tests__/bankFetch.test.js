// The client half of the bank pull: which ids an exam can ask for, how they are
// chunked to the endpoint's cap, and how several responses merge into one.
import { describe, it, expect, vi } from 'vitest'
import { bankQuestionIds, chunkIds, fetchBankQuestions, MAX_IDS } from '../bankFetch'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('bankQuestionIds', () => {
  it('collects the distinct bank ids on an exam', () => {
    const exam = { questions: [{ q: 1, questionId: A }, { q: 2, questionId: B }, { q: 3, questionId: A }] }
    expect(bankQuestionIds(exam)).toEqual([A, B])
  })

  it('ignores questions with no bank id — hand-typed sheets and old exams', () => {
    const exam = { questions: [{ q: 1 }, { q: 2, questionId: null }, { q: 3, questionId: '' }, { q: 4, questionId: A }] }
    expect(bankQuestionIds(exam)).toEqual([A])
  })

  it('is empty for an exam with no questions at all (written quiz)', () => {
    expect(bankQuestionIds({ questions: [] })).toEqual([])
    expect(bankQuestionIds({})).toEqual([])
  })
})

describe('chunkIds', () => {
  it('keeps a request under the endpoint cap', () => {
    const ids = Array.from({ length: MAX_IDS * 2 + 1 }, (_, i) => `id-${i}`)
    const chunks = chunkIds(ids)
    expect(chunks.length).toBe(3)
    expect(chunks[0]).toHaveLength(MAX_IDS)
    expect(chunks[2]).toHaveLength(1)
    expect(chunks.flat()).toEqual(ids)   // nothing lost
  })

  it('returns nothing for no ids — never an empty request', () => {
    expect(chunkIds([])).toEqual([])
  })
})

describe('fetchBankQuestions', () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })

  it('returns questions keyed by id, plus the ids the bank had nothing for', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({
      ok: true, questions: [{ questionId: A, question: 'a' }], missing: [B],
    }))
    const out = await fetchBankQuestions([A, B], { token: 'jwt', fetchImpl })
    expect(out.byId[A]).toEqual({ questionId: A, question: 'a' })
    expect(out.missing).toEqual([B])
  })

  it('sends the admin session token, not any shared secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ questions: [], missing: [] }))
    await fetchBankQuestions([A], { token: 'jwt', fetchImpl })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer jwt')
    expect(JSON.parse(init.body)).toEqual({ kind: 'hydrate-questions', ids: [A] })
  })

  it('merges several chunks into one result', async () => {
    const ids = Array.from({ length: MAX_IDS + 1 }, (_, i) => `id-${i}`)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ questions: [{ questionId: 'id-0' }], missing: ['id-1'] }))
      .mockResolvedValueOnce(ok({ questions: [{ questionId: `id-${MAX_IDS}` }], missing: [] }))
    const out = await fetchBankQuestions(ids, { token: 'jwt', fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(Object.keys(out.byId).sort()).toEqual(['id-0', `id-${MAX_IDS}`].sort())
    expect(out.missing).toEqual(['id-1'])
  })

  it('THROWS on a failed request — an unreachable bank must not read as an empty one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({ error: 'PYQ Vault returned 401' }),
    })
    await expect(fetchBankQuestions([A], { token: 'jwt', fetchImpl }))
      .rejects.toThrow(/PYQ Vault returned 401/)
  })

  it('does not call the network when there is nothing to ask for', async () => {
    const fetchImpl = vi.fn()
    const out = await fetchBankQuestions([], { token: 'jwt', fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(out).toEqual({ byId: {}, missing: [] })
  })
})
