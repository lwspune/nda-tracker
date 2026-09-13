// Fit the registration lattice GLOBALLY, from every square that was detected.
//
// The Phase B spike anchored on four extreme points — min(x+y) for the top-left
// and so on — and rectified 6 of 9 real photos. All three failures shared one
// cause: a corner square lost to shadow, so the "top-left" was actually the
// second row, the transform skewed, and squares mapped to negative coordinates
// above their own origin. Four points is the fewest that can define a
// homography and also the fewest that can be wrong together.
//
// Instead: recover each square's INTEGER lattice index by walking the grid, then
// fit the transform by least squares over all of them. A missing square then
// costs nothing — its neighbours still pin the lattice — and a stray blob is
// simply never indexed.

/** Apply a 9-element homography to a point. */
export function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d }
}

/** Solve 8 unknowns by Gaussian elimination with partial pivoting. */
function solve8(A, b) {
  const n = 8
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  return b.map((v, i) => v / A[i][i])
}

/**
 * Least-squares homography mapping `src` onto `dst` (4+ correspondences).
 *
 * Over-determined on purpose: using all of them means no single mis-detected
 * square can define the transform, which is the whole point of this module.
 */
export function solveHomographyLS(src, dst) {
  if (src.length < 4 || src.length !== dst.length) return null
  // normal equations for the 8-parameter form (h33 = 1)
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0))
  const ATb = new Array(8).fill(0)
  for (let k = 0; k < src.length; k++) {
    const { x, y } = src[k], { x: X, y: Y } = dst[k]
    const rows = [
      [x, y, 1, 0, 0, 0, -X * x, -X * y, X],
      [0, 0, 0, x, y, 1, -Y * x, -Y * y, Y],
    ]
    for (const r of rows) {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) ATA[i][j] += r[i] * r[j]
        ATb[i] += r[i] * r[8]
      }
    }
  }
  const h = solve8(ATA, ATb)
  return h ? [...h, 1] : null
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
const len = v => Math.hypot(v.x, v.y)
const median = a => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

/**
 * The two lattice basis vectors, from the short edges between nearby squares.
 *
 * Edges one step apart dominate, and they point along only two axes. Directions
 * are folded modulo 180° so +u and -u reinforce rather than cancel.
 */
function basisVectors(points, neighbourEdges) {
  if (neighbourEdges.length < 4) return null

  // Bucket by DIRECTION only. Filtering candidates by a global median length
  // first looks sensible and is wrong: these lattices are strongly anisotropic
  // (columns ~214px apart, rows ~130px), so the long axis fell outside the
  // filter, and the second-best direction became a diagonal — a 4x7 grid read
  // as 4x10. Direction families are ranked by how many edges they hold, and the
  // one-step length is then taken per family.
  const buckets = new Map()
  for (const v of neighbourEdges) {
    let a = Math.atan2(v.y, v.x)
    if (a < 0) a += Math.PI
    const key = Math.round(a / (Math.PI / 36))       // 5° buckets
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(v)
  }
  const ranked = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)
  if (!ranked.length) return null

  const repr = entry => {
    // Sign-align so opposite-pointing edges reinforce instead of cancelling,
    // then take the MEDIAN LENGTH within this direction — a family can hold
    // two-step edges as well as one-step, and the median lands on one step.
    const ref = entry[1][0]
    const aligned = entry[1].map(v => ((v.x * ref.x + v.y * ref.y) < 0 ? { x: -v.x, y: -v.y } : v))
    const step = median(aligned.map(len))
    const near = aligned.filter(v => Math.abs(len(v) - step) < step * 0.35)
    const pick = near.length ? near : aligned
    return {
      x: pick.reduce((s, v) => s + v.x, 0) / pick.length,
      y: pick.reduce((s, v) => s + v.y, 0) / pick.length,
    }
  }
  const u = repr(ranked[0])
  // The second axis must be a genuinely different direction, not a near-parallel
  // bucket and not the diagonal that sits between the two real axes.
  const second = ranked.slice(1).find(e => {
    const v = repr(e)
    const cos = Math.abs((u.x * v.x + u.y * v.y) / (len(u) * len(v)))
    return cos < 0.5
  })
  if (!second) return null
  return { u, v: repr(second) }
}

/**
 * Fit a lattice to detected points.
 *
 * @param {{x:number,y:number}[]} points  square centres in image space
 * @returns {null | {
 *   H: number[],                        // image -> lattice index space
 *   indices: ({i:number,j:number}|null)[],  // per input point; null = off-lattice
 *   cols: number, rows: number, assigned: number, residual: number,
 * }}
 */
export function fitLattice(points, { minPoints = 8, tol = 0.34 } = {}) {
  if (!points || points.length < minPoints) return null

  // Nearest neighbours, capped — enough to see all four lattice directions.
  const K = 6
  const neighbours = points.map((p, idx) => {
    const d = points.map((q, k) => ({ k, dist: k === idx ? Infinity : len(sub(q, p)) }))
    d.sort((a, b) => a.dist - b.dist)
    return d.slice(0, K)
  })
  const edges = []
  neighbours.forEach((ns, idx) => ns.forEach(n => edges.push(sub(points[n.k], points[idx]))))

  const basis = basisVectors(points, edges)
  if (!basis) return null
  const { u, v } = basis

  // Solve [u v] * (a, b) = e for each edge; a lattice edge gives near-integers.
  const det = u.x * v.y - u.y * v.x
  if (Math.abs(det) < 1e-9) return null
  const decompose = e => ({
    a: (e.x * v.y - e.y * v.x) / det,
    b: (u.x * e.y - u.y * e.x) / det,
  })

  // Walk the grid from the most central point, assigning integer indices.
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  let seed = 0
  points.forEach((p, k) => {
    if (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(points[seed].x - cx, points[seed].y - cy)) seed = k
  })

  const idx = new Array(points.length).fill(null)
  idx[seed] = { i: 0, j: 0 }
  const queue = [seed]
  while (queue.length) {
    const cur = queue.shift()
    for (const n of neighbours[cur]) {
      if (idx[n.k]) continue
      const { a, b } = decompose(sub(points[n.k], points[cur]))
      const ri = Math.round(a), rj = Math.round(b)
      // one step only, and close enough to integer to be a lattice edge
      if (Math.abs(a - ri) > tol || Math.abs(b - rj) > tol) continue
      if (Math.abs(ri) > 1 || Math.abs(rj) > 1 || (ri === 0 && rj === 0)) continue
      idx[n.k] = { i: idx[cur].i + ri, j: idx[cur].j + rj }
      queue.push(n.k)
    }
  }

  const assignedKeys = idx.map((v2, k) => (v2 ? k : -1)).filter(k => k >= 0)
  if (assignedKeys.length < minPoints) return null

  // Normalise so indices start at 0, and orient i along the more horizontal axis.
  let minI = Infinity, minJ = Infinity, maxI = -Infinity, maxJ = -Infinity
  for (const k of assignedKeys) {
    minI = Math.min(minI, idx[k].i); maxI = Math.max(maxI, idx[k].i)
    minJ = Math.min(minJ, idx[k].j); maxJ = Math.max(maxJ, idx[k].j)
  }
  const swap = Math.abs(u.x) < Math.abs(u.y)        // u is really the vertical axis
  for (const k of assignedKeys) {
    const i = idx[k].i - minI, j = idx[k].j - minJ
    idx[k] = swap ? { i: j, j: i } : { i, j }
  }
  let cols = maxI - minI + 1, rows = maxJ - minJ + 1
  if (swap) [cols, rows] = [rows, cols]

  // Flip either axis if it runs backwards, so (0,0) is the top-left square.
  const at = k => points[k]
  const iVec = { x: 0, y: 0 }, jVec = { x: 0, y: 0 }
  for (const k of assignedKeys) {
    iVec.x += at(k).x * idx[k].i; iVec.y += at(k).y * idx[k].i
    jVec.x += at(k).x * idx[k].j; jVec.y += at(k).y * idx[k].j
  }
  if (iVec.x < 0) for (const k of assignedKeys) idx[k] = { ...idx[k], i: cols - 1 - idx[k].i }
  if (jVec.y < 0) for (const k of assignedKeys) idx[k] = { ...idx[k], j: rows - 1 - idx[k].j }

  const src = assignedKeys.map(k => points[k])
  const dst = assignedKeys.map(k => ({ x: idx[k].i, y: idx[k].j }))
  const H = solveHomographyLS(src, dst)
  if (!H) return null

  let worst = 0
  for (let k = 0; k < src.length; k++) {
    const got = applyH(H, src[k].x, src[k].y)
    worst = Math.max(worst, Math.hypot(got.x - dst[k].x, got.y - dst[k].y))
  }

  return { H, indices: idx, cols, rows, assigned: assignedKeys.length, residual: worst }
}
