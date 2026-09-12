// The class exam report as Word (.docx) — the editable companion to the PDF.
//
// Why both. The PDF (`examPdf.js`) typesets its question cards by rendering
// HTML with KaTeX and embedding the capture as an IMAGE: correct on the page,
// but not selectable, not searchable and not editable, and it grew the file
// from ~200 KB to ~1.0 MB. Word gets real OMML a teacher can click into, which
// is what someone lifting a question into a worksheet actually needs.
//
// It also carries what the PDF cannot: the WORKED SOLUTION. 13,404 of 13,568
// stored questions have one and the PDF prints none of them — there is no room
// on an A4 card and jsPDF cannot typeset them anyway.
//
// MCQ only, by decision (EXAM_REPORT_DOCX.md D2). A written paper records a
// total and nothing else, so this document would carry nothing its PDF does not
// already carry well. The builder still degrades gracefully if handed one — the
// question sections are empty by construction — but the UI does not offer it.
//
// Every NUMBER here comes from the same exported builders the PDF uses
// (`buildStatBoxes`, `buildAllStudentsTable`, `getExam*`). Nothing is
// re-derived: a second implementation of "median" is how two surfaces end up
// quoting different figures to the same parent.

import {
  getExamTopStudents, getExamBottomStudents,
  getExamWrongQuestions, getExamSkippedQuestions,
  getExamToppers, getExamScoreSummary, examMaxMarks, examFormat,
} from './analytics'
import { buildStatBoxes, buildAllStudentsTable, examPdfSchemeLabel } from './examPdf'
import { parseTableBlocks } from './richText'
import { createMathRenderer, applyOmml } from './docxMath'

const MARGIN = 720               // 0.5" in twips
const FONT = 'Cambria'
const SIZE = 20                  // 10pt, in half-points
const SMALL = 16                 // 8pt
const TITLE_SIZE = 30            // 15pt
const SECTION_SIZE = 22          // 11pt

// Mirrors examPdf.js's palette so the two documents read as one report.
const INK = '0F172A'
const INK2 = '475569'
const INK3 = '94A3B8'
const ACCENT = '2563EB'
const SUCCESS = '16A34A'
const WRONG_BG = 'FEE2E2'
const SKIPPED_BG = 'FEF3C7'
const WRONG_FG = 'DC2626'
const SKIPPED_FG = 'CA8A04'
const SURFACE = 'F1F5F9'

const LETTERS = ['A', 'B', 'C', 'D']

// Progress checkpoints. Like the practice set, the build is one long
// synchronous CPU block (KaTeX per equation, then Packer, then the JSZip
// patch), so `onProgress` is AWAITED — the caller's yielded frame is the only
// reason a bar can move.
const P = { deps: 6, overview: 20, questions: 40, students: 80, pack: 88, equations: 94, done: 100 }

/**
 * @param exam            the exam record, as the Exams page holds it
 * @param includeSolutions  D3 — default on; the UI offers a checkbox
 * @param onProgress      (pct, label) => void | Promise
 * @returns {Promise<Blob>}
 */
export async function buildExamReportDocx({ exam, includeSolutions = true, onProgress }) {
  const report = typeof onProgress === 'function'
    ? (pct, label) => onProgress(Math.round(pct), label)
    : () => {}

  await report(0, 'Loading the builder…')
  const [docxMod, JSZipMod] = await Promise.all([
    import('docx'),
    import('jszip'),
  ])
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, PageOrientation, PageBreak,
    Header, Footer, PageNumber,
  } = docxMod
  const JSZip = JSZipMod.default
  await report(P.deps, 'Loading the builder…')

  // One renderer per document: the OMML it collects is positional.
  const { mathRuns, contentTable, TABLE_BORDERS, ommlByIndex } = await createMathRenderer(docxMod)

  const maxM = examMaxMarks(exam)
  const written = examFormat(exam) === 'written'

  // ── small builders ────────────────────────────────────────────────────────
  const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), size: SIZE, ...o })
  const para = (children, o = {}) => new Paragraph({ children, ...o })
  const blank = () => new Paragraph({ children: [] })

  const cell = (children, o = {}) => new TableCell({
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.shade ? { fill: o.shade } : undefined,
    children: Array.isArray(children) ? children : [children],
  })
  const textCell = (text, o = {}) => cell(
    para([run(text, { bold: o.bold, color: o.color, size: o.size ?? SIZE })],
      { alignment: o.align }),
    o,
  )

  const table = rows => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows,
  })

  // A section rule, matching the PDF's small-caps label over a hairline.
  const sectionLabel = text => para(
    [run(text.toUpperCase(), { bold: true, size: SMALL, color: INK3 })],
    {
      spacing: { before: 260, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 1 } },
    },
  )

  // Prose that may carry a GFM pipe-table, as paragraphs + real Word tables.
  const proseBlocks = (text, extra = {}) => {
    const out = []
    parseTableBlocks(text).forEach(b => {
      if (b.kind === 'table') out.push(contentTable(b))
      else out.push(para(mathRuns(b.text, extra)))
    })
    return out.length ? out : [para(mathRuns('', extra))]
  }

  // ── title block ───────────────────────────────────────────────────────────
  // The exam name goes in VERBATIM. jsPDF has to substitute English for a
  // Devanagari title (its fonts are WinAnsi and it has no shaping engine);
  // Word shapes the text itself, so there is nothing to work around here.
  const children = []
  children.push(para(
    [run('LWS PUNE — NDA MATHS TRACKER', { bold: true, size: SMALL, color: ACCENT })],
  ))
  children.push(para([run(exam.name, { bold: true, size: TITLE_SIZE, color: INK })]))
  children.push(para([run(
    [exam.date, exam.subject || 'Maths', exam.batch, exam.branch]
      .filter(Boolean).join('  ·  ') + `  ·  ${examPdfSchemeLabel(exam)}`,
    { size: SMALL, color: INK2 },
  )], { spacing: { after: 120 } }))

  // ── class overview ────────────────────────────────────────────────────────
  await report(P.overview, 'Building the overview…')
  children.push(sectionLabel('Class Overview'))

  const boxes = buildStatBoxes(exam)
  children.push(table([
    new TableRow({
      tableHeader: true,
      children: boxes.map(b => textCell(b.label, {
        bold: true, size: SMALL, color: INK2, shade: SURFACE,
        align: AlignmentType.CENTER, width: Math.floor(100 / boxes.length),
      })),
    }),
    new TableRow({
      children: boxes.map(b => cell([
        para([run(b.value, { bold: true, size: 26 })], { alignment: AlignmentType.CENTER }),
        ...(b.sub ? [para([run(b.sub, { size: SMALL, color: INK3 })],
          { alignment: AlignmentType.CENTER })] : []),
      ])),
    }),
  ]))

  if (exam.students.length > 0) {
    const { median, count } = getExamScoreSummary(exam)
    const above50 = exam.students.filter(s => maxM > 0 && s.totalMarks / maxM >= 0.5).length
    children.push(para(
      [run(`Median: ${median}  ·  Students above 50%: ${above50} of ${count}`,
        { size: SMALL, color: INK2 })],
      { spacing: { before: 120 } },
    ))
  }

  // ── top & bottom students ─────────────────────────────────────────────────
  // Stacked, not side by side: two tables abreast in Word needs a wrapper table
  // and buys nothing on a page that is not short of room.
  const studentTable = (title, rows, fill, rankOf) => {
    children.push(para([run(title, { bold: true, size: SECTION_SIZE })],
      { spacing: { before: 200, after: 60 } }))
    children.push(table([
      new TableRow({
        tableHeader: true,
        children: ['#', 'Student', 'Score', '%'].map((h, i) => textCell(h, {
          bold: true, size: SMALL, color: INK2, shade: fill,
          width: [8, 62, 15, 15][i],
          align: i > 1 ? AlignmentType.CENTER : undefined,
        })),
      }),
      ...rows.map((s, i) => new TableRow({
        children: [
          textCell(rankOf(i), { align: AlignmentType.CENTER }),
          textCell(s.name),
          textCell(s.score, { bold: true, align: AlignmentType.CENTER }),
          textCell(`${Math.round(s.pct * 100)}%`, { bold: true, align: AlignmentType.CENTER }),
        ],
      })),
    ]))
  }

  const top = getExamTopStudents(exam, 5)
  const bottom = getExamBottomStudents(exam, 5)
  if (top.length || bottom.length) {
    children.push(sectionLabel('Student Performance'))
    if (top.length) studentTable('Top 5 Students', top, SURFACE, i => i + 1)
    if (bottom.length) {
      studentTable('Bottom 5 Students', bottom, SURFACE,
        i => exam.students.length - bottom.length + i + 1)
    }
  }

  // ── question sections ─────────────────────────────────────────────────────
  // Empty by construction for a written paper: no questions[], so every
  // getExam* call below returns [].
  await report(P.questions, 'Rendering questions…')

  const summaryTable = (items, type) => {
    const isWrong = type === 'wrong'
    const countKey = isWrong ? 'wrong' : 'skipped'
    const rateKey = isWrong ? 'wrongRate' : 'skipRate'
    return table([
      new TableRow({
        tableHeader: true,
        children: ['Q#', 'Chapter', 'Subtopic', isWrong ? 'Wrong' : 'Skipped', 'Rate']
          .map((h, i) => textCell(h, {
            bold: true, size: SMALL, color: INK2,
            shade: isWrong ? WRONG_BG : SKIPPED_BG,
            width: [8, 27, 39, 13, 13][i],
            align: i > 2 ? AlignmentType.CENTER : undefined,
          })),
      }),
      ...items.map(item => new TableRow({
        children: [
          textCell(`Q${item.q.q}`, { bold: true, align: AlignmentType.CENTER }),
          textCell(item.q.chapter || '—'),
          textCell(item.q.subtopic || '—'),
          textCell(item[countKey], { bold: true, align: AlignmentType.CENTER }),
          textCell(`${Math.round(item[rateKey] * 100)}%`, {
            bold: true, color: isWrong ? WRONG_FG : SKIPPED_FG, align: AlignmentType.CENTER,
          }),
        ],
      })),
    ])
  }

  // One card = one bordered, shaded cell. That is how you draw a card outline in
  // Word; a bare run of paragraphs reads as undifferentiated prose.
  const questionCard = (item, type) => {
    const isWrong = type === 'wrong'
    const q = item.q
    const count = item[isWrong ? 'wrong' : 'skipped']
    const rate = Math.round((item[isWrong ? 'wrongRate' : 'skipRate'] || 0) * 100)

    const inner = []
    inner.push(para([
      run(`Q${q.q}  ·  ${q.chapter || '—'}${q.subtopic ? `  ·  ${q.subtopic}` : ''}`,
        { bold: true, size: SMALL, color: isWrong ? WRONG_FG : SKIPPED_FG }),
      run(`     ${isWrong ? 'Wrong' : 'Skipped'}: ${count} (${rate}%)`,
        { size: SMALL, color: INK2 }),
    ]))
    inner.push(...proseBlocks(q.question || ''))

    const answer = String(q.answer || '').trim().toUpperCase()
    LETTERS.forEach(letter => {
      const text = q[`option${letter}`]
      if (text === undefined || text === null || String(text) === '') return
      const correct = answer === letter
      inner.push(para([
        run(`(${letter}) `, { bold: correct, color: correct ? SUCCESS : INK2 }),
        ...mathRuns(String(text), correct ? { bold: true, color: SUCCESS } : { color: INK2 }),
      ]))
    })

    if (q.answer || q.difficulty) {
      inner.push(para([
        ...(q.answer ? [run(`Answer: ${q.answer}`, { bold: true, color: SUCCESS, size: SMALL })] : []),
        ...(q.difficulty ? [run(`     Difficulty: ${q.difficulty}`, { color: INK3, size: SMALL })] : []),
      ]))
    }

    if (includeSolutions) {
      inner.push(para([run('Solution', { bold: true, size: SMALL, color: INK2 })],
        { spacing: { before: 100 } }))
      const sol = String(q.solution || '').trim()
      if (sol) inner.push(...proseBlocks(sol))
      // Named, not skipped: a silent gap reads as "this one has no answer".
      else inner.push(para([run('No worked solution recorded for this question.',
        { italics: true, size: SMALL, color: INK3 })]))
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [new TableRow({
        children: [new TableCell({ shading: { fill: 'F8FAFC' }, children: inner })],
      })],
    })
  }

  const questionSection = (items, type, title) => {
    if (!items.length) return
    children.push(para([run(title, { bold: true, size: SECTION_SIZE })],
      { spacing: { before: 200, after: 60 } }))
    children.push(summaryTable(items, type))
    items.forEach(item => {
      children.push(blank())
      children.push(questionCard(item, type))
    })
  }

  // The caps stay at 5, matching the PDF (D4). The number is NOT a parameter —
  // an unused knob is where two surfaces start to disagree about what "most
  // challenging" means.
  const wrong = written ? [] : getExamWrongQuestions(exam, null, 5)
  const skipped = written ? [] : getExamSkippedQuestions(exam, null, 5)

  if (wrong.length || skipped.length) {
    children.push(sectionLabel('Most Challenging Questions — All Students'))
    questionSection(wrong, 'wrong', 'Top 5 Most Wrong Questions')
    questionSection(skipped, 'skipped', 'Top 5 Most Skipped Questions')
  }

  const { names, count: topperCount, cutoffScore } = getExamToppers(exam, 0.25)
  const cutoffPct = maxM > 0 ? Math.round(cutoffScore / maxM * 100) : 0
  const tWrong = written ? [] : getExamWrongQuestions(exam, names, 5)
  const tSkipped = written ? [] : getExamSkippedQuestions(exam, names, 5)

  if (tWrong.length || tSkipped.length) {
    children.push(sectionLabel(
      `Topper Analysis — Top 25% (${topperCount} students · cutoff ≥ ${cutoffScore}, ${cutoffPct}%)`))
    questionSection(tWrong, 'wrong', 'Wrong Questions Among Toppers')
    questionSection(tSkipped, 'skipped', 'Skipped Questions Among Toppers')
  }

  // ── all students ──────────────────────────────────────────────────────────
  await report(P.students, 'Listing students…')
  if (exam.students.length > 0) {
    children.push(para([new TextRun({ children: [new PageBreak()] })]))
    children.push(sectionLabel(`All Students — ${exam.students.length} total`))
    const { head, body } = buildAllStudentsTable(exam)
    const widths = head[0].length === 4 ? [10, 55, 17, 18] : [8, 40, 13, 11, 9, 9, 10]
    children.push(table([
      new TableRow({
        tableHeader: true,
        children: head[0].map((h, i) => textCell(h, {
          bold: true, size: SMALL, color: 'FFFFFF', shade: ACCENT, width: widths[i],
          align: i > 1 ? AlignmentType.CENTER : undefined,
        })),
      }),
      ...body.map(row => new TableRow({
        children: row.map((v, i) => textCell(v, {
          size: SMALL,
          bold: i === 2 || i === 3,
          align: i > 1 ? AlignmentType.CENTER : undefined,
        })),
      })),
    ]))
  }

  // ── document ──────────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },  // A4
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: { default: new Header({ children: [] }) },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: `LWS Pune · NDA Tracker · Generated ${today}    `, size: 14, color: INK3 }),
              new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 14, color: INK3 }),
            ],
          })],
        }),
      },
      children,
    }],
  })

  await report(P.pack, 'Laying out the document…')
  const blob = await Packer.toBlob(doc)
  const zip = await JSZip.loadAsync(blob)
  await report(P.equations, 'Placing equations…')
  await applyOmml(zip, ommlByIndex)
  const out = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  await report(P.done, 'Done')
  return out
}

/**
 * Word filename for a class report. Same sanitising rule as the monthly-report
 * and error-set helpers — keep [A-Za-z0-9_-], collapse every other run to one
 * underscore — so a title with a colon, a slash or Devanagari cannot produce a
 * name the browser rejects.
 */
export function examReportDocxFilename(examName) {
  const safe = String(examName || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${safe || 'exam'}_insights.docx`
}

export async function downloadExamReportDocx(args) {
  const blob = await buildExamReportDocx(args)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = examReportDocxFilename(args.exam?.name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
