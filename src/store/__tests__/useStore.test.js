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

// Opening the scanner FROM an exam card. The picker offers every MCQ exam the
// school has ever run — 173 of them today, which is the tedium this removes.
describe('useStore.setScanExam', () => {
  beforeEach(() => {
    useStore.setState({ activePage: 'dashboard', scanExamId: null, activeStudent: 'Someone' })
  })

  it('lands on the scanner with that exam already chosen', () => {
    useStore.getState().setScanExam('exam_2')
    expect(useStore.getState().activePage).toBe('scan')
    expect(useStore.getState().scanExamId).toBe('exam_2')
  })

  it('clears the held student, as every other navigation does', () => {
    useStore.getState().setScanExam('exam_2')
    expect(useStore.getState().activeStudent).toBeNull()
  })

  // Navigating away must not leave the scanner pinned to a stale exam the next
  // time it is opened from the sidebar.
  it('is forgotten on the next navigation', () => {
    useStore.getState().setScanExam('exam_2')
    useStore.getState().setActivePage('exams')
    expect(useStore.getState().scanExamId).toBeNull()
  })
})
