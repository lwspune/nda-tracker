// Render an OMR answer sheet to PDF from the shared layout.
//
// This module owns INK ONLY. Every coordinate comes from `layout.js`, which the
// reader will also use — if the renderer ever nudges a bubble "to look right",
// the reader samples the wrong spot and misreads a real student's answer. Draw
// what the layout says or change the layout.
//
// jsPDF is dynamic-imported, matching `examPdf.js`: nobody who never prints a
// sheet pays for the library.

import { buildSheetLayout } from './layout'

const BLACK = [0, 0, 0]
const LINE_W = 0.25
const FONT = { number: 7, option: 7, roll: 7, header: 9, stamp: 5.5 }

// Bumped whenever the geometry changes. Printed on the sheet because sheets
// outlive deployments: a stack printed from v1 and read by a v2 reader would
// misread silently, and the stamp is what makes that diagnosable by eye.
export const LAYOUT_VERSION = 'v1'

function drawHeader(doc, sheet, meta) {
  const { header } = sheet
  const rowH = header.height / header.fields.length
  doc.setLineWidth(LINE_W)
  doc.setFontSize(FONT.header)
  header.fields.forEach((label, i) => {
    const y = header.y + i * rowH
    doc.rect(header.x, y, header.width, rowH, 'S')
    doc.text(`${label} :`, header.x + 2.5, y + rowH / 2 + 1)
  })
  const stamp = [
    `OMR ${LAYOUT_VERSION}`,
    `${sheet.questions.length}Q`,
    meta?.title,
  ].filter(Boolean).join(' · ')
  doc.setFontSize(FONT.stamp)
  doc.text(stamp, header.x + header.width - 2, header.y - 1.2, { align: 'right' })
}

function drawRegistration(doc, sheet) {
  doc.setFillColor(...BLACK)
  for (const s of sheet.registration) doc.rect(s.x, s.y, s.size, s.size, 'F')
}

function drawRoll(doc, sheet) {
  const { roll } = sheet
  doc.setFontSize(FONT.roll)
  doc.text(roll.label.text, roll.label.x, roll.label.y + 3)

  doc.setLineWidth(LINE_W)
  for (const col of roll.columns) {
    const b = col.writeBox
    doc.rect(b.x, b.y, b.width, b.height, 'S')
  }
  for (const d of roll.digitLabels) {
    doc.text(String(d.value), d.x, d.y + 1, { align: 'right' })
  }
  for (const col of roll.columns) {
    for (const bub of col.bubbles) doc.circle(bub.x, bub.y, bub.r, 'S')
  }
}

function drawQuestions(doc, sheet) {
  doc.setLineWidth(LINE_W)
  for (const q of sheet.questions) {
    if (q.groupHeader) {
      doc.setFontSize(FONT.option)
      q.groupHeader.labels.forEach((label, i) => {
        doc.text(label, q.options[i].x, q.groupHeader.y + 1.5, { align: 'center' })
      })
    }
    doc.setFontSize(FONT.number)
    doc.text(String(q.q), q.x + 6, q.y + 1, { align: 'right' })
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

  for (const sheet of layout.sheets) {
    doc.setDrawColor(...BLACK)
    drawHeader(doc, sheet, meta)
    drawRegistration(doc, sheet)
    drawRoll(doc, sheet)
    drawQuestions(doc, sheet)
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
