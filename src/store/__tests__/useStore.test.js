import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: null }))

vi.mock('../persist', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    loadExamsFromSupabase: vi.fn(),
    loadFromDisk:          vi.fn().mockResolvedValue(null),
    saveToStorage:         vi.fn(),
    clearStorage:          vi.fn(),
  }
})

import useStore from '../useStore'
import { loadExamsFromSupabase as mockLoadExams } from '../persist'

const MOCK_EXAMS = [
  { id: 'exam_1', name: 'NDA Test 1', date: '2025-06-01', students: [] },
  { id: 'exam_2', name: 'NDA Test 2', date: '2025-07-01', students: [] },
]

describe('useStore.loadExamsFromSupabase (store action)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ exams: [] })
  })

  it('sets exams in the store when persist returns data', async () => {
    mockLoadExams.mockResolvedValue(MOCK_EXAMS)
    await useStore.getState().loadExamsFromSupabase()
    expect(useStore.getState().exams).toEqual(MOCK_EXAMS)
  })

  it('leaves exams unchanged when persist returns null', async () => {
    useStore.setState({ exams: MOCK_EXAMS })
    mockLoadExams.mockResolvedValue(null)
    await useStore.getState().loadExamsFromSupabase()
    expect(useStore.getState().exams).toEqual(MOCK_EXAMS)
  })

  it('leaves exams unchanged when persist returns empty array', async () => {
    useStore.setState({ exams: MOCK_EXAMS })
    mockLoadExams.mockResolvedValue([])
    await useStore.getState().loadExamsFromSupabase()
    expect(useStore.getState().exams).toEqual([])
  })
})
