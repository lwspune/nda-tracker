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
// ── Why our 2-up capacity is lower than Evalbee's ────────────────────────────
// Evalbee fits 150 questions two-up; we top out around 116. They do it by
// AUTHORING the 2-up sheet in landscape — its question columns run along the
// 156 mm long edge of the half-page, where ours run down the 118 mm short edge.
// Supporting that means a transposed layout, and it only pays off at the
// ~2 mm floor, which is the least proven density. Deferred until Phase B shows
// what our reader can actually resolve. 2-up still covers normal class tests.

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

const round = n => Math.round(n * 1000) / 1000

/** Everything else is a multiple of the bubble diameter, so the sheet scales as one piece. */
function geometryFor(diameter) {
  const pitch = diameter * PITCH_RATIO
  return {
    diameter: round(diameter),
    radius: round(diameter / 2),
    pitch: round(pitch),
    regSize: round(diameter),          // Evalbee's squares are bubble-sized
    numberW: round(Math.max(6, 3.2 * diameter)),
    groupSlot: round(pitch),           // one blank slot per group, as Evalbee does
    rollLabelH: round(Math.max(3.5, 1.8 * diameter)),
    rollWriteH: round(Math.max(4, 2 * diameter)),
    rollGap: round(Math.max(3, 1.5 * diameter)),
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

function frame(page, perPage, g, columns, optionCount, rollDigits) {
  const sheetH = page.height / perPage
  const headerH = perPage === 1 ? HEADER_H_FULL : HEADER_H_HALF
  const pad = perPage === 1 ? MARGIN : CUT_MARGIN + 2
  const bodyTop = MARGIN + headerH + HEADER_GAP
  const bodyBottom = sheetH - pad
  const usableW = page.width - 2 * MARGIN

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

function buildRollBlock(originY, x, rollDigits, g) {
  const labelY = originY
  const writeY = labelY + g.rollLabelH
  const firstBubbleY = writeY + g.rollWriteH + g.radius
  const columns = []
  for (let d = 0; d < rollDigits; d++) {
    const cx = round(x + g.numberW + g.radius + d * g.pitch)
    columns.push({
      index: d,
      writeBox: {
        x: round(x + g.numberW + d * g.pitch), y: round(writeY),
        width: round(g.pitch), height: round(g.rollWriteH),
      },
      bubbles: Array.from({ length: 10 }, (_, v) => ({
        value: v, x: cx, y: round(firstBubbleY + v * g.pitch), r: g.radius,
      })),
    })
  }
  return {
    label: { text: 'Roll No', x: round(x + g.numberW), y: round(labelY) },
    digitLabels: Array.from({ length: 10 }, (_, v) => ({
      value: v, x: round(x + g.numberW - 1.2), y: round(firstBubbleY + v * g.pitch),
    })),
    columns,
  }
}

function buildSheet({ page, perPage, index, questionCount, optionLabels, rollDigits, g, columns }) {
  const f = frame(page, perPage, g, columns, optionLabels.length, rollDigits)
  const originY = index * f.sheetH
  const { contentX, regX } = columnXs(g, columns, f)

  const firstCap = columnCapacity(f.bodyHeight - rollHeight(rollDigits, g), g)
  const restCap = columnCapacity(f.bodyHeight, g)
  const perColumn = splitAcrossColumns(questionCount, columns, firstCap, restCap)
  const roll = buildRollBlock(originY + f.bodyTop, contentX[0], rollDigits, g)

  const questions = []
  let q = 1
  perColumn.forEach((count, col) => {
    const x = contentX[col]
    let y = originY + f.bodyTop + (col === 0 ? rollHeight(rollDigits, g) : 0)
    for (let i = 0; i < count; i++) {
      if (i % GROUP_SIZE === 0) y += g.groupSlot
      const cy = round(y + g.radius)
      questions.push({
        q,
        x: round(x),
        y: cy,
        groupHeader: i % GROUP_SIZE === 0
          ? { y: round(y - g.groupSlot / 2), labels: optionLabels }
          : null,
        options: optionLabels.map((label, oi) => ({
          label,
          x: round(x + g.numberW + g.radius + oi * g.pitch),
          y: cy,
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
  const lastInk = Math.max(
    ...questions.map(q => q.y + g.radius),
    ...roll.columns.flatMap(c => c.bubbles.map(b => b.y + g.radius)),
  )
  const top = originY + f.bodyTop
  const bottom = Math.min(originY + f.bodyBottom - g.regSize, lastInk + f.gutter)
  const rowCount = Math.max(REG_ROWS_MIN, Math.round((bottom - top) / REG_ROW_TARGET) + 1)
  const step = (bottom - top) / (rowCount - 1)
  const regY = Array.from({ length: rowCount }, (_, i) => round(top + i * step))
  const registration = []
  for (const y of regY) for (const x of regX) registration.push({ x, y, size: g.regSize })

  const [minX, maxX] = [regX[0], regX[regX.length - 1]]
  const [minY, maxY] = [regY[0], regY[regY.length - 1]]
  const anchors = [
    { x: minX, y: minY, size: g.regSize, corner: 'topLeft' },
    { x: maxX, y: minY, size: g.regSize, corner: 'topRight' },
    { x: minX, y: maxY, size: g.regSize, corner: 'bottomLeft' },
    { x: maxX, y: maxY, size: g.regSize, corner: 'bottomRight' },
  ]

  return {
    index,
    origin: { x: 0, y: round(originY) },
    width: page.width,
    height: round(f.sheetH),
    header: {
      x: MARGIN, y: round(originY + MARGIN),
      width: round(page.width - 2 * MARGIN), height: f.headerH,
      fields: ['NAME', 'EXAM', 'DATE'],
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
    },
    cutLine: perPage === 2 ? round(page.height / 2) : null,
    sheets,
  }
}
