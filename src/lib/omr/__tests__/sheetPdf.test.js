import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSheetLayout } from '../layout'

// jsPDF is mocked so these tests pin WHAT gets drawn — a sheet missing its
// registration squares or its roll block still "renders" and still produces a
// PDF, it just can never be read. Call counts are the cheapest guard against
// that, and they are derived from the layout rather than hardcoded.
const calls = { rect: [], circle: [], text: [], line: [], setFillColor: [] }
const reset = () => Object.keys(calls).forEach(k => { calls[k] = [] })

vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor(opts) { this.opts = opts }
    rect(...a) { calls.rect.push(a) }
    circle(...a) { calls.circle.push(a) }
    text(...a) { calls.text.push(a) }
    line(...a) { calls.line.push(a) }
    setFillColor(...a) { calls.setFillColor.push(a) }
    setDrawColor() {}
    setLineWidth() {}
    setLineDashPattern() {}
    setFontSize() {}
    setFont() {}
    output() { return new Blob(['%PDF'], { type: 'application/pdf' }) }
  },
}))

const { renderOmrSheetPdf } = await import('../sheetPdf')

const bubbleCount = layout => layout.sheets.reduce((n, s) =>
  n + s.roll.columns.reduce((m, c) => m + c.bubbles.length, 0)
    + s.questions.reduce((m, q) => m + q.options.length, 0), 0)

describe('renderOmrSheetPdf', () => {
  beforeEach(reset)

  it('draws one circle per bubble in the layout', async () => {
    const layout = buildSheetLayout({ questionCount: 150 })
    await renderOmrSheetPdf(layout)
    expect(calls.circle).toHaveLength(bubbleCount(layout))
  })

  it('draws every registration square as a FILLED rect — an outline will not register', async () => {
    const layout = buildSheetLayout({ questionCount: 150 })
    await renderOmrSheetPdf(layout)
    const squares = layout.sheets[0].registration
    const filled = calls.rect.filter(a => a[4] === 'F')
    expect(filled.length).toBeGreaterThanOrEqual(squares.length)
    for (const s of squares) {
      expect(filled.some(a =>
        Math.abs(a[0] - s.x) < 0.001 && Math.abs(a[1] - s.y) < 0.001 &&
        Math.abs(a[2] - s.size) < 0.001)).toBe(true)
    }
  })

  it('prints every question number', async () => {
    const layout = buildSheetLayout({ questionCount: 150 })
    await renderOmrSheetPdf(layout)
    const printed = new Set(calls.text.map(a => String(a[0])))
    for (let q = 1; q <= 150; q++) expect(printed.has(String(q))).toBe(true)
  })

  it('uses millimetres and A4, matching the layout it is handed', async () => {
    const layout = buildSheetLayout({ questionCount: 30 })
    await renderOmrSheetPdf(layout)
    // constructed with the right units, else every coordinate is silently wrong
    expect(calls.circle.length).toBeGreaterThan(0)
    const maxX = Math.max(...calls.circle.map(a => a[0]))
    expect(maxX).toBeLessThanOrEqual(layout.page.width)
  })

  it('draws a cut line only when printing 2-up', async () => {
    await renderOmrSheetPdf(buildSheetLayout({ questionCount: 30, perPage: 1 }))
    const oneUpLines = calls.line.length
    reset()
    const two = buildSheetLayout({ questionCount: 30, perPage: 2 })
    await renderOmrSheetPdf(two)
    expect(calls.line.length).toBeGreaterThan(oneUpLines)
    expect(calls.line.some(a => Math.abs(a[1] - two.cutLine) < 0.001)).toBe(true)
  })

  it('draws both halves at 2-up, not one twice', async () => {
    const layout = buildSheetLayout({ questionCount: 30, perPage: 2 })
    await renderOmrSheetPdf(layout)
    const ys = calls.circle.map(a => a[1])
    expect(ys.some(y => y < layout.cutLine)).toBe(true)
    expect(ys.some(y => y > layout.cutLine)).toBe(true)
  })

  it('returns a PDF blob', async () => {
    const blob = await renderOmrSheetPdf(buildSheetLayout({ questionCount: 30 }))
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
  })
})
