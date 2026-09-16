import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSheetLayout, textWidthMm } from '../layout'

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

// ── The header stamp ─────────────────────────────────────────────────────────
//
// The stamp is what makes a mismatched sheet diagnosable by eye, and it shipped
// running off the paper: anchored at the RIGHT edge of the header and drawn
// left-to-right from there, so of `OMR v1 · 25Q · NDA - Set Theory` only the
// first 10mm — `OMR v1 ·` — landed on the sheet. Two-up was worse: the bottom
// half's tail crossed the cut line and printed across the TOP half, so a cut
// sheet carried the neighbouring paper's identity at its top-left.
describe('renderOmrSheetPdf — the header stamp', () => {
  beforeEach(reset)

  /** Where a drawn string starts and ends, in page millimetres. */
  const runOf = ([text, x, y, opts], layout) => {
    const w = textWidthMm(text, layout.geometry.fonts.stamp)
    // angle 90 is anticlockwise, so the baseline runs toward decreasing page y
    const end = (opts?.angle || 0) === 90 ? { x, y: y - w } : { x: x + w, y }
    return { start: { x, y }, end, width: w, text }
  }
  const stampsIn = () => calls.text.filter(a => String(a[0]).startsWith('OMR '))

  it('prints the whole stamp on the paper, at both formats', async () => {
    for (const perPage of [1, 2]) {
      reset()
      const layout = buildSheetLayout({ questionCount: 25, perPage })
      await renderOmrSheetPdf(layout, { title: 'NDA - Set Theory' })
      const stamps = stampsIn()
      expect(stamps).toHaveLength(perPage)
      for (const call of stamps) {
        const { start, end, text } = runOf(call, layout)
        expect(text).toBe('OMR v1 · 25Q · NDA - Set Theory')
        for (const p of [start, end]) {
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.y).toBeGreaterThanOrEqual(0)
          expect(p.x).toBeLessThanOrEqual(layout.page.width)
          expect(p.y).toBeLessThanOrEqual(layout.page.height)
        }
      }
    }
  })

  it('keeps each half’s stamp on its own side of the cut', async () => {
    const layout = buildSheetLayout({ questionCount: 25, perPage: 2 })
    await renderOmrSheetPdf(layout, { title: 'NDA - Set Theory' })
    const runs = stampsIn().map(c => runOf(c, layout))
    expect(runs).toHaveLength(2)
    for (const r of runs) {
      const lo = Math.min(r.start.y, r.end.y), hi = Math.max(r.start.y, r.end.y)
      // wholly above the cut, or wholly below it — never straddling
      expect(lo < layout.cutLine === hi < layout.cutLine).toBe(true)
    }
    // and the two are not on the same half
    expect(runs[0].start.y < layout.cutLine).not.toBe(runs[1].start.y < layout.cutLine)
  })

  it('truncates a long exam name rather than running off the sheet', async () => {
    const layout = buildSheetLayout({ questionCount: 25, perPage: 2 })
    // Comfortably past the reserved run, so this pins the trim and not the
    // happy path — a name that merely looks long still fits.
    const long = `NDA Maths Blueprint Mock 4 ${'Set Theory and Relations '.repeat(6)}`
    await renderOmrSheetPdf(layout, { title: long })
    const [call] = stampsIn()
    const { width, text } = runOf(call, layout)
    expect(width).toBeLessThanOrEqual(layout.sheets[0].header.stampMaxWidth)
    // the version and the length survive — they are what a mismatch is spotted by
    expect(text.startsWith('OMR v1 · 25Q · ')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
  })

  it('right-aligns the stamp against the run the layout reserved', async () => {
    for (const perPage of [1, 2]) {
      reset()
      const layout = buildSheetLayout({ questionCount: 25, perPage })
      await renderOmrSheetPdf(layout, { title: 'NDA - Set Theory' })
      const { end } = runOf(stampsIn()[0], layout)
      const { stampEnd } = layout.sheets[0].header
      expect(end.x).toBeCloseTo(stampEnd.x, 3)
      expect(end.y).toBeCloseTo(stampEnd.y, 3)
    }
  })
})
