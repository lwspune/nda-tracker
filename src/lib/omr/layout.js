// OMR answer-sheet geometry — pure, deterministic, in millimetres.
//
// THIS MODULE IS THE CONTRACT BETWEEN THE TWO HALVES OF THE SYSTEM. The PDF
// generator draws from it; the reader will sample bubbles from it after
// perspective-correcting a photograph. If the two ever compute geometry
// separately they drift, and a drifted reader silently misreads answers rather
// than failing — the same reasoning that keeps `whatsappResultScore.js` shared
// between the sender and its preview.
//
// ── Ink size is DERIVED, not configured ──────────────────────────────────────
// Evalbee scales its bubbles to the question count: measured across three real
// sheets, a 30-question paper gets generous bubbles and a 150-question paper
// tightens to ⌀2.08 mm at 3.11 mm pitch — and that tight one still reads from a
// 1080×1440 phone photo. So the rule here is "the largest bubble that fits",
// clamped at both ends, rather than one hardcoded size:
//
//   • PITCH_RATIO 1.5  — Evalbee's own ratio, exact from three printable PDFs
//     and identical in all of them: 5.67÷3.78 (30 q), 5.09÷3.39 (30 q two-up),
//     3.11÷2.08 (150 q). Spacing scales with the ink, so a sheet never looks
//     like big bubbles crammed together or small ones adrift.
//   • BUBBLE_MIN_MM 2.0 — their proven floor (the 150-question two-up sheet).
//     Below this we would be betting our reader beats theirs.
//   • BUBBLE_MAX_MM 3.8 — MEASURED, not judged: 3.78 mm is the largest bubble
//     Evalbee draws, on the sparsest sheet it makes (30 questions, one-up, with
//     the whole page to spare). An earlier 5.0 mm here was a guess off a cropped
//     render, and it made sheets look like worksheets.
//
// ── Columns are packed and CENTRED, not stretched ────────────────────────────
// Evalbee's 30-question sheet is a 62 mm block in the middle of a 210 mm page,
// not two columns spread to the margins. Stretching leaves a sparse sheet
// looking half-empty — and shrinking the bubbles to the measured ceiling makes
// that worse, not better. So each column takes its natural width and the block
// is centred.
//
// Registration columns follow the same sheets: ALWAYS question columns + 1
// (30 q → 2 columns → 3; 71 q → 3 → 4; 150 q → 4 → 5).
//
// ── Two-up is ROTATED, like Evalbee's ────────────────────────────────────────
// Each half is turned 90° so its question columns run along the page's 210 mm
// long edge instead of the 148.5 mm short one. Laid out portrait, two-up topped
// out near 116 questions and a full mock could not be printed two to a page;
// turned, capacity is ~188. See `makeTransform`.

export const A4 = { width: 210, height: 297 }

export const PITCH_RATIO = 1.5
export const BUBBLE_MIN_MM = 2.0
export const BUBBLE_MAX_MM = 3.8
const BUBBLE_STEP_MM = 0.05

const MARGIN = 8
const MAX_COLUMNS = 4
const GROUP_SIZE = 5           // questions between repeated "A B C D" captions
const REG_ROW_TARGET = 25      // aim for a registration row about this often
const REG_ROWS_MIN = 5
const HEADER_H_FULL = 18       // NAME / EXAM / DATE block, 1-up
const HEADER_H_HALF = 13       // ditto, 2-up
const HEADER_GAP = 4
const ROLL_DIGITS_DEFAULT = 5
const CUT_MARGIN = 3
// Clearance between the printed question number and the first bubble. There is
// spare margin on the sheet, so this is bought cheaply.
const NUMBER_GAP_RIGHT = 1.8
const NUMBER_GAP_LEFT = 1.0

const round = n => Math.round(n * 1000) / 1000

const PT_PER_MM = 72 / 25.4

/**
 * Type sizes, in points, derived from the bubble diameter.
 *
 * These live HERE rather than in the renderer because they have to scale with
 * the ink: a fixed 7pt looks right at a 3.8mm bubble and collides with itself at
 * 2.85mm, which is what a 150-question two-up sheet uses. Keeping them in the
 * layout also makes the clearances testable.
 */
function fontsFor(diameter) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const base = clamp(diameter * 1.9, 4, 9)
  return {
    number: round(base),
    option: round(base * 0.92),
    roll: round(base),
    header: round(clamp(diameter * 2.4, 6, 11)),
    stamp: round(clamp(diameter * 1.5, 4, 6.5)),
  }
}

/** Height of a line of type, in mm — the conservative bound for clearance. */
export const fontHeightMm = pt => pt / PT_PER_MM
/** Helvetica digits are 0.556em; this is the width of `text` at `pt`. */
export const textWidthMm = (text, pt) => String(text).length * 0.556 * fontHeightMm(pt)

/** Everything else is a multiple of the bubble diameter, so the sheet scales as one piece. */
function geometryFor(diameter) {
  const pitch = diameter * PITCH_RATIO
  const fonts = fontsFor(diameter)
  return {
    fonts,
    diameter: round(diameter),
    radius: round(diameter / 2),
    pitch: round(pitch),
    regSize: round(diameter),          // Evalbee's squares are bubble-sized
    // Wide enough for the largest question number we print, at its own size.
    numberW: round(textWidthMm('000', fonts.number) + NUMBER_GAP_LEFT + NUMBER_GAP_RIGHT),
    // One blank slot per group, as Evalbee does — but never tighter than the
    // A B C D caption that has to sit in it without touching the bubbles.
    groupSlot: round(Math.max(pitch, fontHeightMm(fonts.option) + 1.4)),
    rollLabelH: round(Math.max(3.5, 1.8 * diameter)),
    rollWriteH: round(Math.max(4, 2 * diameter)),
    rollGap: round(Math.max(3, 1.5 * diameter)),
    // Breathing room between the hand-written digit boxes and the first bubble
    // row. Without it the box border lands exactly on the bubbles.
    rollBoxGap: round(Math.max(1.5, 0.6 * diameter)),
  }
}

/**
 * Local sheet coordinates -> page coordinates.
 *
 * A sheet is always laid out in its own frame with the origin at its top-left;
 * this places it. Two-up is ROTATED 90° so each half's columns run along the
 * 210 mm long edge instead of the 148.5 mm short one — which is how Evalbee fits
 * 150 questions two-up, and doing the same here roughly halves the paper for a
 * full mock.
 */
function makeTransform({ rotated, slotX, slotY, localW }) {
  if (!rotated) {
    return {
      rotated: false, angle: 0,
      pt: (x, y) => ({ x: round(slotX + x), y: round(slotY + y) }),
      rect: (x, y, w, h) => ({
        x: round(slotX + x), y: round(slotY + y), width: round(w), height: round(h),
      }),
    }
  }
  // 90° anticlockwise: local (x, y) -> page (slotX + y, slotY + localW - x)
  return {
    rotated: true, angle: 90,
    pt: (x, y) => ({ x: round(slotX + y), y: round(slotY + localW - x) }),
    rect: (x, y, w, h) => ({
      x: round(slotX + y), y: round(slotY + localW - x - w),
      width: round(h), height: round(w),
    }),
  }
}

function questionsHeight(n, g) {
  if (n <= 0) return 0
  return n * g.pitch + Math.ceil(n / GROUP_SIZE) * g.groupSlot
}

function columnCapacity(height, g) {
  let n = 0
  while (questionsHeight(n + 1, g) <= height) n++
  return n
}

function rollHeight(rollDigits, g) {
  if (rollDigits === 0) return 0
  return g.rollLabelH + g.rollWriteH + 10 * g.pitch + g.rollGap
}

function rollWidth(rollDigits, g) {
  if (rollDigits === 0) return 0
  return g.numberW + (rollDigits - 1) * g.pitch + g.diameter
}

function columnWidthNeeded(optionCount, g) {
  return g.numberW + (optionCount - 1) * g.pitch + g.diameter
}

/** The sheet's own frame, in local coordinates (origin top-left of the sheet). */
function localSize(page, perPage) {
  // One-up fills the page. Two-up takes half the page and turns it, so the
  // sheet's long axis runs along the page's 210 mm width.
  return perPage === 1
    ? { localW: page.width, localH: page.height, rotated: false }
    : { localW: page.height / perPage, localH: page.width, rotated: true }
}

function frame(page, perPage, g, columns, optionCount, rollDigits) {
  const { localW, localH } = localSize(page, perPage)
  const sheetH = localH
  const headerH = perPage === 1 ? HEADER_H_FULL : HEADER_H_HALF
  const pad = perPage === 1 ? MARGIN : CUT_MARGIN + 2
  const bodyTop = MARGIN + headerH + HEADER_GAP
  const bodyBottom = sheetH - pad
  const usableW = localW - 2 * MARGIN

  // Natural widths. Column one also carries the roll block, which is one lattice
  // slot wider than a question column (5 digits against 4 options), so it gets
  // whichever is bigger rather than clipping the roll.
  const colW = columnWidthNeeded(optionCount, g)
  const col0W = Math.max(colW, rollWidth(rollDigits, g))
  // Gutter either side of every column. Without it the last bubble's edge lands
  // exactly on the next registration square, and a square's CORNER then overlaps
  // the bubble — which is what the 30-question sheet shipped with.
  const gutter = round(g.diameter * 0.6)
  const blockW = col0W + (columns - 1) * colW + (columns + 1) * g.regSize + 2 * columns * gutter
  const startX = MARGIN + (usableW - blockW) / 2

  return {
    sheetH, headerH, bodyTop, bodyBottom, bodyHeight: bodyBottom - bodyTop,
    colW, col0W, blockW, startX, usableW, gutter, fits: blockW <= usableW,
  }
}

function capacityAt(page, perPage, g, columns, rollDigits, optionCount) {
  const f = frame(page, perPage, g, columns, optionCount, rollDigits)
  if (f.bodyHeight <= 0 || !f.fits) return 0
  const first = columnCapacity(f.bodyHeight - rollHeight(rollDigits, g), g)
  const rest = columnCapacity(f.bodyHeight, g)
  return first + rest * (columns - 1)
}

/**
 * Largest bubble that holds `questionCount`, and the fewest columns to do it in.
 * Iterating the diameter downwards means the first fit IS the largest.
 */
function chooseGeometry({ questionCount, optionCount, rollDigits, page, perPage }) {
  for (let d = BUBBLE_MAX_MM; d >= BUBBLE_MIN_MM - 1e-9; d -= BUBBLE_STEP_MM) {
    const g = geometryFor(d)
    for (let columns = 1; columns <= MAX_COLUMNS; columns++) {
      if (capacityAt(page, perPage, g, columns, rollDigits, optionCount) >= questionCount) {
        return { g, columns }
      }
    }
  }
  return null
}

/** Most questions a sheet can hold — i.e. capacity at the smallest readable bubble. */
export function sheetCapacity({
  page = A4, perPage = 1, rollDigits = ROLL_DIGITS_DEFAULT, optionCount = 4,
} = {}) {
  const g = geometryFor(BUBBLE_MIN_MM)
  let best = 0
  for (let columns = 1; columns <= MAX_COLUMNS; columns++) {
    best = Math.max(best, capacityAt(page, perPage, g, columns, rollDigits, optionCount))
  }
  return best
}

/** Column origins for a packed block centred on the page. */
function columnXs(g, columns, f) {
  const contentX = [], regX = []
  let x = f.startX
  for (let c = 0; c < columns; c++) {
    regX.push(round(x))
    x += g.regSize + f.gutter
    contentX.push(round(x))
    x += (c === 0 ? f.col0W : f.colW) + f.gutter
  }
  regX.push(round(x))
  return { contentX, regX }
}

/**
 * Share questions out in proportion to each column's capacity.
 *
 * Filling each column to the brim in turn produced splits like 8 / 19 / 3, which
 * wastes a third of the sheet on three questions.
 */
function splitAcrossColumns(questionCount, columns, firstCap, restCap) {
  const caps = [firstCap, ...Array(columns - 1).fill(restCap)]
  const total = caps.reduce((a, b) => a + b, 0)
  const out = caps.map(c => Math.floor((c / total) * questionCount))
  let left = questionCount - out.reduce((a, b) => a + b, 0)
  while (left > 0) {
    let best = 0
    for (let i = 1; i < out.length; i++) {
      if (caps[i] - out[i] > caps[best] - out[best]) best = i
    }
    out[best]++
    left--
  }
  return out
}

function buildRollBlock(topY, x, rollDigits, g, T) {
  const labelY = topY
  const writeY = labelY + g.rollLabelH
  // rollBoxGap keeps the hand-written digit boxes off the first bubble row.
  const firstBubbleY = writeY + g.rollWriteH + g.rollBoxGap + g.radius
  const columns = []
  for (let d = 0; d < rollDigits; d++) {
    const cx = x + g.numberW + g.radius + d * g.pitch
    columns.push({
      index: d,
      writeBox: T.rect(x + g.numberW + d * g.pitch, writeY, g.pitch, g.rollWriteH),
      bubbles: Array.from({ length: 10 }, (_, v) => ({
        value: v, ...T.pt(cx, firstBubbleY + v * g.pitch), r: g.radius,
      })),
    })
  }
  return {
    label: { text: 'Roll No', ...T.pt(x + g.numberW, labelY) },
    digitLabels: Array.from({ length: 10 }, (_, v) => ({
      value: v,
      ...T.pt(
        x + g.numberW - NUMBER_GAP_RIGHT - textWidthMm(String(v), g.fonts.roll),
        firstBubbleY + v * g.pitch,
      ),
    })),
    columns,
  }
}

function buildSheet({ page, perPage, index, questionCount, optionLabels, rollDigits, g, columns }) {
  const f = frame(page, perPage, g, columns, optionLabels.length, rollDigits)
  const { localW, localH, rotated } = localSize(page, perPage)
  // Two-up stacks the halves down the page; one-up is the whole page.
  const T = makeTransform({
    rotated,
    slotX: 0,
    slotY: rotated ? index * (page.height / perPage) : 0,
    localW,
  })
  const { contentX, regX } = columnXs(g, columns, f)

  const firstCap = columnCapacity(f.bodyHeight - rollHeight(rollDigits, g), g)
  const restCap = columnCapacity(f.bodyHeight, g)
  const perColumn = splitAcrossColumns(questionCount, columns, firstCap, restCap)
  const roll = buildRollBlock(f.bodyTop, contentX[0], rollDigits, g, T)

  const questions = []
  const localInk = []          // local y of every bubble, for sizing the grid
  let q = 1
  perColumn.forEach((count, col) => {
    const x = contentX[col]
    let y = f.bodyTop + (col === 0 ? rollHeight(rollDigits, g) : 0)
    for (let i = 0; i < count; i++) {
      if (i % GROUP_SIZE === 0) y += g.groupSlot
      const cy = y + g.radius
      localInk.push(cy)
      // Anchors are the START of the text, computed here from its measured
      // width. The renderer must NOT use jsPDF's align under rotation: `right`
      // does not shift the anchor back along a rotated baseline, so a 3-digit
      // number ran forward INTO the bubbles while a 2-digit one did not.
      const numW = textWidthMm(String(q), g.fonts.number)
      questions.push({
        q,
        ...T.pt(x, cy),
        numberAnchor: T.pt(x + g.numberW - NUMBER_GAP_RIGHT - numW, cy),
        groupHeader: i % GROUP_SIZE === 0
          ? {
            labels: optionLabels,
            anchors: optionLabels.map((label, oi) =>
              T.pt(
                x + g.numberW + g.radius + oi * g.pitch
                  - textWidthMm(label, g.fonts.option) / 2,
                y - g.groupSlot / 2,
              )),
          }
          : null,
        options: optionLabels.map((label, oi) => ({
          label,
          ...T.pt(x + g.numberW + g.radius + oi * g.pitch, cy),
          r: g.radius,
        })),
      })
      y += g.pitch
      q++
    }
  })

  // The registration grid frames the CONTENT, not the page. Running it to the
  // page bottom leaves rows of squares under an empty half-sheet, which reads as
  // a misprint; Evalbee's 30-question grid likewise spans only its own block.
  const rollLastY = f.bodyTop + g.rollLabelH + g.rollWriteH + g.rollBoxGap + 9.5 * g.pitch
  const lastInk = Math.max(...localInk, rollDigits ? rollLastY : 0)
  const top = f.bodyTop
  const bottom = Math.min(f.bodyBottom - g.regSize, lastInk + g.radius + f.gutter)
  const rowCount = Math.max(REG_ROWS_MIN, Math.round((bottom - top) / REG_ROW_TARGET) + 1)
  const step = (bottom - top) / (rowCount - 1)
  const regY = Array.from({ length: rowCount }, (_, i) => top + i * step)

  const square = (x, y) => {
    const r = T.rect(x, y, g.regSize, g.regSize)
    return { x: r.x, y: r.y, size: g.regSize }
  }
  const registration = []
  for (const y of regY) for (const x of regX) registration.push(square(x, y))

  const [minX, maxX] = [regX[0], regX[regX.length - 1]]
  const [minY, maxY] = [regY[0], regY[regY.length - 1]]
  // Corner names are the SHEET's corners, which is what the reader needs — after
  // rotation they are no longer the page's corners.
  const anchors = [
    { ...square(minX, minY), corner: 'topLeft' },
    { ...square(maxX, minY), corner: 'topRight' },
    { ...square(minX, maxY), corner: 'bottomLeft' },
    { ...square(maxX, maxY), corner: 'bottomRight' },
  ]

  const fields = ['NAME', 'EXAM', 'DATE']
  const rowH = f.headerH / fields.length
  const headerW = localW - 2 * MARGIN

  return {
    index,
    rotated,
    textAngle: T.angle,
    // The grid in the SHEET's own columns and rows. Stated rather than left to
    // be counted, because counting distinct page x/y only gives this for an
    // unrotated sheet — a turned two-up sheet's rows ARE its distinct page x.
    grid: { cols: regX.length, rows: regY.length },
    width: round(localW),
    height: round(localH),
    header: {
      ...T.rect(MARGIN, MARGIN, headerW, f.headerH),
      fields,
      rows: fields.map((label, i) => ({
        label,
        ...T.rect(MARGIN, MARGIN + i * rowH, headerW, rowH),
        labelAnchor: T.pt(MARGIN + 2.5, MARGIN + i * rowH + rowH / 2 + 1),
      })),
      stampAnchor: T.pt(MARGIN + headerW - 2, MARGIN - 1.2),
    },
    roll,
    questions,
    registration,
    anchors,
  }
}

/**
 * Build the full page layout.
 *
 * @param {object}   opts
 * @param {number}   opts.questionCount
 * @param {string[]} [opts.optionLabels]  defaults to A-D
 * @param {number}   [opts.rollDigits]    roll-number bubble columns (default 5)
 * @param {object}   [opts.page]          page size in mm (default A4)
 * @param {number}   [opts.perPage]       1 or 2 sheets per page
 * @returns {{unit:'mm', page, perPage, geometry, cutLine, sheets}}
 */
export function buildSheetLayout({
  questionCount,
  optionLabels = ['A', 'B', 'C', 'D'],
  rollDigits = ROLL_DIGITS_DEFAULT,
  page = A4,
  perPage = 1,
} = {}) {
  if (!Number.isInteger(questionCount) || questionCount < 1) {
    throw new Error(`questionCount must be a positive integer, got ${questionCount}`)
  }
  if (perPage !== 1 && perPage !== 2) {
    throw new Error(`perPage must be 1 or 2, got ${perPage}`)
  }

  const chosen = chooseGeometry({
    questionCount, optionCount: optionLabels.length, rollDigits, page, perPage,
  })
  if (!chosen) {
    // Refuse rather than shrink past the floor: a bubble a phone cannot resolve
    // makes a sheet that prints perfectly and can never be read.
    throw new Error(
      `capacity exceeded: ${questionCount} questions do not fit a ${page.width}×${page.height}mm ` +
      `sheet at ${perPage}-up (max ${sheetCapacity({ page, perPage, rollDigits, optionCount: optionLabels.length })} ` +
      `at the ${BUBBLE_MIN_MM}mm bubble floor). Use perPage: 1 or split the paper.`
    )
  }
  const { g, columns } = chosen

  const sheets = Array.from({ length: perPage }, (_, index) =>
    buildSheet({ page, perPage, index, questionCount, optionLabels, rollDigits, g, columns })
  )

  return {
    unit: 'mm',
    page: { width: page.width, height: page.height },
    perPage,
    geometry: {
      bubbleDiameter: g.diameter,
      bubbleRadius: g.radius,
      pitch: g.pitch,
      registrationSize: g.regSize,
      columns,
      registrationColumns: columns + 1,
      registrationRows: sheets[0].grid.rows,
      fonts: g.fonts,
    },
    cutLine: perPage === 2 ? round(page.height / 2) : null,
    sheets,
  }
}
