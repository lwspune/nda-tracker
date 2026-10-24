// The calculation-slips PDF (2026-10-24): a cover, then each marked page from
// planSlipPages with what the grader noted printed above it.
//
// Every page, cover included, is drawn on a canvas and placed in the PDF as
// one image. The notes are full of −, ×, λ, μ and ₁, which jsPDF's built-in
// fonts cannot print (Standard-14 fonts are WinAnsi); the browser's fonts can.
// Browser-only: jsdom has no canvas, so the page tests mock this module.

import { slipPageHeader } from './slipPages'

const A4 = { w: 210, h: 297 }
const MARGIN = 8 // mm
const COVER = { w: 1240, h: 1754 } // A4 at 150 dpi
const FONT = 'system-ui, "Segoe UI", Arial, sans-serif'
const INK = '#111827'
const SLIP = '#b91c1c'
const MUTED = '#4b5563'

const REASON = {
  deleted: 'pages deleted 30 days after grading',
  no_pages: 'no marked page to show',
}

// Greedy word wrap against the canvas's own measure.
function wrap(ctx, text, maxWidth) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

// blocks: [{ text, size, weight, color, before }] → [{ text, font, color, y }]
// laid out top-down from `top`; `before` is extra space above, as a multiple of size.
function layout(ctx, blocks, maxWidth, top) {
  const out = []
  let y = top
  for (const b of blocks) {
    const font = `${b.weight ?? 400} ${b.size}px ${FONT}`
    ctx.font = font
    y += (b.before ?? 0) * b.size
    for (const text of wrap(ctx, b.text, maxWidth)) {
      y += b.size * 1.35
      out.push({ text, font, color: b.color ?? INK, y })
    }
  }
  return { lines: out, bottom: y }
}

function paint(ctx, lines, x) {
  ctx.textBaseline = 'alphabetic'
  for (const l of lines) {
    ctx.font = l.font
    ctx.fillStyle = l.color
    ctx.fillText(l.text, x, l.y)
  }
}

function canvasOf(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  return { c, ctx }
}

async function loadBitmap(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return createImageBitmap(await r.blob())
}

// The marked page with its header strip above it, no wider than A4 at 150 dpi:
// the marked pages are 1500 px wide, and full size made a 22-student PDF 14.6 MB.
function composePage(entry, bitmap) {
  const w = Math.min(bitmap.width, COVER.w)
  const pageH = Math.round(bitmap.height * (w / bitmap.width))
  const pad = Math.round(w * 0.03)
  const size = Math.max(16, Math.round(w / 48))
  const header = slipPageHeader(entry)
  const blocks = [
    { text: header.title, size: Math.round(size * 1.15), weight: 700 },
    ...header.lines.map(text => ({ text, size, color: SLIP, before: 0.2 })),
  ]
  const measure = canvasOf(1, 1).ctx
  const { bottom } = layout(measure, blocks, w - 2 * pad, pad * 0.4)
  const headerH = Math.ceil(bottom + pad * 0.8)

  const { c, ctx } = canvasOf(w, headerH + pageH)
  paint(ctx, layout(ctx, blocks, w - 2 * pad, pad * 0.4).lines, pad)
  ctx.fillStyle = '#d1d5db'
  ctx.fillRect(pad, headerH - Math.max(2, Math.round(w / 600)), w - 2 * pad, Math.max(2, Math.round(w / 600)))
  ctx.drawImage(bitmap, 0, headerH, w, pageH)
  return c
}

// The cover's text, flowed over as many A4 canvases as it needs.
function composeCover({ title, subtitle, plan, failed }) {
  const students = new Map()
  for (const p of plan.pages) {
    if (!students.has(p.studentName)) students.set(p.studentName, [])
    students.get(p.studentName).push(p.page)
  }
  const shown = plan.pages.length - failed.length
  const blocks = [
    { text: title, size: 44, weight: 700 },
    { text: subtitle, size: 24, color: MUTED, before: 0.2 },
    { text: 'Calculation slips', size: 30, weight: 700, before: 1.2 },
    {
      text: `${shown} page${shown === 1 ? '' : 's'} from ${students.size} student${students.size === 1 ? '' : 's'}, in name order. `
        + 'Each page is the student\'s marked work, with the slips the grader noted printed above it.',
      size: 24, before: 0.3,
    },
    ...[...students].map(([name, pages], i) => ({
      text: `${name}: page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}`, size: 24, before: i === 0 ? 0.8 : 0,
    })),
  ]
  const gaps = [
    ...plan.missing.map(m => `${m.studentName}: ${m.questions.join(', ')} (${REASON[m.reason] ?? m.reason})`),
    ...failed.map(f => `${f.studentName}: page ${f.page} (could not be loaded)`),
  ]
  if (gaps.length) {
    blocks.push({ text: 'Not included', size: 30, weight: 700, color: SLIP, before: 1.2 })
    gaps.forEach((text, i) => blocks.push({ text, size: 24, before: i === 0 ? 0.3 : 0 }))
  }

  const pad = 100
  const { ctx: measure } = canvasOf(1, 1)
  const { lines } = layout(measure, blocks, COVER.w - 2 * pad, pad)
  const canvases = []
  let page = []
  let offset = 0
  for (const l of lines) {
    if (l.y - offset > COVER.h - pad) {
      canvases.push(page)
      page = []
      offset = l.y - pad - 30
    }
    page.push({ ...l, y: l.y - offset })
  }
  canvases.push(page)
  return canvases.map(pageLines => {
    const { c, ctx } = canvasOf(COVER.w, COVER.h)
    paint(ctx, pageLines, pad)
    return c
  })
}

// Fit the canvas inside the page's margins, keeping its shape.
function place(doc, canvas, first) {
  if (!first) doc.addPage()
  const maxW = A4.w - 2 * MARGIN
  const maxH = A4.h - 2 * MARGIN
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height)
  const w = canvas.width * scale
  const h = canvas.height * scale
  doc.addImage(canvas.toDataURL('image/jpeg', 0.8), 'JPEG', (A4.w - w) / 2, MARGIN, w, h)
}

// plan: planSlipPages output. urls: { path: signedUrl }. → Blob (application/pdf)
export async function buildSlipPagesPdf({ title, subtitle, plan, urls }) {
  const { jsPDF } = await import('jspdf')

  // Pages first, so the cover can name any that failed to load.
  const pages = []
  const failed = []
  for (const entry of plan.pages) {
    try {
      const bitmap = await loadBitmap(urls[entry.path])
      pages.push(composePage(entry, bitmap))
      bitmap.close()
    } catch (e) {
      console.error('[homework] slip page failed to load:', entry.path, e)
      failed.push(entry)
    }
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const all = [...composeCover({ title, subtitle, plan, failed }), ...pages]
  all.forEach((canvas, i) => place(doc, canvas, i === 0))
  return doc.output('blob')
}
