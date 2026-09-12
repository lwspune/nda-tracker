import { describe, it, expect } from 'vitest'
import { assessMarking } from '../markingCheck'

// Shorthand: a reconcile report where every student agrees.
const allOk = (n = 20) => ({ checked: n, ok: n, failed: [] })

describe('assessMarking — the scheme is read off the sheet', () => {
  it('reads +correct / −wrong from the distinct mark values', () => {
    const out = assessMarking({ markValues: [-1.33, 0, 4], totalsReconcile: allOk() })
    expect(out.correct).toBe(4)
    expect(out.wrong).toBe(-1.33)
    expect(out.status).toBe('verified')
  })

  it('reports wrong as 0 for a paper with no negative marking', () => {
    const out = assessMarking({ markValues: [0, 4], totalsReconcile: allOk() })
    expect(out.correct).toBe(4)
    expect(out.wrong).toBe(0)
    expect(out.status).toBe('verified')
  })

  it('does not require a zero value — every question may have been attempted', () => {
    const out = assessMarking({ markValues: [-0.83, 4], totalsReconcile: allOk() })
    expect(out).toMatchObject({ correct: 4, wrong: -0.83, status: 'verified' })
  })

  // Regression, from the real data: Chemistry-Basic Concept l_2026-07-24.xlsx has
  // values {0, 4, -0.83} and every student reconciles — yet a check built on the
  // sheet's Correct/Incorrect COUNT columns rejected all 21 students, because those
  // columns are wrong in that file. Verifying against the sum identity must accept it.
  it('accepts the sheet whose count columns are broken but whose totals reconcile', () => {
    const out = assessMarking({
      markValues: [-0.83, 0, 4],
      totalsReconcile: { checked: 21, ok: 21, failed: [] },
    })
    expect(out.status).toBe('verified')
    expect(out).toMatchObject({ correct: 4, wrong: -0.83 })
  })
})

describe('assessMarking — refuses what the two-number model cannot express', () => {
  it('refuses more than one positive value rather than picking the largest', () => {
    const out = assessMarking({ markValues: [0, 2, 4], totalsReconcile: allOk() })
    expect(out.status).toBe('refuse')
    expect(out.detail).toMatch(/positive/i)
    // The larger value must NOT be silently adopted.
    expect(out.correct).toBeNull()
  })

  it('refuses more than one negative value', () => {
    const out = assessMarking({ markValues: [-1.33, -0.83, 0, 4], totalsReconcile: allOk() })
    expect(out.status).toBe('refuse')
    expect(out.detail).toMatch(/negative/i)
    expect(out.wrong).toBeNull()
  })

  it('refuses a sheet with no positive mark value at all', () => {
    const out = assessMarking({ markValues: [0], totalsReconcile: allOk() })
    expect(out.status).toBe('refuse')
    expect(out.correct).toBeNull()
  })

  it('refuses when there are no per-question mark values to read', () => {
    const out = assessMarking({ markValues: [], totalsReconcile: { checked: 0, ok: 0, failed: [] } })
    expect(out.status).toBe('refuse')
  })

  it('refuses when NO student reconciles — the sheet is internally inconsistent', () => {
    const out = assessMarking({
      markValues: [0, 4],
      totalsReconcile: { checked: 17, ok: 0, failed: [{ name: 'A', sheetTotal: 99, sumOfMarks: 8 }] },
    })
    expect(out.status).toBe('refuse')
    expect(out.detail).toMatch(/17/)
  })
})

describe('assessMarking — warns without blocking', () => {
  it('warns when some students fail to reconcile — a dropped or bonus question does this', () => {
    const out = assessMarking({
      markValues: [-1.33, 0, 4],
      totalsReconcile: { checked: 17, ok: 16, failed: [{ name: 'Z', sheetTotal: 40, sumOfMarks: 38.67 }] },
    })
    expect(out.status).toBe('warn')
    expect(out).toMatchObject({ correct: 4, wrong: -1.33 })
    expect(out.detail).toMatch(/16 of 17/)
  })

  it('warns, not refuses, when there are no student rows to verify against', () => {
    const out = assessMarking({ markValues: [0, 4], totalsReconcile: { checked: 0, ok: 0, failed: [] } })
    expect(out.status).toBe('warn')
    expect(out).toMatchObject({ correct: 4, wrong: 0 })
  })
})

describe('assessMarking — defensive', () => {
  it('refuses rather than throwing on missing input', () => {
    expect(assessMarking({}).status).toBe('refuse')
    expect(assessMarking().status).toBe('refuse')
  })

  it('names the count of students that verified the scheme', () => {
    const out = assessMarking({ markValues: [0, 4], totalsReconcile: allOk(26) })
    expect(out.detail).toMatch(/26 of 26/)
  })
})
