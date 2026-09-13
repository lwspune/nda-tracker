import { describe, it, expect } from 'vitest'
import { toGrayscale, binarize, detectRegistrationSquares, sampleDarkness } from '../detectSquares'

// A tiny drawing kit so these tests build their own images rather than needing
// fixtures. `data` is RGBA, matching ImageData, which is what a <canvas> hands
// the browser code.
function canvas(width, height, bg = 255) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg; data[i * 4 + 1] = bg; data[i * 4 + 2] = bg; data[i * 4 + 3] = 255
  }
  const put = (x, y, v) => {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = v; data[i + 1] = v; data[i + 2] = v
  }
  return {
    width, height, data, put,
    square: (x, y, s, v = 0) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) put(x + i, y + j, v) },
    disc: (cx, cy, r, v = 0) => {
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, v)
    },
    ring: (cx, cy, r, v = 0) => {
      const steps = Math.max(60, Math.round(2 * Math.PI * r * 3))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI
        for (const rr of [r, r - 0.8, r - 1.6]) put(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, v)
      }
    },
    shade: fn => {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const v = Math.max(0, Math.min(255, data[i] - fn(x, y)))
        data[i] = v; data[i + 1] = v; data[i + 2] = v
      }
    },
  }
}

/** A sheet-ish scene: a grid of registration squares plus bubble rings. */
function scene(scale = 1) {
  const W = Math.round(600 * scale), H = Math.round(800 * scale)
  const c = canvas(W, H)
  const sq = Math.round(W * 0.018)             // same relative size the detector expects
  const placed = []
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 3; i++) {
      const x = Math.round((0.08 + i * 0.42) * W), y = Math.round((0.10 + j * 0.19) * H)
      c.square(x, y, sq)
      placed.push({ x, y })
    }
  }
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 4; i++) {
      c.ring(Math.round((0.20 + i * 0.09) * W), Math.round((0.18 + j * 0.10) * H), sq * 0.6)
    }
  }
  return { c, sq, placed }
}

describe('toGrayscale / binarize', () => {
  it('thresholds against a LOCAL background, so a shadow does not eat a corner', () => {
    const c = canvas(400, 400)
    c.square(40, 40, 14)
    c.square(340, 340, 14)
    c.shade((x, y) => 90 * (x / 400) + 60 * (y / 400))   // heavy gradient
    const gray = toGrayscale(c)
    const mask = binarize(gray, c.width, c.height)
    const darkAt = (x, y) => mask[(y + 7) * c.width + (x + 7)]
    expect(darkAt(40, 40)).toBe(1)
    expect(darkAt(340, 340)).toBe(1)    // the shadowed corner still registers
    expect(mask[200 * c.width + 200]).toBe(0)
  })
})

describe('detectRegistrationSquares', () => {
  it('finds the squares and ignores the bubbles', () => {
    const { c, placed } = scene()
    const found = detectRegistrationSquares(c)
    expect(found.squares).toHaveLength(placed.length)
    for (const p of placed) {
      expect(found.squares.some(s => Math.abs(s.cx - p.x) < 6 && Math.abs(s.cy - p.y) < 6)).toBe(true)
    }
  })

  it('rejects a FILLED bubble — a disc cannot exceed pi/4 of its box', () => {
    // This is the whole discriminator, and it is geometry rather than a tuned
    // number: a solid square fills ~1.0 of its bounding box, a disc 0.785.
    const { c, sq, placed } = scene()
    c.disc(450, 762, sq * 0.62)          // a heavily inked answer, clear of any square
    const found = detectRegistrationSquares(c)
    expect(found.squares.some(s => Math.abs(s.cx - 450) < 6 && Math.abs(s.cy - 762) < 6)).toBe(false)
    expect(found.squares).toHaveLength(placed.length)   // and it cost us no real square
  })

  it('is resolution-independent — the same scene at 2x finds the same squares', () => {
    // Device independence is the point: if this needed a particular phone, the
    // design would be wrong. Sizes are judged as a fraction of frame width.
    const small = detectRegistrationSquares(scene(1).c)
    const large = detectRegistrationSquares(scene(2).c)
    expect(large.squares).toHaveLength(small.squares.length)
  })

  it('survives a strong illumination gradient', () => {
    const { c, placed } = scene()
    c.shade((x, y) => 70 * (x / c.width) + 40 * (y / c.height))
    expect(detectRegistrationSquares(c).squares).toHaveLength(placed.length)
  })

  it('ignores speckle', () => {
    const { c, placed } = scene()
    let seed = 5
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 3000; i++) c.put(rnd() * c.width, rnd() * c.height, 0)
    expect(detectRegistrationSquares(c).squares).toHaveLength(placed.length)
  })

  it('reports fill and size, so a bad capture can be diagnosed rather than guessed at', () => {
    const { c, sq, placed } = scene()
    c.disc(450, 762, sq * 0.62)          // one solid blob that is NOT a square
    const found = detectRegistrationSquares(c)
    expect(found.squares).toHaveLength(placed.length)
    for (const s of found.squares) {
      expect(s.fill).toBeGreaterThan(0.85)
      expect(s.w).toBeGreaterThan(0)
    }
    // the disc survived erosion as a candidate and was then rejected on shape
    expect(found.stats.candidates).toBeGreaterThan(found.squares.length)
    expect(found.stats.rejected).toBeGreaterThanOrEqual(1)
  })

  it('returns nothing rather than guessing on an empty frame', () => {
    const found = detectRegistrationSquares(canvas(300, 300))
    expect(found.squares).toEqual([])
  })
})

describe('sampleDarkness', () => {
  it('scores a filled bubble high and an empty one low', () => {
    const c = canvas(200, 200)
    c.ring(60, 60, 12)
    c.ring(140, 60, 12)
    c.disc(140, 60, 9)
    const mask = binarize(toGrayscale(c), c.width, c.height)
    const empty = sampleDarkness(mask, c.width, c.height, 60, 60, 12)
    const filled = sampleDarkness(mask, c.width, c.height, 140, 60, 12)
    expect(filled).toBeGreaterThan(0.8)
    expect(empty).toBeLessThan(0.3)
  })

  it('samples inside the ring, so the printed outline is not read as ink', () => {
    // Sampling the full radius counts the bubble's own border and every empty
    // bubble scores as partly filled.
    const c = canvas(200, 200)
    c.ring(100, 100, 14)
    const mask = binarize(toGrayscale(c), c.width, c.height)
    expect(sampleDarkness(mask, c.width, c.height, 100, 100, 14)).toBeLessThan(0.25)
  })
})
