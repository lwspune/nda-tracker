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

/**
 * The layout's registration squares, indexed by the SHEET's column and row.
 *
 * Not by page x and y. A two-up sheet is printed turned 90°, so its columns run
 * down the page's x axis and its rows across its y — counting distinct page
 * coordinates called a 3×7 sheet "3×3" and refused every two-up capture, even
 * once the right layout was handed in.
 *
 * The axes come from `sheet.anchors`, which the layout labels by the SHEET's
 * corners for exactly this purpose. Projecting every square onto those two
 * directions gets the axis roles AND their direction right with no rotated /
 * unrotated branch — and a hand-picked sort order is precisely how gridFit.js
 * once produced a mirrored lattice that indexed every square and mapped them
 * all to the wrong place.
 */
function registrationGrid(sheet, size) {
  const corner = name => sheet.anchors?.find(a => a.corner === name)
  const tl = corner('topLeft'), tr = corner('topRight'), bl = corner('bottomLeft')
  if (!tl || !tr || !bl) return null

  const unit = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y
    const n = Math.hypot(dx, dy)
    return n < 1e-9 ? null : { x: dx / n, y: dy / n }
  }
  const u = unit(tl, tr)          // the sheet's left -> right
  const v = unit(tl, bl)          // the sheet's top  -> bottom
  if (!u || !v) return null

  const proj = (s, w) => (s.x - tl.x) * w.x + (s.y - tl.y) * w.y
  // Distinct ordinates along one axis. Half a square is the tolerance: two
  // squares closer than that along an axis are the same column (or row).
  const ordinates = w => {
    const vals = []
    for (const s of sheet.registration) {
      const p = proj(s, w)
      if (!vals.some(q => Math.abs(q - p) < size / 2)) vals.push(p)
    }
    return vals.sort((a, b) => a - b)
  }
  const colAt = ordinates(u), rowAt = ordinates(v)
  const nearest = (list, p) => {
    let best = 0
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i] - p) < Math.abs(list[best] - p)) best = i
    }
    return best
  }

  // (column, row) -> the square's centre, in the page millimetres the bubbles
  // are expressed in, so a correspondence can be paired straight with a bubble.
  const half = size / 2
  const centres = new Map()
  for (const s of sheet.registration) {
    centres.set(`${nearest(colAt, proj(s, u))},${nearest(rowAt, proj(s, v))}`,
      { x: s.x + half, y: s.y + half })
  }

  return {
    cols: colAt.length,
    rows: rowAt.length,
    at: (i, j) => centres.get(`${i},${j}`) || null,
  }
}

const shapeOf = g => `${g.cols}×${g.rows}`
const FORMAT_NAME = { 1: 'one per page', 2: 'two per page' }

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @param {object} opts
 * @param {object} [opts.layout]     from `buildSheetLayout` — the exam's own sheet
 * @param {object[]} [opts.layouts]  candidate layouts, when the print format is
 *   not known in advance; the detected grid picks between them. The whole stack
 *   is detected ONCE either way — trying each layout end to end would halve the
 *   viewfinder's frame rate for an answer the first fit already contains.
 * @param {number} [opts.sheetIndex] which half, when the layout is 2-up
 * @param {object[]} [opts.roster]   the EXAM's batch, for identity
 */
export function readSheetImage(image, { layout, layouts, sheetIndex = 0, roster = [] } = {}) {
  const candidates = (layouts?.length ? layouts : [layout]).filter(Boolean)
  if (!image || !candidates.length) return fail('No image or layout supplied.')
  if (candidates.some(l => !l.sheets?.[sheetIndex])) {
    return fail('That sheet index is not in this layout.')
  }

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

  const found = { cols: fit.cols, rows: fit.rows }
  const diag = { squaresFound: squares.length, grid: found, stats }

  const options = candidates.map(l => ({
    layout: l,
    sheet: l.sheets[sheetIndex],
    grid: registrationGrid(l.sheets[sheetIndex], l.geometry.registrationSize),
  }))
  if (options.some(o => !o.grid)) {
    return fail('This sheet layout has no corner anchors to read from.', diag)
  }
  // The layout must agree with the squares it drew. If it does not, the fault is
  // in the layout, not the paper, and saying "is it the right paper?" would send
  // the operator hunting through a stack that was never wrong.
  const inconsistent = options.find(o =>
    o.grid.cols !== o.layout.geometry.registrationColumns ||
    o.grid.rows !== o.layout.geometry.registrationRows)
  if (inconsistent) {
    return fail(
      `This exam's sheet layout is inconsistent: it reports ` +
      `${inconsistent.layout.geometry.registrationColumns}×` +
      `${inconsistent.layout.geometry.registrationRows} but draws ` +
      `${shapeOf(inconsistent.grid)}.`, diag)
  }

  // Check the SHAPE before sampling anything. Scanning a 30-question stack
  // against a 150-question paper would otherwise read whatever happened to line
  // up and file nonsense against real students.
  const hits = options.filter(o => o.grid.cols === found.cols && o.grid.rows === found.rows)
  if (!hits.length) {
    const prints = [...new Set(options.map(o => shapeOf(o.grid)))].join(' or ')
    return fail(
      `This looks like a ${shapeOf(found)} sheet, but this exam prints ` +
      `${prints}. Is it the right paper?`, diag)
  }
  // Two formats printing the same grid is not a reason to pick one: they put a
  // given question in a different column, so a wrong guess samples most of a
  // block away and files that against a real student. 28 of the 188 printable
  // question counts are like this; every other count answers itself above.
  if (hits.length > 1) {
    const names = hits.map(o => FORMAT_NAME[o.layout.perPage] || `${o.layout.perPage}-up`)
    return fail(
      `Both of this exam's sheet formats print a ${shapeOf(found)} grid, so the ` +
      `photo cannot say which this is. Choose ${names.join(' or ')} and scan again.`,
      diag)
  }

  const { layout: chosen, sheet, grid } = hits[0]

  // Correspondences: the layout knows each square's millimetres, the lattice
  // knows which square is which. Every indexed square is used, so no single
  // detection can define the transform.
  const src = [], dst = []
  fit.indices.forEach((ix, k) => {
    if (!ix) return
    const mm = grid.at(ix.i, ix.j)
    if (!mm) return
    src.push(mm)
    dst.push({ x: squares[k].cx, y: squares[k].cy })
  })
  if (src.length < 4) return fail('Not enough registration marks matched the sheet.', diag)

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
  //
  // The bounding box of the squares in PAGE millimetres, which is the same
  // rectangle whichever way the sheet is turned — only the corner it starts at
  // differs, and the outline is a closed quad either way.
  const size = chosen.geometry.registrationSize
  const x0 = Math.min(...sheet.registration.map(s => s.x))
  const x1 = Math.max(...sheet.registration.map(s => s.x)) + size
  const y0 = Math.min(...sheet.registration.map(s => s.y))
  const y1 = Math.max(...sheet.registration.map(s => s.y)) + size
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
    grid: found,
    // Which of the candidate formats this turned out to be, so the page can say
    // so rather than leaving the operator to wonder what it read.
    perPage: chosen.perPage,
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
