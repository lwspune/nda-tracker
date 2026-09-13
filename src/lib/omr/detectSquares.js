// Finding the registration squares in a photograph of a sheet.
//
// Input is ImageData-shaped (`{width, height, data}` RGBA) — exactly what a
// <canvas> hands you in the browser, and trivially constructed in a test, so
// none of this needs a device or a DOM to verify.
//
// ── Device independence is a design property, not a hope ─────────────────────
// Nothing here is expressed in pixels tied to a camera:
//   • candidate size is a FRACTION OF FRAME WIDTH, so a 12 MP frame and a
//     downscaled 1080-wide one behave the same;
//   • thresholding is LOCAL, so the shadow every real photo carries does not
//     swallow a corner;
//   • the geometry that follows (`fitLattice`) is recovered from the sheet
//     itself, absorbing scale, rotation and perspective.
// Validated on nine real photos from a phone whose model is unknown — which is
// the point. If a particular handset mattered, the design would be wrong.

/**
 * A solid square fills ~1.0 of its bounding box; a DISC fills π/4 ≈ 0.785. That
 * gap is the discriminator between a registration mark and a heavily inked
 * answer bubble, and it is geometry rather than a tuned constant. Confirmed on
 * all nine real photos at 0.85, 0.88 and 0.90 — 9/9 at each.
 */
export const SQUARE_FILL_MIN = 0.85

/** Expected registration square size, as a fraction of the frame's width. */
const SIZE_HINT = 0.018
const SIZE_MIN_FACTOR = 0.45
const SIZE_MAX_FACTOR = 2.4
const ASPECT_MIN = 0.75
const ASPECT_MAX = 1.35

/** Luminance, at ImageData stride. */
export function toGrayscale({ width, height, data }) {
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    gray[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0
  }
  return gray
}

/**
 * Threshold each pixel against its own neighbourhood.
 *
 * One global threshold loses whichever corner the shadow falls on — and every
 * real photo of a sheet on a desk has one. The background is estimated from
 * coarse block means and sampled bilinearly so the estimate itself has no edges.
 */
export function binarize(gray, width, height, { block = 48, offset = 22 } = {}) {
  const bw = Math.ceil(width / block), bh = Math.ceil(height / block)
  const sum = new Float64Array(bw * bh), count = new Float64Array(bw * bh)
  for (let y = 0; y < height; y++) {
    const by = (y / block) | 0
    for (let x = 0; x < width; x++) {
      const i = by * bw + ((x / block) | 0)
      sum[i] += gray[y * width + x]; count[i]++
    }
  }
  for (let i = 0; i < sum.length; i++) sum[i] /= count[i] || 1

  const bg = (x, y) => {
    const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5))
    const fy = Math.min(bh - 1, Math.max(0, y / block - 0.5))
    const x0 = fx | 0, y0 = fy | 0
    const x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1)
    const tx = fx - x0, ty = fy - y0
    return sum[y0 * bw + x0] * (1 - tx) * (1 - ty) + sum[y0 * bw + x1] * tx * (1 - ty)
         + sum[y1 * bw + x0] * (1 - tx) * ty + sum[y1 * bw + x1] * tx * ty
  }

  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mask[y * width + x] = gray[y * width + x] < bg(x, y) - offset ? 1 : 0
    }
  }
  return mask
}

/**
 * 3×3 erosion — keep a pixel only if all eight neighbours are set.
 *
 * Used for DETECTION only. Speckle that lands touching a registration square
 * joins its blob, stretching the bounding box and dropping `fill` below the
 * threshold, so the square goes missing — a stray dot should not disqualify a
 * mark the reader depends on. Erosion severs those one-pixel attachments while
 * a solid 10px+ square survives intact.
 *
 * The returned mask is deliberately NOT eroded: `sampleDarkness` reads it, and
 * thinning the ink there would bias every bubble toward empty.
 */
function erode(mask, width, height) {
  const out = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (!mask[i]) continue
      if (mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width] &&
          mask[i - width - 1] && mask[i - width + 1] &&
          mask[i + width - 1] && mask[i + width + 1]) out[i] = 1
    }
  }
  return out
}

/** 8-connected components, with their bounding boxes and centroids. */
export function connectedComponents(mask, width, height, minPx = 40) {
  const seen = new Uint8Array(width * height)
  const stack = new Int32Array(width * height)
  const blobs = []
  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || seen[start]) continue
    let sp = 0
    stack[sp++] = start; seen[start] = 1
    let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, sx = 0, sy = 0
    while (sp) {
      const idx = stack[--sp]
      const x = idx % width, y = (idx / width) | 0
      n++; sx += x; sy += y
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni }
        }
      }
    }
    if (n < minPx) continue
    const w = x1 - x0 + 1, h = y1 - y0 + 1
    blobs.push({ n, x: x0, y: y0, w, h, cx: sx / n, cy: sy / n, fill: n / (w * h) })
  }
  return blobs
}

/**
 * Registration squares in a photographed sheet.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @returns {{squares:object[], mask:Uint8Array, stats:{blobs:number}}}
 */
export function detectRegistrationSquares(image, {
  fillMin = SQUARE_FILL_MIN, sizeHint = SIZE_HINT, binarizeOptions,
} = {}) {
  const { width, height } = image
  const gray = toGrayscale(image)
  const mask = binarize(gray, width, height, binarizeOptions)
  // A square this small is noise; scaling the floor with the frame keeps the
  // detector honest at any resolution.
  const expected = width * sizeHint
  const minPx = Math.max(12, Math.round((expected * SIZE_MIN_FACTOR) ** 2 * 0.5))
  const blobs = connectedComponents(erode(mask, width, height), width, height, minPx)
  const squares = blobs.filter(b => {
    const aspect = b.w / b.h
    // Erosion trims a pixel from each side, so compare against the eroded size.
    return aspect > ASPECT_MIN && aspect < ASPECT_MAX &&
      b.fill > fillMin &&
      b.w + 2 > expected * SIZE_MIN_FACTOR && b.w + 2 < expected * SIZE_MAX_FACTOR
  }).map(b => ({ ...b, w: b.w + 2, h: b.h + 2, x: b.x - 1, y: b.y - 1 }))
  // `candidates` counts solid blobs that survived erosion; `rejected` is how
  // many of those failed the shape or size test. Both are diagnostics for a bad
  // capture — lots of candidates and few squares means the sheet is there but
  // out of focus or badly lit, which is a different problem from finding nothing.
  return {
    squares,
    mask,
    stats: {
      candidates: blobs.length,
      rejected: blobs.length - squares.length,
      expectedSize: expected,
    },
  }
}

/**
 * How dark is the bubble at (cx, cy)?
 *
 * Samples INSIDE the printed outline. At the full radius every empty bubble
 * counts its own border and scores as partly filled, which pushes the whole
 * sheet toward the ambiguous band.
 */
export function sampleDarkness(mask, width, height, cx, cy, radius, inset = 0.62) {
  const r = Math.max(1, radius * inset)
  let dark = 0, total = 0
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      total++
      if (mask[y * width + x]) dark++
    }
  }
  return total ? dark / total : 0
}
