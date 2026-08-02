// Word (.docx) rendering for a per-student practice set.
//
// Conventions and the maths pipeline are lifted from PYQ Vault's
// src/lib/export/docxBuilder.ts so both apps produce the same-looking paper:
// US Letter, 0.5" margins, Cambria 10pt, two-column question body.
//
// Maths is rendered as REAL Word equations, not ASCII: LaTeX -> KaTeX ->
// MathML -> mathml2omml -> OMML. The `docx` package has no OMML node, so each
// equation is emitted as a marker run and swapped into word/document.xml after
// packing. The <m:mathPr> block is NOT optional — without it Word gives every
// fraction about an inch of phantom left indent.
//
// Every import here is dynamic: docx is large, and nobody who does not click
// Download should pay for it.

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

// Last resort when a LaTeX snippet will not convert. Stripping backslashes and
// braces turns \dfrac{1}{16} into "dfrac 1 16", which is worse than useless on a
// maths paper — render the common forms readably instead.
export function prettifyMath(latex) {
  return String(latex)
    .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(?:left|right|displaystyle|text|mathrm)\b/g, '')
    .replace(/\\times\b/g, '×').replace(/\\div\b/g, '÷')
    .replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥')
    .replace(/\\neq?\b/g, '≠').replace(/\\pm\b/g, '±')
    .replace(/\\pi\b/g, 'π').replace(/\\theta\b/g, 'θ')
    .replace(/\\alpha\b/g, 'α').replace(/\\beta\b/g, 'β')
    .replace(/\\infty\b/g, '∞').replace(/\\cdot\b/g, '·')
    .replace(/[\\{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Escape raw <, > and & inside <m:t> — "0 < \alpha" otherwise yields XML Word
// refuses to open.
function sanitizeOmml(omml) {
  return omml.replace(/<m:t([^>]*)>([\s\S]*?)<\/m:t>/g, (_, attrs, body) =>
    `<m:t${attrs}>${body.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')}</m:t>`)
}

// Progress checkpoints. The build is one long synchronous CPU block — KaTeX per
// equation, then Packer, then the JSZip patch — so a caller that just flips a
// boolean gets no repaint until it is over. `onProgress(pct, label)` is AWAITED
// at each checkpoint: the caller returns a promise that yields a frame, and that
// yield is the only reason a bar can move. Weights are fixed, not measured; the
// question stretch is the bulk of the wall-clock and gets the widest band.
const P = { deps: 4, cover: 12, body: 15, bodyEnd: 70, pack: 75, equations: 85, zip: 95, done: 100 }

export async function buildPracticeSetDocx({ studentName, subject = 'Maths', rows, totals, onProgress }) {
  const report = typeof onProgress === 'function'
    ? (pct, label) => onProgress(Math.round(pct), label)
    : () => {}

  await report(0, 'Loading the builder…')
  const [
    { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, PageOrientation },
    JSZipMod, katexMod, mml2ommlMod,
  ] = await Promise.all([
    import('docx'),
    import('jszip'),
    import('katex'),
    import('mathml2omml'),
  ])
  const JSZip = JSZipMod.default
  await report(P.deps, 'Loading the builder…')

  // Resolve to the actual FUNCTION, whatever the interop shape.
  // These are CJS packages: under Node/Vitest the named export is present, but
  // Vite's browser interop can leave `.name` undefined with `.default` holding
  // the exports OBJECT. A plain `a || b || c` chain then yields an object, not a
  // callable — every equation degrades to stripped text and the paper ships with
  // "dfrac 1 16" where a fraction belongs. Resolve by typeof, and THROW if no
  // function is found: a silent fallback is what let that reach a student.
  const pickFn = (mod, name) => {
    const found = [mod?.[name], mod?.default?.[name], mod?.default, mod]
      .find(c => typeof c === 'function')
    if (!found) throw new Error(`practiceSetDocx: could not resolve ${name}() from its module`)
    return found
  }
  const renderToString = pickFn(katexMod, 'renderToString')
  const mml2omml       = pickFn(mml2ommlMod, 'mml2omml')

  const ommlByIndex = []

  // KaTeX, not temml. temml's lexer breaks in the browser — every macro throws
  // "Unsupported function name: \f", consuming only ONE character after the
  // backslash, so every equation degraded to fallback text. It works fine under
  // Node, which is why the vitest suite was green while the shipped file said
  // "dfrac 1 16". KaTeX is already a dependency, already renders this app's
  // maths on screen, and handles fractions/roots/vectors/integrals here.
  //
  // KaTeX wraps its MathML in <span class="katex">…<math>…</math></span>;
  // mathml2omml needs the bare <math> element.
  const latexToOmml = (latex) => {
    try {
      const html = renderToString(latex, {
        output: 'mathml', throwOnError: true, displayMode: false,
      })
      const math = String(html || '').match(/<math[\s\S]*?<\/math>/)
      if (!math) return null
      const omml = mml2omml(math[0])
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
        out.push(new TextRun({ text: prettifyMath(body), ...extra }))
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
  await report(P.cover, 'Building the summary…')
  const body = []
  const labels = ['a', 'b', 'c', 'd']
  // for...of, not forEach — this loop has to await the progress seam, and it is
  // where the time goes (every equation is a KaTeX render).
  const span = P.bodyEnd - P.body
  for (const [i, r] of rows.entries()) {
    await report(P.body + (span * i) / rows.length,
      `Rendering questions… ${i + 1} of ${rows.length}`)
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
      continue
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
      q.options.forEach((o, oi) => {
        if (!o) return
        body.push(new Paragraph({
          indent: { left: 0 },
          children: [new TextRun({ text: `(${labels[oi]}) ` }), ...mathRuns(o)],
        }))
      })
    })
  }
  await report(P.bodyEnd, 'Building the answer key…')

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
  await report(P.pack, 'Laying out the document…')
  const blob = await Packer.toBlob(doc)
  const zip = await JSZip.loadAsync(blob)
  await report(P.equations, 'Placing equations…')
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
  await report(P.zip, 'Finishing the file…')
  const out = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  await report(P.done, 'Done')
  return out
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
