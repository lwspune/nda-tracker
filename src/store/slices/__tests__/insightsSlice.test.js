import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInsightsSlice } from '../insightsSlice'

// No Supabase session in tests → Supabase path is short-circuited; state-only behaviour verified.
vi.mock('../../../lib/supabase', () => ({ supabase: null }))

function makeStore(initial = {}) {
  let state = {
    savedInsights: { classReport: null, studentPlans: {} },
    ...initial,
  }
  const saveSpy = vi.fn()
  let slice
  const get = () => ({
    ...state,
    _save: saveSpy,
    ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')),
  })
  const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createInsightsSlice(set, get)
  return { slice, getState: () => state, saveSpy }
}

describe('saveClassReport', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('stores text + ISO generatedAt on savedInsights.classReport', async () => {
    const { slice, getState } = makeStore()
    await slice.saveClassReport('great class did well')
    expect(getState().savedInsights.classReport.text).toBe('great class did well')
    expect(getState().savedInsights.classReport.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('overwrites the previous classReport with the latest', async () => {
    const { slice, getState } = makeStore()
    await slice.saveClassReport('first')
    await slice.saveClassReport('second')
    expect(getState().savedInsights.classReport.text).toBe('second')
  })

  it('triggers _save for dev-mode file persistence', async () => {
    const { slice, saveSpy } = makeStore()
    await slice.saveClassReport('x')
    expect(saveSpy).toHaveBeenCalled()
  })
})

describe('saveStudentPlan', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('stores text + generatedAt keyed by student name', async () => {
    const { slice, getState } = makeStore()
    await slice.saveStudentPlan('Aarav Sharma', 'work on geometry')
    const plan = getState().savedInsights.studentPlans['Aarav Sharma']
    expect(plan.text).toBe('work on geometry')
    expect(plan.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('preserves plans for other students when adding a new one', async () => {
    const { slice, getState } = makeStore()
    await slice.saveStudentPlan('Aarav', 'A')
    await slice.saveStudentPlan('Bina', 'B')
    expect(getState().savedInsights.studentPlans['Aarav'].text).toBe('A')
    expect(getState().savedInsights.studentPlans['Bina'].text).toBe('B')
  })

  it('overwrites the existing plan for the same student (store shows latest)', async () => {
    const { slice, getState } = makeStore()
    await slice.saveStudentPlan('Aarav', 'old')
    await slice.saveStudentPlan('Aarav', 'new')
    expect(getState().savedInsights.studentPlans['Aarav'].text).toBe('new')
  })
})

describe('clearClassReport', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('nulls classReport on savedInsights', async () => {
    const { slice, getState } = makeStore({
      savedInsights: { classReport: { text: 'old', generatedAt: '2025-01-01T00:00:00Z' }, studentPlans: {} },
    })
    await slice.clearClassReport()
    expect(getState().savedInsights.classReport).toBeNull()
  })

  it('leaves studentPlans untouched', async () => {
    const { slice, getState } = makeStore({
      savedInsights: {
        classReport: { text: 'r', generatedAt: 't' },
        studentPlans: { Aarav: { text: 'A', generatedAt: 't' } },
      },
    })
    await slice.clearClassReport()
    expect(getState().savedInsights.studentPlans).toEqual({ Aarav: { text: 'A', generatedAt: 't' } })
  })
})

describe('clearStudentPlan', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('removes the named student plan only', async () => {
    const { slice, getState } = makeStore({
      savedInsights: {
        classReport: null,
        studentPlans: {
          Aarav: { text: 'A', generatedAt: 't' },
          Bina:  { text: 'B', generatedAt: 't' },
        },
      },
    })
    await slice.clearStudentPlan('Aarav')
    expect(getState().savedInsights.studentPlans).toEqual({ Bina: { text: 'B', generatedAt: 't' } })
  })
})
