// Per-student monthly report card as a Word (.docx) document.
//
// Sits BESIDE monthlyReportPdf.js rather than replacing it — both render the
// same `report` object from monthlyReportBuilder.js, so the two cannot disagree
// about what a student scored. The PDF stays the default: it previews inline in
// WhatsApp, which is how most of these reach parents.
//
// Why Word exists at all: a .docx stores text as plain UTF-8 inside XML and
// leaves rendering to the reader's Word, which has a real complex-script
// shaping engine. So a Marathi or Hindi chapter title comes out correctly with
// no embedded font and no fallback — whereas jsPDF's WinAnsi-only Standard-14
// fonts cannot draw Devanagari at all (see src/lib/pdfSafeText.js). This file
// therefore prints the REAL exam name; the PDF prints the English stand-in.
//
// Conventions follow practiceSetDocx.js: `docx` is dynamic-imported so only
// somebody who clicks Download pays for it.

import { conductBlocks, pctColor, prettyDate } from './monthlyReportPdf'
import { isWinAnsiSafe } from './pdfSafeText'

const INK = '0F172A'
const INK2 = '475569'
const INK3 = '94A3B8'
const ACCENT = '2563EB'
const WHITE = 'FFFFFF'
const ROW_ALT = 'F5F5F5'

// `ascii`/`hAnsi` cover Latin; `cs` is the COMPLEX SCRIPT slot, and it is the
// one that makes Devanagari render. Word substitutes any Devanagari-capable
// font when Nirmala UI is absent (Mac, Android), so naming it is a hint rather
// than a requirement.
const FONT = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Nirmala UI' }

const SIZE = 18        // 9pt, in half-points — matches the PDF's body size
const SIZE_SM = 17
const SIZE_TITLE = 30

function rgbToHex(rgb) {
  return (rgb || []).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ── Pure shapers (unit-tested without touching the docx package) ─────────────

// One row per exam, already formatted. Deliberately mirrors the PDF's row
// construction — same date format, same ABSENT handling, same colour
// thresholds (pctColor is imported, not re-implemented) — differing in exactly
// one respect: the exam name is used verbatim.
export function docxExamRows(report) {
  return (report?.examTable || []).map(row => ({
    label: `${row.examName} (${row.format === 'mcq' ? 'MCQ' : 'Written'})`,
    date: prettyDate(row.date),
    marks: row.attended ? String(row.marks ?? '') : 'ABSENT',
    percentage: row.attended
      ? (row.percentage != null ? `${row.percentage}%` : '')
      : 'ABSENT',
    color: row.attended ? rgbToHex(pctColor(row.percentage)) : 'DC2626',
  }))
}

// Does this report contain a title the PDF cannot print? Drives the "Word shows
// these correctly" hint on the Monthly Reports page. Detects the CONTENT rather
// than assuming a class: 9th/10th are where the language papers are today, but
// four of those teachers already type Latin titles, and nothing stops a
// Devanagari title appearing elsewhere tomorrow.
export function hasNonLatinExamTitle(report) {
  return (report?.examTable || []).some(r => !isWinAnsiSafe(r.examName))
}

function safeFile(s) {
  return (s || 'student').replace(/[^A-Za-z0-9_-]+/g, '_')
}

export function docxFilename(name, rangeLabel) {
  return `${safeFile(name)}_${safeFile(rangeLabel)}_Report.docx`
}

// ── Document ────────────────────────────────────────────────────────────────

export async function buildMonthlyReportDocxBlob(report, { remark = '' } = {}) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle, ShadingType,
  } = await import('docx')

  const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: SIZE, ...o })
  const NO_BORDERS = {
    top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  }

  function cell(children, { shade, width, align } = {}) {
    return new TableCell({
      children: [new Paragraph({ children, alignment: align ?? AlignmentType.LEFT })],
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 110, right: 110 },
      borders: NO_BORDERS,
    })
  }

  const children = []

  // Header
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [run('REPORT CARD', { bold: true, size: SIZE_TITLE, color: INK })],
  }))
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 220 },
    children: [run('LWS PUNE', { bold: true, size: 20, color: ACCENT })],
  }))
  children.push(new Paragraph({
    children: [run('Name:      ', { color: INK2 }), run(report?.meta?.name || '—', { bold: true, color: INK })],
  }))
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [run('Period:    ', { color: INK2 }), run(report?.meta?.rangeLabel || '', { bold: true, color: INK })],
  }))

  // Exam table
  const rows = docxExamRows(report)
  if (rows.length === 0) {
    children.push(new Paragraph({ children: [run('No exams taken this period.', { italics: true, color: INK2 })] }))
  } else {
    const head = new TableRow({
      tableHeader: true,
      children: [
        cell([run('Subject', { bold: true, color: WHITE })], { shade: INK, width: 52 }),
        cell([run('Date', { bold: true, color: WHITE })], { shade: INK, width: 20, align: AlignmentType.RIGHT }),
        cell([run('Marks', { bold: true, color: WHITE })], { shade: INK, width: 12, align: AlignmentType.RIGHT }),
        cell([run('Percentage', { bold: true, color: WHITE })], { shade: INK, width: 16, align: AlignmentType.RIGHT }),
      ],
    })
    const body = rows.map((r, i) => {
      const shade = i % 2 === 0 ? ROW_ALT : undefined
      const absent = r.marks === 'ABSENT'
      return new TableRow({
        children: [
          cell([run(r.label, { color: INK })], { shade }),
          cell([run(r.date, { color: INK2 })], { shade, align: AlignmentType.RIGHT }),
          cell([run(r.marks, { color: absent ? r.color : INK, bold: absent })], { shade, align: AlignmentType.RIGHT }),
          cell([run(r.percentage, { bold: true, color: r.color })], { shade, align: AlignmentType.RIGHT }),
        ],
      })
    })
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] }))
  }

  // Conduct — the same blocks the PDF draws, so the two can never diverge.
  for (const b of conductBlocks(report)) {
    children.push(new Paragraph({
      spacing: { before: 220, after: 40 },
      children: [run(b.label, { bold: true, color: INK, size: SIZE_SM })],
    }))
    children.push(new Paragraph({
      children: [run(b.value || '', {
        color: b.label === 'ATTENDANCE'
          ? rgbToHex(pctColor(report?.attendance?.attendancePercentage))
          : INK2,
        size: SIZE_SM,
      })],
    }))
  }

  if (remark && remark.trim()) {
    children.push(new Paragraph({
      spacing: { before: 220, after: 40 },
      children: [run('REMARK', { bold: true, color: INK, size: SIZE_SM })],
    }))
    children.push(new Paragraph({ children: [run(remark.trim(), { color: INK2, size: SIZE_SM })] }))
  }

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 500 },
    children: [run('Please visit the institute for further discussion', { italics: true, color: INK3, size: 16 })],
  }))

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      children,
    }],
  })

  return Packer.toBlob(doc)
}

export async function downloadMonthlyReportDocx(report, { remark = '' } = {}) {
  const blob = await buildMonthlyReportDocxBlob(report, { remark })
  const filename = docxFilename(report?.meta?.name, report?.meta?.rangeLabel)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return filename
}
