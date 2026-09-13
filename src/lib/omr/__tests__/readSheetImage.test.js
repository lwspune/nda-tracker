import { describe, it, expect } from 'vitest'
import { buildSheetLayout } from '../layout'
import { readSheetImage } from '../readSheetImage'

// These tests render a real layout, mark known answers on it, and read it back
// through the whole chain. Every bug in this build so far survived a unit test
// that shared an assumption with the code; rendering the actual sheet is what
// stops that happening again.

const S = 6                                     // px per mm

/** Draw a layout to an ImageData-shaped buffer, filling `marks`. */
function renderSheet(layout, { marks = new Map(), roll = null, sheetIndex = 0 } = {}) {
  const sheet = layout.sheets[sheetIndex]
  const width = Math.round(layout.page.width * S)
  const height = Math.round(layout.page.height * S)
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const put = (x, y, v) => {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
  }
  const disc = (cx, cy, r, v = 20) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, v)
  }
  const ring = (cx, cy, r, v = 50) => {
    const steps = Math.max(60, Math.round(2 * Math.PI * r * 3))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI
      for (const rr of [r, r - 0.8]) put(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, v)
    }
  }
  for (const s of sheet.registration) {
    for (let y = 0; y < s.size * S; y++)
      for (let x = 0; x < s.size * S; x++) put(s.x * S + x, s.y * S + y, 0)
  }
  sheet.roll.columns.forEach((c, ci) => {
    for (const b of c.bubbles) {
      ring(b.x * S, b.y * S, b.r * S)
      if (roll && Number(String(roll)[ci]) === b.value) disc(b.x * S, b.y * S, b.r * S * 0.75)
    }
  })
  for (const q of sheet.questions) {
    q.options.forEach((o, i) => {
      ring(o.x * S, o.y * S, o.r * S)
      if ((marks.get(q.q) || []).includes(i)) disc(o.x * S, o.y * S, o.r * S * 0.75)
    })
  }
  return { width, height, data }
}

const layout30 = buildSheetLayout({ questionCount: 30 })
const roster = [
  { lwsId: 'LWS-013', name: 'Mangesh Pawar', evalbeeRollNos: ['00013'] },
  { lwsId: 'LWS-048', name: 'Tejas Jadhav', evalbeeRollNos: ['00048'] },
]

describe('readSheetImage', () => {
  it('reads the marks back off a rendered sheet', () => {
    const marks = new Map([[1, [0]], [2, [2]], [7, [3]], [30, [1]]])
    const image = renderSheet(layout30, { marks })
    const r = readSheetImage(image, { layout: layout30 })
    expect(r.ok).toBe(true)
    expect(r.answers[1]).toBe('A')
    expect(r.answers[2]).toBe('C')
    expect(r.answers[7]).toBe('D')
    expect(r.answers[30]).toBe('B')
    expect(r.answers[3]).toBeNull()          // untouched
    expect(r.reviewCount).toBe(0)
  })

  it('flags a double mark instead of choosing between the two', () => {
    const image = renderSheet(layout30, { marks: new Map([[5, [0, 2]]]) })
    const r = readSheetImage(image, { layout: layout30 })
    expect(r.ok).toBe(true)
    expect(r.answers[5]).toBeNull()
    expect(r.decisions.find(d => d.q === 5).state).toBe('multi')
    expect(r.complete).toBe(false)
  })

  it('reads the roll number and resolves the student', () => {
    const image = renderSheet(layout30, { marks: new Map([[1, [0]]]), roll: '00048' })
    const r = readSheetImage(image, { layout: layout30, roster })
    expect(r.roll.digits).toBe('00048')
    expect(r.student.lwsId).toBe('LWS-048')
    expect(r.student.matchedBy).toBe('evalbee')
  })

  it('refuses the sheet rather than the exam when the roll is blank', () => {
    // A missing roll must not discard the answers — they are still read, the
    // sheet just cannot be filed until a human says whose it is.
    const image = renderSheet(layout30, { marks: new Map([[1, [0]]]) })
    const r = readSheetImage(image, { layout: layout30, roster })
    expect(r.ok).toBe(true)
    expect(r.answers[1]).toBe('A')
    expect(r.student.lwsId).toBeNull()
    expect(r.student.review).toBe(true)
    expect(r.complete).toBe(false)
  })

  it('rejects a sheet whose grid does not match the exam', () => {
    // Scanning last week's 30-question sheets against a 150-question paper.
    // Silently reading whatever lines up would file nonsense against real
    // students, so the shape of the grid is checked before anything is sampled.
    const image = renderSheet(layout30, { marks: new Map([[1, [0]]]) })
    const layout150 = buildSheetLayout({ questionCount: 150 })
    const r = readSheetImage(image, { layout: layout150 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/grid|match|sheet/i)
  })

  it('gives a usable reason when it cannot find a sheet at all', () => {
    const blank = {
      width: 400, height: 500,
      data: new Uint8ClampedArray(400 * 500 * 4).fill(255),
    }
    const r = readSheetImage(blank, { layout: layout30 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
    expect(r.answers).toBeUndefined()
  })

  // A short paper prints a 2-COLUMN sheet, and the whole chain used to refuse
  // one: the row step and the between-column diagonal are close enough that the
  // lattice came back measured in two-row units, so a 20-question sheet fitted
  // as 2x5 and every 20Q paper was rejected with "is it the right paper?".
  // Three real exams are 20-question papers. The geometry is pinned across all
  // counts in gridFit.test.js; this is the end-to-end proof.
  it('reads a short 2-column sheet, not just the wide ones', () => {
    const layout20 = buildSheetLayout({ questionCount: 20 })
    const image = renderSheet(layout20, { marks: new Map([[1, [0]], [20, [3]]]), roll: '00013' })
    const r = readSheetImage(image, { layout: layout20, roster })
    expect(r.ok).toBe(true)
    expect(r.grid).toEqual({ cols: 2, rows: 10 })
    expect(r.answers[1]).toBe('A')
    expect(r.answers[20]).toBe('D')
    expect(r.roll.digits).toBe('00013')
    expect(r.student.lwsId).toBe('LWS-013')
  })

  // The viewfinder draws this as the "I can see the sheet" outline. It comes
  // from the solved transform, so it tracks the paper through tilt and rotation
  // instead of being a fixed frame the operator has to line the sheet up inside.
  it('reports where the sheet is in the frame', () => {
    const image = renderSheet(layout30, { marks: new Map([[1, [0]]]) })
    const r = readSheetImage(image, { layout: layout30 })
    expect(r.corners).toHaveLength(4)
    // The render is flat-on at S px per mm, so the quad must land on the outer
    // registration marks themselves — not merely somewhere sensible.
    const reg = layout30.sheets[0].registration
    const size = layout30.geometry.registrationSize
    const want = {
      x0: Math.min(...reg.map(s => s.x)) * S,
      x1: (Math.max(...reg.map(s => s.x)) + size) * S,
      y0: Math.min(...reg.map(s => s.y)) * S,
      y1: (Math.max(...reg.map(s => s.y)) + size) * S,
    }
    const [tl, tr, br, bl] = r.corners
    expect(tl.x).toBeCloseTo(want.x0, -1); expect(tl.y).toBeCloseTo(want.y0, -1)
    expect(tr.x).toBeCloseTo(want.x1, -1); expect(tr.y).toBeCloseTo(want.y0, -1)
    expect(br.x).toBeCloseTo(want.x1, -1); expect(br.y).toBeCloseTo(want.y1, -1)
    expect(bl.x).toBeCloseTo(want.x0, -1); expect(bl.y).toBeCloseTo(want.y1, -1)
  })

  it('reports the registration squares it found, for diagnosing a bad capture', () => {
    const image = renderSheet(layout30, {})
    const r = readSheetImage(image, { layout: layout30 })
    expect(r.squaresFound).toBeGreaterThan(8)
    expect(r.grid).toEqual({ cols: layout30.geometry.registrationColumns, rows: expect.any(Number) })
  })
})
