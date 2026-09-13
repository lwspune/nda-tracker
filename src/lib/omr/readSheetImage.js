// One photographed sheet -> answers, a roll number, and a student.
//
// This is the glue: detect the registration squares, fit the lattice, solve the
// transform from the SHEET'S OWN millimetres into the photograph, sample every
// bubble the layout knows about, and decide. Everything it calls is separately
// tested; what lives here is the wiring and the refusals.
//
// It never throws on a bad photo. A capture that cannot be read returns
// `{ ok: false, reason }` — an operator scanning 300 sheets needs to be told
// which one to re-shoot, not handed an exception.

import { detectRegistrationSquares, sampleDarkness } from './detectSquares'
import { fitLattice, solveHomographyLS, applyH } from './gridFit'
import { calibrate, readSheet } from './readBubbles'
import { readRollDigits, resolveRoll } from './resolveRoll'

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra })

/** The layout's registration squares, as a grid of millimetre centres. */
function registrationGrid(sheet, cols, size) {
  const xs = [...new Set(sheet.registration.map(r => r.x))].sort((a, b) => a - b)
  const ys = [...new Set(sheet.registration.map(r => r.y))].sort((a, b) => a - b)
  return { xs, ys, half: size / 2, cols, rows: ys.length, matches: xs.length === cols }
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @param {object} opts
 * @param {object} opts.layout      from `buildSheetLayout` — the exam's own sheet
 * @param {number} [opts.sheetIndex] which half, when the layout is 2-up
 * @param {object[]} [opts.roster]   the EXAM's batch, for identity
 */
export function readSheetImage(image, { layout, sheetIndex = 0, roster = [] } = {}) {
  if (!image || !layout) return fail('No image or layout supplied.')
  const sheet = layout.sheets[sheetIndex]
  if (!sheet) return fail('That sheet index is not in this layout.')

  // `mask` comes back from the SAME call the squares did. Asking twice cost a
  // second full grayscale + local-threshold + erode + connected-components pass
  // over the frame — about half the total time, which is free to hand back and
  // is the difference between a viewfinder that keeps up and one that lurches.
  const { squares, mask, stats } = detectRegistrationSquares(image)
  if (squares.length < 8) {
    return fail(
      `Only ${squares.length} registration marks found — is the whole sheet in frame?`,
      { squaresFound: squares.length, stats },
    )
  }

  const fit = fitLattice(squares.map(s => ({ x: s.cx, y: s.cy })))
  if (!fit) {
    return fail('The registration marks do not form a grid — try a flatter, sharper shot.',
      { squaresFound: squares.length, stats })
  }

  const grid = registrationGrid(sheet, layout.geometry.registrationColumns,
    layout.geometry.registrationSize)

  // Check the SHAPE before sampling anything. Scanning a 30-question stack
  // against a 150-question paper would otherwise read whatever happened to line
  // up and file nonsense against real students.
  if (fit.cols !== grid.cols || fit.rows !== grid.rows) {
    return fail(
      `This looks like a ${fit.cols}×${fit.rows} sheet, but this exam prints ` +
      `${grid.cols}×${grid.rows}. Is it the right paper?`,
      { squaresFound: squares.length, grid: { cols: fit.cols, rows: fit.rows }, stats },
    )
  }

  // Correspondences: the layout knows each square's millimetres, the lattice
  // knows which square is which. Every indexed square is used, so no single
  // detection can define the transform.
  const src = [], dst = []
  fit.indices.forEach((ix, k) => {
    if (!ix || ix.i >= grid.xs.length || ix.j >= grid.ys.length) return
    src.push({ x: grid.xs[ix.i] + grid.half, y: grid.ys[ix.j] + grid.half })
    dst.push({ x: squares[k].cx, y: squares[k].cy })
  })
  if (src.length < 4) return fail('Not enough registration marks matched the sheet.')

  const H = solveHomographyLS(src, dst)
  if (!H) return fail('Could not work out the sheet’s position in the photo.')

  // Sample in the PHOTO, at the radius the sheet's own geometry projects to —
  // so distance from the lens changes nothing.
  const at = (mmx, mmy, rmm) => {
    const c = applyH(H, mmx, mmy)
    const edge = applyH(H, mmx + rmm, mmy)
    const rpx = Math.hypot(edge.x - c.x, edge.y - c.y)
    return sampleDarkness(mask, image.width, image.height, c.x, c.y, rpx)
  }

  // Where the sheet sits in this frame, for the viewfinder to outline. Projected
  // through the same H the bubbles are sampled with, so it follows the paper
  // through tilt and rotation rather than asking the operator to line the sheet
  // up inside a fixed box.
  const x0 = grid.xs[0], x1 = grid.xs[grid.xs.length - 1] + grid.half * 2
  const y0 = grid.ys[0], y1 = grid.ys[grid.ys.length - 1] + grid.half * 2
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([mx, my]) => applyH(H, mx, my))

  const questionRows = sheet.questions.map(q => ({
    q: q.q,
    options: q.options.map(o => o.label),
    scores: q.options.map(o => at(o.x, o.y, o.r)),
  }))
  const rollColumns = sheet.roll.columns.map(c => c.bubbles.map(b => at(b.x, b.y, b.r)))

  // Calibrate across the WHOLE sheet, answers and roll together: they are the
  // same pen on the same paper, and a roll block alone is too few bubbles to
  // find an empty baseline in.
  const cal = calibrate([...questionRows.flatMap(r => r.scores), ...rollColumns.flat()])
  const result = readSheet(questionRows, { calibration: cal })
  const roll = readRollDigits(rollColumns, cal)
  const student = resolveRoll(roll.digits, roster)

  return {
    ok: true,
    reason: null,
    squaresFound: squares.length,
    grid: { cols: fit.cols, rows: fit.rows },
    corners,
    residual: fit.residual,
    answers: result.answers,
    decisions: result.decisions,
    needsReview: result.needsReview,
    reviewCount: result.reviewCount,
    calibration: cal,
    roll,
    student,
    // A sheet is only filed when nothing is outstanding — including whose it is.
    complete: result.complete && !roll.review && !student.review,
  }
}
