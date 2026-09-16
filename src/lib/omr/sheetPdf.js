// Render an OMR answer sheet to PDF from the shared layout.
//
// This module owns INK ONLY. Every coordinate comes from `layout.js`, which the
// reader will also use — if the renderer ever nudges a bubble "to look right",
// the reader samples the wrong spot and misreads a real student's answer. Draw
// what the layout says or change the layout.
//
// jsPDF is dynamic-imported, matching `examPdf.js`: nobody who never prints a
// sheet pays for the library.

import { buildSheetLayout, textWidthMm } from './layout'
import { downloadBlob, safeFilename } from '../download'

const BLACK = [0, 0, 0]
const LINE_W = 0.25
// Type sizes come from the LAYOUT, not from here: they scale with the bubble, and
// a fixed size that reads well at 3.8mm collides with itself at 2.85mm.

// Bumped whenever the geometry changes. Printed on the sheet because sheets
// outlive deployments: a stack printed from v1 and read by a v2 reader would
// misread silently, and the stamp is what makes that diagnosable by eye.
export const LAYOUT_VERSION = 'v1'

// Every coordinate already comes from the layout in PAGE space; the only thing
// the renderer adds is the text angle, since a rotated (two-up) sheet needs its
// labels turned with it.
const textOpts = (sheet, extra = {}) =>
  sheet.textAngle ? { ...extra, angle: sheet.textAngle } : extra

/**
 * The stamp, trimmed to the run the layout reserved for it.
 *
 * Trimmed from the TITLE end: the version and the question count are what a
 * mismatched sheet is spotted by, and a shortened name still identifies the
 * paper. Letting it overrun instead is what this whole function exists to stop.
 */
function fitStamp(text, maxWidth, pt) {
  if (textWidthMm(text, pt) <= maxWidth) return text
  let s = text
  while (s.length > 1 && textWidthMm(`${s}…`, pt) > maxWidth) s = s.slice(0, -1)
  return `${s}…`
}

function drawHeader(doc, sheet, meta, fonts) {
  const { header } = sheet
  doc.setLineWidth(LINE_W)
  doc.setFontSize(fonts.header)
  for (const row of header.rows) {
    doc.rect(row.x, row.y, row.width, row.height, 'S')
    doc.text(`${row.label} :`, row.labelAnchor.x, row.labelAnchor.y, textOpts(sheet))
  }
  const stamp = fitStamp([
    `OMR ${LAYOUT_VERSION}`,
    `${sheet.questions.length}Q`,
    meta?.title,
  ].filter(Boolean).join(' · '), header.stampMaxWidth, fonts.stamp)

  doc.setFontSize(fonts.stamp)
  // Right-aligned by measuring and walking BACK from the run's end along the
  // sheet's own +x axis. jsPDF's `align: 'right'` cannot do this — under
  // rotation it does not shift the anchor back along a rotated baseline, the
  // same trap layout.js documents for the question numbers. `axis` comes from
  // the layout so the transform stays in one place.
  const w = textWidthMm(stamp, fonts.stamp)
  doc.text(
    stamp,
    header.stampEnd.x - w * sheet.axis.x,
    header.stampEnd.y - w * sheet.axis.y,
    textOpts(sheet),
  )
}

function drawRegistration(doc, sheet) {
  doc.setFillColor(...BLACK)
  for (const s of sheet.registration) doc.rect(s.x, s.y, s.size, s.size, 'F')
}

function drawRoll(doc, sheet, fonts) {
  const { roll } = sheet
  doc.setFontSize(fonts.roll)
  doc.text(roll.label.text, roll.label.x, roll.label.y, textOpts(sheet, { baseline: 'top' }))

  doc.setLineWidth(LINE_W)
  for (const col of roll.columns) {
    const b = col.writeBox
    doc.rect(b.x, b.y, b.width, b.height, 'S')
  }
  for (const d of roll.digitLabels) {
    doc.text(String(d.value), d.x, d.y, textOpts(sheet, { baseline: 'middle' }))
  }
  for (const col of roll.columns) {
    for (const bub of col.bubbles) doc.circle(bub.x, bub.y, bub.r, 'S')
  }
}

function drawQuestions(doc, sheet, fonts) {
  doc.setLineWidth(LINE_W)
  for (const q of sheet.questions) {
    if (q.groupHeader) {
      doc.setFontSize(fonts.option)
      q.groupHeader.labels.forEach((label, i) => {
        const a = q.groupHeader.anchors[i]
        doc.text(label, a.x, a.y, textOpts(sheet, { baseline: 'middle' }))
      })
    }
    doc.setFontSize(fonts.number)
    doc.text(String(q.q), q.numberAnchor.x, q.numberAnchor.y,
      textOpts(sheet, { baseline: 'middle' }))
    for (const o of q.options) doc.circle(o.x, o.y, o.r, 'S')
  }
}

/**
 * @param {object} layout  from `buildSheetLayout`
 * @param {object} [meta]  `{ title }` — printed small in the header stamp
 * @returns {Promise<Blob>} application/pdf
 */
export async function renderOmrSheetPdf(layout, meta = {}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({
    orientation: layout.page.height >= layout.page.width ? 'portrait' : 'landscape',
    unit: layout.unit,
    format: [layout.page.width, layout.page.height],
  })
  doc.setFont('helvetica', 'normal')
  const fonts = layout.geometry.fonts

  for (const sheet of layout.sheets) {
    doc.setDrawColor(...BLACK)
    drawHeader(doc, sheet, meta, fonts)
    drawRegistration(doc, sheet)
    drawRoll(doc, sheet, fonts)
    drawQuestions(doc, sheet, fonts)
  }

  if (layout.cutLine != null) {
    doc.setLineWidth(0.2)
    doc.setLineDashPattern([1.5, 1.5], 0)
    doc.line(0, layout.cutLine, layout.page.width, layout.cutLine)
    doc.setLineDashPattern([], 0)
  }

  return doc.output('blob')
}

/** Convenience: build the layout and render it in one call. */
export async function buildOmrSheetPdf(opts = {}) {
  const { title, ...layoutOpts } = opts
  return renderOmrSheetPdf(buildSheetLayout(layoutOpts), { title })
}

/**
 * The answer sheet for an exam, downloaded.
 *
 * The sheet is GENERIC — it carries no exam identity, only a question count —
 * so one print run can be photocopied and used for any paper of that length,
 * and the operator picks the exam when scanning. The exam here supplies the
 * question count and a title for the header stamp, nothing more.
 */
export async function downloadAnswerSheetPdf(exam, { perPage = 1 } = {}) {
  const questionCount = exam?.questions?.length || 0
  if (!questionCount) throw new Error('This exam has no questions to build a sheet from.')
  const blob = await buildOmrSheetPdf({ questionCount, perPage, title: exam.name })
  const suffix = perPage === 2 ? '_2up' : ''
  downloadBlob(blob, `${safeFilename(exam.name, 'answer_sheet')}_${questionCount}Q${suffix}.pdf`)
}
