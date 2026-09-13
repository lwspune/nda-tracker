import { describe, it, expect } from 'vitest'
import { fitLattice, solveHomographyLS, applyH } from '../gridFit'

// The Phase B spike rectified 6 of 9 real photos. All three failures had one
// cause: a corner registration square lost to shadow, so anchoring on four
// extreme points locked onto the SECOND row and skewed the whole transform.
// These tests use synthetic grids because the ground truth has to be known —
// a photo can only tell you it looked wrong.

/** Project lattice (i,j) through a homography, i.e. fake a photographed grid. */
function project(H, i, j) {
  return applyH(H, i, j)
}

/** A plausible phone-photo transform: scale, translate, and real perspective. */
const PHOTO_H = [
  38, 2.5, 120,
  -3, 41, 90,
  0.006, 0.010, 1,
]

function makeGrid(cols, rows, H = PHOTO_H) {
  const pts = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = project(H, i, j)
      pts.push({ x: p.x, y: p.y, i, j })
    }
  }
  return pts
}

const strip = pts => pts.map(({ x, y }) => ({ x, y }))

describe('solveHomographyLS', () => {
  it('recovers an exact transform from four points', () => {
    const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    const dst = src.map(p => applyH(PHOTO_H, p.x, p.y))
    const H = solveHomographyLS(src, dst)
    for (const p of src) {
      const got = applyH(H, p.x, p.y), want = applyH(PHOTO_H, p.x, p.y)
      expect(got.x).toBeCloseTo(want.x, 4)
      expect(got.y).toBeCloseTo(want.y, 4)
    }
  })

  it('uses ALL correspondences, so one bad point cannot dominate', () => {
    const src = []
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) src.push({ x: i, y: j })
    const dst = src.map(p => applyH(PHOTO_H, p.x, p.y))
    dst[12] = { x: dst[12].x + 6, y: dst[12].y - 6 }     // one nudged point
    const H = solveHomographyLS(src, dst)
    const errs = src.map((p, k) => {
      const got = applyH(H, p.x, p.y)
      return Math.hypot(got.x - dst[k].x, got.y - dst[k].y)
    })
    // the nudged point carries most of the error; the rest stay close
    const clean = errs.filter((_, k) => k !== 12)
    expect(Math.max(...clean)).toBeLessThan(2)
  })
})

describe('fitLattice', () => {
  it('recovers a full grid and indexes every square', () => {
    const pts = makeGrid(5, 11)
    const fit = fitLattice(strip(pts))
    expect(fit).not.toBeNull()
    expect(fit.cols).toBe(5)
    expect(fit.rows).toBe(11)
    expect(fit.assigned).toBe(55)
    // every point got its true lattice index back
    for (let k = 0; k < pts.length; k++) {
      expect(fit.indices[k]).toEqual({ i: pts[k].i, j: pts[k].j })
    }
  })

  it('survives the corner square being missing — the actual failure', () => {
    const pts = makeGrid(5, 11)
    // drop the top-left corner plus two more along the edges
    const kept = pts.filter(p => !(p.i === 0 && p.j === 0) &&
                                 !(p.i === 4 && p.j === 0) &&
                                 !(p.i === 0 && p.j === 5))
    const fit = fitLattice(strip(kept))
    expect(fit).not.toBeNull()
    expect(fit.cols).toBe(5)
    expect(fit.rows).toBe(11)
    expect(fit.assigned).toBe(kept.length)
    for (let k = 0; k < kept.length; k++) {
      expect(fit.indices[k]).toEqual({ i: kept[k].i, j: kept[k].j })
    }
  })

  it('handles a lattice whose columns are far wider apart than its rows', () => {
    // The real sheets are strongly anisotropic — registration columns sit about
    // 214px apart and rows about 130px. An earlier version filtered candidate
    // edges by a GLOBAL median length, which threw the long axis away entirely
    // and picked a diagonal instead, reporting 4x10 where the truth was 4x7.
    // The first synthetic grid here was near-square, so it never caught it.
    const WIDE_H = [
      86, 3, 110,
      -4, 41, 80,
      0.004, 0.008, 1,
    ]
    const pts = makeGrid(4, 7, WIDE_H)
    const fit = fitLattice(strip(pts))
    expect(fit).not.toBeNull()
    expect(fit.cols).toBe(4)
    expect(fit.rows).toBe(7)
    expect(fit.assigned).toBe(28)
  })

  it('orients the lattice so i grows rightwards and j downwards', () => {
    // Consumers match these indices against the layout's own column/row order.
    // If the axis comes back reversed, every correspondence is mirrored and the
    // resulting homography is silently useless — an 18px reprojection error on
    // an 11px bubble, which is exactly what the end-to-end run hit.
    for (const H of [
      PHOTO_H,
      [-38, 2.5, 700, 3, 41, 90, -0.006, 0.010, 1],     // mirrored in x
      [38, 2.5, 120, -3, -41, 700, 0.006, -0.010, 1],   // mirrored in y
    ]) {
      const pts = strip(makeGrid(4, 6, H))
      const fit = fitLattice(pts)
      expect(fit).not.toBeNull()
      const cov = (a, b) => {
        const ma = a.reduce((s, v) => s + v, 0) / a.length
        const mb = b.reduce((s, v) => s + v, 0) / b.length
        return a.reduce((s, v, k) => s + (v - ma) * (b[k] - mb), 0)
      }
      const idx = fit.indices
      expect(cov(pts.map(p => p.x), idx.map(v => v.i))).toBeGreaterThan(0)
      expect(cov(pts.map(p => p.y), idx.map(v => v.j))).toBeGreaterThan(0)
    }
  })

  it('tolerates detection jitter', () => {
    const pts = makeGrid(5, 11)
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5)
    const noisy = pts.map(p => ({ x: p.x + rand() * 2.5, y: p.y + rand() * 2.5 }))
    const fit = fitLattice(noisy)
    expect(fit).not.toBeNull()
    expect(fit.cols).toBe(5)
    expect(fit.rows).toBe(11)
  })

  it('rejects blobs that are not on the lattice', () => {
    const pts = strip(makeGrid(5, 11))
    const withJunk = [...pts,
      { x: 600, y: 40 }, { x: 30, y: 700 }, { x: 410, y: 705 }, { x: 12, y: 12 }]
    const fit = fitLattice(withJunk)
    expect(fit).not.toBeNull()
    expect(fit.cols).toBe(5)
    expect(fit.rows).toBe(11)
    // the four strays are not indexed
    for (let k = pts.length; k < withJunk.length; k++) {
      expect(fit.indices[k]).toBeNull()
    }
  })

  it('maps the grid onto a clean unit lattice, which is what the reader needs', () => {
    const pts = strip(makeGrid(4, 7))
    const fit = fitLattice(pts)
    for (let k = 0; k < pts.length; k++) {
      const got = applyH(fit.H, pts[k].x, pts[k].y)
      expect(got.x).toBeCloseTo(fit.indices[k].i, 3)
      expect(got.y).toBeCloseTo(fit.indices[k].j, 3)
    }
    expect(fit.residual).toBeLessThan(0.02)
  })

  it('gives up rather than inventing a grid from too few points', () => {
    expect(fitLattice([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBeNull()
    expect(fitLattice([])).toBeNull()
  })

  it('gives up on points with no lattice structure at all', () => {
    let seed = 3
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const scatter = Array.from({ length: 30 }, () => ({ x: rand() * 500, y: rand() * 700 }))
    const fit = fitLattice(scatter)
    expect(fit === null || fit.assigned < scatter.length * 0.6).toBe(true)
  })
})
