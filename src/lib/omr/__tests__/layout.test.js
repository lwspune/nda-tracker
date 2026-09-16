import { describe, it, expect } from 'vitest'
import {
  buildSheetLayout, sheetCapacity, A4,
  PITCH_RATIO, BUBBLE_MIN_MM, BUBBLE_MAX_MM,
  fontHeightMm, textWidthMm,
} from '../layout'

// The layout is the SHARED source of truth: the generator draws from it and the
// reader will sample bubbles from it after perspective-correcting a photo. So
// these tests pin geometry, not pixels — a silent change here would desync the
// two halves of the system.

const allBubbles = sheet => [
  ...sheet.roll.columns.flatMap(c => c.bubbles),
  ...sheet.questions.flatMap(q => q.options),
]

describe('buildSheetLayout — question grid', () => {
  it('places every question exactly once, with one bubble per option', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    const qs = sheets[0].questions
    expect(qs).toHaveLength(150)
    expect(qs.map(q => q.q)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1))
    for (const q of qs) {
      expect(q.options.map(o => o.label)).toEqual(['A', 'B', 'C', 'D'])
    }
  })

  it('fits 150 questions on ONE A4 sheet — the load-bearing claim', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    expect(sheets).toHaveLength(1)
    expect(sheetCapacity({ page: A4, perPage: 1 })).toBeGreaterThanOrEqual(150)
  })

  it('orders questions column-major, so Q1 is top-left and the last is rightmost', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    const qs = sheets[0].questions
    const first = qs[0], last = qs[149]
    expect(last.x).toBeGreaterThan(first.x)
    // within a column, question numbers increase downwards
    const col0 = qs.filter(q => Math.abs(q.x - first.x) < 0.01)
    const ys = col0.map(q => q.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    expect(col0.map(q => q.q)).toEqual([...col0.map(q => q.q)].sort((a, b) => a - b))
  })

  it('leaves the first column shorter, because the roll block sits above it', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    const qs = sheets[0].questions
    const xs = [...new Set(qs.map(q => Math.round(q.x * 100) / 100))].sort((a, b) => a - b)
    const counts = xs.map(x => qs.filter(q => Math.abs(q.x - x) < 0.01).length)
    expect(counts[0]).toBeLessThan(counts[1])
  })

  it('balances the columns it uses instead of packing each one full in turn', () => {
    // Packing in order gave splits like 8 / 19 / 3 — a third of the sheet spent
    // on three questions.
    const { sheets } = buildSheetLayout({ questionCount: 30, perPage: 2 })
    const qs = sheets[0].questions
    const xs = [...new Set(qs.map(q => q.x))].sort((a, b) => a - b)
    const counts = xs.map(x => qs.filter(q => q.x === x).length)
    const trailing = counts.slice(1)
    expect(Math.max(...trailing) - Math.min(...trailing)).toBeLessThanOrEqual(1)
  })

  it('supports a short paper without stranding it across four columns', () => {
    const { sheets } = buildSheetLayout({ questionCount: 30 })
    const qs = sheets[0].questions
    expect(qs).toHaveLength(30)
    const xs = new Set(qs.map(q => Math.round(q.x * 100) / 100))
    expect(xs.size).toBeLessThanOrEqual(2)
  })

  it('refuses a paper it cannot lay out rather than overflowing the page', () => {
    const cap = sheetCapacity({ page: A4, perPage: 1 })
    expect(() => buildSheetLayout({ questionCount: cap + 1 })).toThrow(/capacity/i)
  })
})

describe('buildSheetLayout — everything stays on the page and apart', () => {
  it('keeps every drawn element inside the page bounds', () => {
    for (const [perPage, questionCount] of [[1, 150], [2, 30]]) {
      const { page, sheets } = buildSheetLayout({ questionCount, perPage })
      for (const sheet of sheets) {
        for (const b of allBubbles(sheet)) {
          expect(b.x - b.r).toBeGreaterThanOrEqual(0)
          expect(b.y - b.r).toBeGreaterThanOrEqual(0)
          expect(b.x + b.r).toBeLessThanOrEqual(page.width)
          expect(b.y + b.r).toBeLessThanOrEqual(page.height)
        }
        for (const s of sheet.registration) {
          expect(s.x).toBeGreaterThanOrEqual(0)
          expect(s.y).toBeGreaterThanOrEqual(0)
          expect(s.x + s.size).toBeLessThanOrEqual(page.width)
          expect(s.y + s.size).toBeLessThanOrEqual(page.height)
        }
      }
    }
  })

  it('never overlaps two bubbles', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    const bs = allBubbles(sheets[0])
    // grid-bucket so this stays O(n) rather than 600^2
    const cell = 8, buckets = new Map()
    const key = (i, j) => `${i},${j}`
    for (const b of bs) {
      const i = Math.floor(b.x / cell), j = Math.floor(b.y / cell)
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const k = key(i + di, j + dj)
        if (!buckets.has(k)) buckets.set(k, [])
      }
      buckets.get(key(i, j)).push(b)
    }
    let checked = 0
    for (const b of bs) {
      const i = Math.floor(b.x / cell), j = Math.floor(b.y / cell)
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        for (const o of buckets.get(key(i + di, j + dj)) || []) {
          if (o === b) continue
          checked++
          const d = Math.hypot(o.x - b.x, o.y - b.y)
          expect(d).toBeGreaterThanOrEqual(b.r + o.r)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)   // the check actually ran
  })

  it('keeps bubbles clear of the registration squares the reader locks onto', () => {
    // A square is a BOX, not a circle of radius size/2 — its corners reach
    // size/√2. Approximating it as that inscribed circle let a corner overlap a
    // bubble and still pass, which is exactly what shipped at 30 questions.
    // Measure true box-to-circle distance instead.
    for (const questionCount of [30, 71, 150]) {
      const { sheets } = buildSheetLayout({ questionCount })
      for (const sheet of sheets) {
        for (const s of sheet.registration) {
          for (const b of allBubbles(sheet)) {
            const dx = Math.max(s.x - b.x, 0, b.x - (s.x + s.size))
            const dy = Math.max(s.y - b.y, 0, b.y - (s.y + s.size))
            const gap = Math.hypot(dx, dy) - b.r
            expect(gap).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})

// Ink size is derived from how full the sheet is, mirroring Evalbee: a sparse
// paper gets generous bubbles, a dense one tightens toward the readable floor.
describe('buildSheetLayout — adaptive bubble sizing', () => {
  it('never exceeds the ergonomic ceiling, however empty the sheet', () => {
    for (const questionCount of [5, 10, 20, 30]) {
      const { geometry } = buildSheetLayout({ questionCount })
      expect(geometry.bubbleDiameter).toBeLessThanOrEqual(BUBBLE_MAX_MM)
    }
  })

  it('never drops below the readable floor', () => {
    for (const [questionCount, perPage] of [[150, 1], [110, 2], [60, 2]]) {
      const { geometry } = buildSheetLayout({ questionCount, perPage })
      expect(geometry.bubbleDiameter).toBeGreaterThanOrEqual(BUBBLE_MIN_MM)
    }
  })

  it('shrinks the ink as the paper fills, never the other way round', () => {
    const sizes = [10, 30, 71, 150].map(n => buildSheetLayout({ questionCount: n }).geometry.bubbleDiameter)
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1])
    expect(sizes[0]).toBeGreaterThan(sizes[3])   // and it genuinely varies
  })

  it('keeps pitch locked to Evalbee’s 1.5x ratio, so spacing scales with the ink', () => {
    for (const questionCount of [10, 71, 150]) {
      const { geometry } = buildSheetLayout({ questionCount })
      expect(geometry.pitch).toBeCloseTo(geometry.bubbleDiameter * PITCH_RATIO, 2)
    }
  })

  it('uses the fewest columns it can, and one more registration column than that', () => {
    for (const questionCount of [10, 30, 71, 150]) {
      const layout = buildSheetLayout({ questionCount })
      const qs = layout.sheets[0].questions
      const usedColumns = new Set(qs.map(q => q.x)).size
      expect(layout.geometry.columns).toBe(usedColumns)
      expect(layout.geometry.registrationColumns).toBe(usedColumns + 1)
      const regCols = new Set(layout.sheets[0].registration.map(r => r.x)).size
      expect(regCols).toBe(usedColumns + 1)
    }
  })
})

// Type has to clear the ink. Font sizes were fixed at 7pt while the geometry
// scaled, so a 150-question two-up sheet (2.85mm bubbles) crowded its own
// numbers and captions — invisible to every geometry test, because none of them
// knew how big the text was.
describe('buildSheetLayout — type clears the bubbles', () => {
  /**
   * Page-space box of a line of text.
   *
   * Anchors are the START of the text and it always runs FORWARD from there —
   * upward on a rotated sheet, rightward otherwise. Verified against the text
   * matrices jsPDF actually emits (`Tm` = [0 1 -1 0] at 90°), not assumed: an
   * earlier version modelled jsPDF's `align` shifting the anchor backwards,
   * which is not what it does under rotation, and the test inherited the same
   * wrong model as the code so it agreed with the bug.
   */
  const textBox = (anchor, str, pt, rotated) => {
    const w = textWidthMm(str, pt), h = fontHeightMm(pt)
    return rotated
      ? { x0: anchor.x - h / 2, x1: anchor.x + h / 2, y0: anchor.y - w, y1: anchor.y }
      : { x0: anchor.x, x1: anchor.x + w, y0: anchor.y - h / 2, y1: anchor.y + h / 2 }
  }
  const clears = (box, b) => {
    const dx = Math.max(box.x0 - b.x, 0, b.x - box.x1)
    const dy = Math.max(box.y0 - b.y, 0, b.y - box.y1)
    return Math.hypot(dx, dy) > b.r
  }

  const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

  // Two real hazards, both of which have actually bitten:
  //   1. the number running forward INTO its own bubbles (3-digit numbers did,
  //      by 0.92mm, measured out of the emitted PDF)
  //   2. adjacent numbers colliding with EACH OTHER at tight pitch
  for (const [questionCount, perPage] of [[30, 1], [71, 1], [150, 1], [150, 2], [30, 2]]) {
    it(`keeps question numbers off the bubbles and apart (${questionCount}q, ${perPage}-up)`, () => {
      const layout = buildSheetLayout({ questionCount, perPage })
      const { fonts } = layout.geometry
      for (const sheet of layout.sheets) {
        const bubbles = sheet.questions.flatMap(q => q.options)
        const boxes = sheet.questions.map(q =>
          textBox(q.numberAnchor, q.q, fonts.number, sheet.rotated))
        boxes.forEach(box => {
          for (const b of bubbles) expect(clears(box, b)).toBe(true)
        })
        for (let i = 1; i < boxes.length; i++) {
          expect(overlap(boxes[i - 1], boxes[i])).toBe(false)
        }
      }
    })
  }

  it('the spacing check can fail — inflating the type collides the numbers', () => {
    // A check that has never gone red is not evidence.
    const layout = buildSheetLayout({ questionCount: 150, perPage: 2 })
    const sheet = layout.sheets[0]
    const blown = sheet.questions.map(q =>
      textBox(q.numberAnchor, q.q, layout.geometry.fonts.number * 3, sheet.rotated))
    const hits = blown.filter((b, i) => i > 0 && overlap(blown[i - 1], b)).length
    expect(hits).toBeGreaterThan(0)

    // and the bubble-clearance arm goes red too — text runs FORWARD from its
    // anchor, so a bigger font reaches into the bubbles. That is the exact
    // defect that shipped: 3-digit numbers, 0.92mm in.
    const bubbles = sheet.questions.flatMap(q => q.options)
    const onBubbles = blown.filter(box => bubbles.some(b => !clears(box, b))).length
    expect(onBubbles).toBeGreaterThan(0)
  })

  // Collisions are COLLECTED and asserted once, not asserted per pair. This
  // compares every caption against every bubble on a 150-question sheet, three
  // sheets over — about 216,000 pairs. The geometry costs milliseconds; 216,000
  // `expect` calls cost seconds, and on a loaded machine that overran the 5s
  // default and reported a timeout, which reads as "something broke" when
  // nothing had. One assertion is also the only way a failure can say WHICH
  // caption landed on which bubble; per-pair it could only ever say
  // "expected false to be true".
  it('keeps the A B C D caption clear of the bubbles it labels', () => {
    const collisions = []
    for (const [questionCount, perPage] of [[150, 1], [150, 2]]) {
      const layout = buildSheetLayout({ questionCount, perPage })
      const { fonts } = layout.geometry
      for (const sheet of layout.sheets) {
        const bubbles = sheet.questions.flatMap(q => q.options)
        for (const q of sheet.questions) {
          if (!q.groupHeader) continue
          q.groupHeader.labels.forEach((label, i) => {
            const box = textBox(q.groupHeader.anchors[i], label, fonts.option, sheet.rotated)
            // Every bubble is still tested; only the first offender per caption
            // is reported, so a regression names the caption instead of burying
            // it in hundreds of lines about the same one.
            const hit = bubbles.find(b => !clears(box, b))
            if (hit) {
              collisions.push(
                `${questionCount}q ${perPage}-up sheet ${sheet.index}: ` +
                `caption "${label}" above Q${q.q} touches the bubble at ${hit.x},${hit.y}`)
            }
          })
        }
      }
    }
    expect(collisions).toEqual([])
  })

  it('shrinks the type along with the ink', () => {
    const big = buildSheetLayout({ questionCount: 30 }).geometry
    const small = buildSheetLayout({ questionCount: 150, perPage: 2 }).geometry
    expect(small.bubbleDiameter).toBeLessThan(big.bubbleDiameter)
    expect(small.fonts.number).toBeLessThan(big.fonts.number)
  })
})

describe('buildSheetLayout — registration grid', () => {
  it('lays registration squares in a full grid of columns and rows', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    const reg = sheets[0].registration
    const xs = [...new Set(reg.map(s => Math.round(s.x * 100) / 100))]
    const ys = [...new Set(reg.map(s => Math.round(s.y * 100) / 100))]
    expect(xs.length).toBeGreaterThanOrEqual(5)
    expect(ys.length).toBeGreaterThanOrEqual(8)
    expect(reg).toHaveLength(xs.length * ys.length)
  })

  it('frames the content rather than the page, so a sparse sheet has no orphan squares', () => {
    // Running the grid to the page bottom left rows of squares under an empty
    // half-sheet, which reads as a misprint.
    const { sheets } = buildSheetLayout({ questionCount: 20 })
    const sheet = sheets[0]
    const lastInk = Math.max(...sheet.questions.map(q => q.y + q.options[0].r))
    const lastSquare = Math.max(...sheet.registration.map(s => s.y + s.size))
    expect(lastSquare).toBeGreaterThan(lastInk)          // still frames it
    expect(lastSquare - lastInk).toBeLessThan(15)        // but does not run on
  })

  it('names exactly four corner anchors, one per corner', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150 })
    const { anchors, registration } = sheets[0]
    expect(anchors).toHaveLength(4)
    const xs = registration.map(s => s.x), ys = registration.map(s => s.y)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    expect(new Set(anchors.map(a => `${a.x === minX ? 'L' : 'R'}${a.y === minY ? 'T' : 'B'}`)))
      .toEqual(new Set(['LT', 'RT', 'LB', 'RB']))
    for (const a of anchors) {
      expect([minX, maxX]).toContain(a.x)
      expect([minY, maxY]).toContain(a.y)
    }
  })
})

describe('buildSheetLayout — roll number block', () => {
  it('gives one column per digit, each with bubbles 0-9', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150, rollDigits: 5 })
    const { columns } = sheets[0].roll
    expect(columns).toHaveLength(5)
    for (const c of columns) {
      expect(c.bubbles.map(b => b.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })

  it('encodes a roll number as one bubble per column, in order', () => {
    const { sheets } = buildSheetLayout({ questionCount: 150, rollDigits: 5 })
    const cols = sheets[0].roll.columns
    // "00048" -> column 0..4 take digits 0,0,0,4,8
    const digits = '00048'.split('').map(Number)
    const picked = digits.map((d, i) => cols[i].bubbles.find(b => b.value === d))
    expect(picked.every(Boolean)).toBe(true)
    const xs = picked.map(p => p.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)   // left-to-right = most significant first
  })
})

// 2-up halves the usable height, so it only serves SHORT papers — a 150-question
// sheet cannot be printed two to a page and the layout must say so rather than
// shrink the bubbles until a phone can't read them.
describe('buildSheetLayout — 2-up printing', () => {
  it('puts two complete, independent sheets on one A4', () => {
    const { sheets } = buildSheetLayout({ questionCount: 30, perPage: 2 })
    expect(sheets).toHaveLength(2)
    for (const s of sheets) {
      expect(s.questions).toHaveLength(30)
      expect(s.roll.columns).toHaveLength(5)
      expect(s.anchors).toHaveLength(4)
    }
  })

  it('fits a full 150-question mock 2-up, by turning the sheet like Evalbee does', () => {
    // The rotation is the whole point: a half-page's columns run along the
    // 210mm long edge rather than the 148.5mm short one. Portrait 2-up topped
    // out near 116, which is why a full mock could not be printed two to a page.
    const { sheets, geometry } = buildSheetLayout({ questionCount: 150, perPage: 2 })
    expect(sheets).toHaveLength(2)
    for (const s of sheets) {
      expect(s.questions).toHaveLength(150)
      expect(s.rotated).toBe(true)
      expect(s.textAngle).toBe(90)
    }
    expect(geometry.bubbleDiameter).toBeGreaterThanOrEqual(BUBBLE_MIN_MM)
  })

  it('leaves a one-up sheet unrotated', () => {
    const { sheets } = buildSheetLayout({ questionCount: 100, perPage: 1 })
    expect(sheets[0].rotated).toBe(false)
    expect(sheets[0].textAngle).toBe(0)
  })

  it('keeps the two halves from overlapping, so a cut separates them cleanly', () => {
    const { sheets, cutLine } = buildSheetLayout({ questionCount: 30, perPage: 2 })
    const [a, b] = sheets
    const bottomOfA = Math.max(...allBubbles(a).map(x => x.y + x.r),
                               ...a.registration.map(s => s.y + s.size))
    const topOfB = Math.min(...allBubbles(b).map(x => x.y - x.r),
                            ...b.registration.map(s => s.y))
    expect(bottomOfA).toBeLessThan(topOfB)
    expect(cutLine).toBeGreaterThan(bottomOfA)
    expect(cutLine).toBeLessThan(topOfB)
  })

  it('halves the per-sheet capacity, and says so', () => {
    expect(sheetCapacity({ page: A4, perPage: 2 }))
      .toBeLessThan(sheetCapacity({ page: A4, perPage: 1 }))
  })
})

describe('buildSheetLayout — contract stability', () => {
  it('is deterministic: the reader can rely on identical geometry', () => {
    const a = buildSheetLayout({ questionCount: 150 })
    const b = buildSheetLayout({ questionCount: 150 })
    expect(a).toEqual(b)
  })

  it('reports dimensions in millimetres', () => {
    const { page, unit } = buildSheetLayout({ questionCount: 30 })
    expect(unit).toBe('mm')
    expect(page).toEqual({ width: 210, height: 297 })
  })
})

// ── The header stamp ─────────────────────────────────────────────────────────
//
// The stamp is the only thing on the paper that says which layout printed it,
// and sheetPdf.js keeps it there precisely so a version or length mismatch is
// "diagnosable by eye". It shipped anchored at the RIGHT edge of the header and
// drawn left-to-right from there, so 34.7mm of text started 10mm from the edge
// and all but `OMR v1 ·` ran off the paper. Two-up was worse than cosmetic: the
// bottom half's stamp crossed the cut line and printed its tail across the top
// half, so a cut sheet carried the WRONG paper's identity.
describe('buildSheetLayout — the header stamp', () => {
  // The renderer measures the text, so the layout cannot place it; what the
  // layout owes is the run the text has to fit in, and the direction to lay it
  // back along. Without the axis the renderer would have to know that a rotated
  // sheet's +x is the page's -y, which is exactly the transform knowledge this
  // module exists to keep in one place.
  it('gives the stamp a run that ends inside the sheet, both formats', () => {
    for (const perPage of [1, 2]) {
      const { sheets } = buildSheetLayout({ questionCount: 25, perPage })
      for (const sheet of sheets) {
        const { stampEnd, stampMaxWidth } = sheet.header
        expect(stampMaxWidth).toBeGreaterThan(20)
        // Walking the full run back from the end must stay on the sheet.
        const start = {
          x: stampEnd.x - stampMaxWidth * sheet.axis.x,
          y: stampEnd.y - stampMaxWidth * sheet.axis.y,
        }
        for (const p of [stampEnd, start]) {
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.y).toBeGreaterThanOrEqual(0)
          expect(p.x).toBeLessThanOrEqual(210)
          expect(p.y).toBeLessThanOrEqual(297)
        }
      }
    }
  })

  it('keeps each half’s stamp run on its own side of the cut', () => {
    const { sheets, cutLine } = buildSheetLayout({ questionCount: 25, perPage: 2 })
    const [top, bottom] = sheets
    const runOf = sheet => {
      const { stampEnd, stampMaxWidth } = sheet.header
      const start = {
        x: stampEnd.x - stampMaxWidth * sheet.axis.x,
        y: stampEnd.y - stampMaxWidth * sheet.axis.y,
      }
      return [Math.min(start.y, stampEnd.y), Math.max(start.y, stampEnd.y)]
    }
    expect(runOf(top)[1]).toBeLessThan(cutLine)
    expect(runOf(bottom)[0]).toBeGreaterThan(cutLine)
  })

  it('reports the sheet’s own +x axis, in page millimetres', () => {
    const flat = buildSheetLayout({ questionCount: 25, perPage: 1 }).sheets[0]
    // One-up: the sheet's left-to-right IS the page's.
    expect(flat.axis.x).toBeCloseTo(1, 6)
    expect(flat.axis.y).toBeCloseTo(0, 6)

    // Two-up is turned 90° anticlockwise, so reading-right runs UP the page.
    const turned = buildSheetLayout({ questionCount: 25, perPage: 2 }).sheets[0]
    expect(turned.axis.x).toBeCloseTo(0, 6)
    expect(turned.axis.y).toBeCloseTo(-1, 6)
  })
})

// ── The grid shape the reader checks against ─────────────────────────────────
//
// The reader used to re-derive this by counting distinct page x and y, which is
// only the sheet's own columns and rows when the sheet is unrotated. Stating it
// here means there is one answer, and the reader cannot disagree with the sheet
// it is reading.
describe('buildSheetLayout — registration grid shape', () => {
  it('states its own grid, in the SHEET’s columns and rows', () => {
    for (const [perPage, want] of [[1, { cols: 2, rows: 11 }], [2, { cols: 3, rows: 7 }]]) {
      const L = buildSheetLayout({ questionCount: 25, perPage })
      expect({
        cols: L.geometry.registrationColumns,
        rows: L.geometry.registrationRows,
      }).toEqual(want)
      // and it agrees with the squares actually drawn
      expect(L.sheets[0].registration).toHaveLength(want.cols * want.rows)
    }
  })

  it('counts rows along the sheet, not along the page', () => {
    // A two-up sheet is rotated, so its rows are distinct page X values and its
    // columns are distinct page Y ones — the opposite of the flat case.
    const s = buildSheetLayout({ questionCount: 25, perPage: 2 }).sheets[0]
    const xs = new Set(s.registration.map(r => r.x)).size
    const ys = new Set(s.registration.map(r => r.y)).size
    expect({ xs, ys }).toEqual({ xs: 7, ys: 3 })
  })
})
