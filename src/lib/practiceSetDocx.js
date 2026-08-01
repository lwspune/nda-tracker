// Word (.docx) rendering for a per-student practice set.
//
// Conventions and the maths pipeline are lifted from PYQ Vault's
// src/lib/export/docxBuilder.ts so both apps produce the same-looking paper:
// US Letter, 0.5" margins, Cambria 10pt, two-column question body.
//
// Maths is rendered as REAL Word equations, not ASCII: LaTeX -> temml ->
// MathML -> mathml2omml -> OMML. The `docx` package has no OMML node, so each
// equation is emitted as a marker run and swapped into word/document.xml after
// packing. The <m:mathPr> block is NOT optional — without it Word gives every
// fraction about an inch of phantom left indent.
//
// Every import here is dynamic: docx + temml together are large, and nobody who
// doesn't click Download should pay for them.

const MARGIN = 720               // 0.5" in twips
const FONT = 'Cambria'
const SIZE = 20                  // 10pt, in half-points
const TITLE_SIZE = 28            // 14pt
const SUB_SIZE = 24              // 12pt
const MARKER = 'OMML_'

const MATH_PR_BLOCK =
  '<m:mathPr>' +
  '<m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/>' +
  '<m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/>' +
  '<m:defJc m:val="left"/><m:wrapIndent m:val="0"/><m:intLim m:val="subSup"/>' +
  '<m:naryLim m:val="undOvr"/></m:mathPr>'

const TAG_COLOR = {
  wrong: 'B00020', skipped: '8A6D00', absent: '555555', right: '0F7B4F',
}

// Math zones: \[..\], $$..$$, \(..\), $..$
const MATH_RE = /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Escape raw <, > and & inside <m:t> — "0 < \alpha" otherwise yields XML Word
// refuses to open.
function sanitizeOmml(omml) {
  return omml.replace(/<m:t([^>]*)>([\s\S]*?)<\/m:t>/g, (_, attrs, body) =>
    `<m:t${attrs}>${body.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')}</m:t>`)
}

export async function buildPracticeSetDocx({ studentName, subject = 'Maths', rows, totals }) {
  const [
    { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, PageOrientation },
    JSZipMod, temmlMod, mml2ommlMod,
  ] = await Promise.all([
    import('docx'),
    import('jszip'),
    import('temml'),
    import('mathml2omml'),
  ])
  const JSZip = JSZipMod.default
  const temml = temmlMod.default || temmlMod
  // mathml2omml exports a NAMED `mml2omml` and no default — `.default || module`
  // silently yields the namespace object, which is not callable, so every
  // equation falls back to stripped text with nothing thrown.
  const mml2omml = mml2ommlMod.mml2omml || mml2ommlMod.default || mml2ommlMod

  const ommlByIndex = []

  const latexToOmml = (latex) => {
    try {
      const mathml = temml.renderToString(latex, { throwOnError: true })
      if (!mathml) return null
      const omml = mml2omml(mathml)
      if (!omml || typeof omml !== 'string' || !omml.includes('m:oMath')) return null
      return sanitizeOmml(omml)
    } catch { return null }
  }

  // Text with inline maths -> runs. A failed conversion falls back to the
  // stripped source rather than dumping raw LaTeX at a student.
  const mathRuns = (text, extra = {}) => {
    const out = []
    const parts = String(text || '').split(MATH_RE)
    parts.forEach(part => {
      if (!part) return
      const isMath = MATH_RE.test(part)
      MATH_RE.lastIndex = 0
      if (isMath) {
        const body = part.replace(/^\\\[|\\\]$/g, '').replace(/^\$\$|\$\$$/g, '')
          .replace(/^\\\(|\\\)$/g, '').replace(/^\$|\$$/g, '')
        const omml = latexToOmml(body)
        if (omml) {
          ommlByIndex.push(omml)
          out.push(new TextRun({ text: `${MARKER}${ommlByIndex.length - 1}` }))
          return
        }
        out.push(new TextRun({ text: body.replace(/[\\{}]/g, ' ').replace(/\s+/g, ' ').trim(), ...extra }))
        return
      }
      part.split('\n').forEach((line, i) => {
        if (i > 0) out.push(new TextRun({ break: 1 }))
        if (line) out.push(new TextRun({ text: line, ...extra }))
      })
    })
    return out.length ? out : [new TextRun({ text: '', ...extra })]
  }

  const EDGE = { style: BorderStyle.SINGLE, size: 4, color: '999999' }
  const blank = () => new Paragraph({ children: [] })
  const cell = (text, header = false, width) => new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: 'EEEEEE' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: header, size: SIZE })] })],
  })

  // ── cover: name + summary table (single column — a 7-column table is
  //    unreadable at half width) ─────────────────────────────────────────────
  const cover = []
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `NDA ${subject} — Personal Practice Set`, bold: true, size: TITLE_SIZE })],
  }))
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: studentName, bold: true, size: SUB_SIZE })],
  }))
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Top ${rows.length} subtopics by marks recoverable`, size: SIZE, color: '666666' })],
  }))
  cover.push(blank())
  cover.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE, insideHorizontal: EDGE, insideVertical: EDGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell('Subtopic', true, 38), cell('Chapter', true, 22),
          cell('Wrong', true, 8), cell('Skipped', true, 8),
          cell('Right', true, 8), cell('Absent', true, 8), cell('Marks lift', true, 8),
        ],
      }),
      ...rows.map(r => new TableRow({
        children: [
          cell(r.subtopic), cell(r.chapter),
          cell(r.counts.wrong), cell(r.counts.skipped),
          cell(r.counts.right), cell(r.counts.absent),
          cell(`+${r.lift.toFixed(1)}`),
        ],
      })),
      new TableRow({
        children: [
          cell('TOTAL', true), cell('', true),
          cell(totals.counts.wrong, true), cell(totals.counts.skipped, true),
          cell(totals.counts.right, true), cell(totals.counts.absent, true),
          cell(`+${totals.lift.toFixed(1)}`, true),
        ],
      }),
    ],
  }))
  cover.push(new Paragraph({
    spacing: { before: 120 },
    children: [new TextRun({
      text: 'Marks lift = what is still on the table in that subtopic (NDA weightage minus your projected score). '
        + 'Each question is tagged with how you handled it and its difficulty. Answer key at the end.',
      size: 18, italics: true, color: '666666',
    })],
  }))

  // ── questions, two columns ──────────────────────────────────────────────
  const body = []
  const labels = ['a', 'b', 'c', 'd']
  rows.forEach(r => {
    body.push(new Paragraph({
      spacing: { before: 200, after: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999', space: 1 } },
      children: [new TextRun({ text: r.subtopic, bold: true, size: SUB_SIZE })],
    }))
    body.push(new Paragraph({
      children: [new TextRun({
        text: `${r.chapter} · ${r.marksAtStake.toFixed(1)} marks at stake · +${r.lift.toFixed(1)} recoverable`,
        size: 18, color: '666666',
      })],
    }))
    if (!r.questions.length) {
      body.push(new Paragraph({
        children: [new TextRun({ text: 'No questions available for this subtopic yet.', italics: true, size: SIZE })],
      }))
      return
    }
    r.questions.forEach(q => {
      body.push(blank())
      body.push(new Paragraph({
        children: [
          new TextRun({ text: `Q${q.n}. `, bold: true }),
          ...mathRuns(q.question),
          new TextRun({
            text: ` [${q.bucket.toUpperCase()}]${q.difficulty ? ` [${q.difficulty.toUpperCase()}]` : ''}`,
            bold: true, size: 15, color: TAG_COLOR[q.bucket],
          }),
        ],
      }))
      q.options.forEach((o, i) => {
        if (!o) return
        body.push(new Paragraph({
          indent: { left: 0 },
          children: [new TextRun({ text: `(${labels[i]}) ` }), ...mathRuns(o)],
        }))
      })
    })
  })

  // ── answer key: compact grid, answers only ──────────────────────────────
  const key = rows.flatMap(r => r.questions.map(q => ({ n: q.n, answer: q.answer })))
  const keySection = [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Answer Key', bold: true, size: TITLE_SIZE })],
  }), blank()]
  const PAIRS = 6
  const keyRows = []
  for (let i = 0; i < key.length; i += PAIRS) {
    const slice = key.slice(i, i + PAIRS)
    const cells = []
    for (let j = 0; j < PAIRS; j++) {
      const k = slice[j]
      cells.push(cell(k ? k.n : '', false, 8))
      cells.push(cell(k ? (k.answer || '?').toLowerCase() : '', true, 8))
    }
    keyRows.push(new TableRow({ children: cells }))
  }
  if (keyRows.length) {
    keySection.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE, insideHorizontal: EDGE, insideVertical: EDGE },
      rows: keyRows,
    }))
  }

  const page = {
    size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 0, footer: 0 },
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      { properties: { page }, children: cover },
      { properties: { page, column: { count: 2, space: 720 } }, children: body },
      { properties: { page }, children: keySection },
    ],
  })

  // Pack, then swap markers for real OMML and inject mathPr.
  const blob = await Packer.toBlob(doc)
  const zip = await JSZip.loadAsync(blob)
  const docFile = zip.file('word/document.xml')
  if (docFile && ommlByIndex.length) {
    let xml = await docFile.async('text')
    for (let i = 0; i < ommlByIndex.length; i++) {
      const re = new RegExp(
        `<w:r>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t[^>]*>${escapeRegex(MARKER + i)}</w:t></w:r>`, 'g')
      xml = xml.replace(re, ommlByIndex[i])
    }
    zip.file('word/document.xml', xml)
  }
  const settings = zip.file('word/settings.xml')
  if (settings) {
    const s = await settings.async('text')
    if (!s.includes('<m:mathPr')) {
      zip.file('word/settings.xml', s.replace('</w:settings>', `${MATH_PR_BLOCK}</w:settings>`))
    }
  }
  // JSZip defaults to application/zip; give it the real OOXML type so the OS
  // and mail clients treat the file as a Word document rather than an archive.
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

export async function downloadPracticeSet(args, filename) {
  const blob = await buildPracticeSetDocx(args)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
