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
// The heavy imports here are dynamic: docx is large, and nobody who does not
// click Download should pay for it. The two modules below are pure, tiny, and
// live in this same lazy chunk.

import { parseRichSegments, parseTableBlocks } from './richText'
import { repairOmml } from './ommlRepair'

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

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── the last-resort renderer ────────────────────────────────────────────────
//
// Fires only when conversion FAILS. On the live bank that is ~77 macro
// occurrences, every one a data-entry typo (\x, \b, \pa) — but a failure takes
// the whole surrounding zone down with it, so the map has to cover what the bank
// actually writes, not just the typo. Stripping backslashes and braces alone
// turns \dfrac{1}{16} into "dfrac 1 16", which is worse than useless on a maths
// paper, and drops \cup / \in / \overline entirely.

// Whole control words. `(?![a-zA-Z])` rather than \b: a \b matches between the
// 'p' and the '\' of `\cap\bar`, so the macro would be replaced and the next
// one's name left behind as "∩bar".
const W = '(?![a-zA-Z])'
const PRETTIFY_TOKENS = [
  ['subseteq', '⊆'], ['subsetneq', '⊊'], ['subset', '⊂'],
  ['supseteq', '⊇'], ['supset', '⊃'], ['setminus', '∖'],
  ['varnothing', '∅'], ['emptyset', '∅'], ['notin', '∉'], ['in', '∈'],
  ['cup', '∪'], ['cap', '∩'],
  ['bigtriangleup', '△'], ['triangle', '△'], ['angle', '∠'],
  ['times', '×'], ['div', '÷'], ['cdot', '·'], ['pm', '±'], ['mp', '∓'],
  ['leq', '≤'], ['le', '≤'], ['geq', '≥'], ['ge', '≥'],
  ['neq', '≠'], ['ne', '≠'], ['approx', '≈'], ['equiv', '≡'],
  ['sim', '∼'], ['propto', '∝'], ['perp', '⊥'], ['parallel', '∥'],
  ['Leftrightarrow', '⇔'], ['Rightarrow', '⇒'],
  ['leftarrow', '←'], ['rightarrow', '→'], ['to', '→'],
  ['infty', '∞'], ['forall', '∀'], ['exists', '∃'],
  ['ldots', '…'], ['cdots', '⋯'], ['dots', '…'],
  ['int', '∫'], ['sum', 'Σ'], ['prod', '∏'],
  ['lbrack', '['], ['rbrack', ']'], ['langle', '⟨'], ['rangle', '⟩'],
  ['lfloor', '⌊'], ['rfloor', '⌋'], ['mid', '|'], ['circ', '∘'],
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['Delta', 'Δ'], ['delta', 'δ'],
  ['epsilon', 'ε'], ['varphi', 'φ'], ['phi', 'φ'], ['Phi', 'Φ'], ['theta', 'θ'],
  ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'],
  ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['omega', 'ω'], ['Omega', 'Ω'],
  ['psi', 'ψ'], ['kappa', 'κ'], ['varkappa', 'ϰ'], ['eta', 'η'], ['zeta', 'ζ'],
].map(([name, ch]) => [new RegExp(`\\\\${name}${W}`, 'g'), ch])

// Accent macros the bank uses, as a combining mark laid on each base character.
const PRETTIFY_ACCENTS = [
  [/\\(?:overline|bar)\s*\{([^{}]*)\}/g, '̅'],
  [/\\(?:overrightarrow|vec)\s*\{([^{}]*)\}/g, '⃗'],
  [/\\(?:widehat|hat)\s*\{([^{}]*)\}/g, '̂'],
  [/\\tilde\s*\{([^{}]*)\}/g, '̃'],
  [/\\dot\s*\{([^{}]*)\}/g, '̇'],
]

// Single-char superscripts with a real Unicode glyph: set complement and the
// small powers. `n` covers the common cardinality exponent.
const PRETTIFY_SUP = { c: 'ᶜ', C: 'ᶜ', 1: '¹', 2: '²', 3: '³', n: 'ⁿ' }

// Function names are real words — drop the backslash, keep the word.
const FUNCTIONS = /\\(sin|cos|tan|cot|sec|csc|cosec|sinh|cosh|tanh|log|ln|exp|lim|det|arg|max|min|gcd|lcm)(?![a-zA-Z])/g

export function prettifyMath(latex) {
  let s = String(latex)
    // Degrees before \circ becomes a ring operator.
    .replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')
    .replace(/\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  for (const [re, mark] of PRETTIFY_ACCENTS) {
    s = s.replace(re, (_, inner) =>
      [...inner].map(c => (c === ' ' ? c : c + mark)).join(''))
  }
  for (const [re, ch] of PRETTIFY_TOKENS) s = s.replace(re, ch)
  s = s.replace(FUNCTIONS, '$1')
    .replace(/\^\{([cC123n])\}|\^([cC123n])/g, (_, a, b) => PRETTIFY_SUP[a ?? b] ?? `^${a ?? b}`)
    // Structural macros carry no glyph of their own.
    .replace(new RegExp(`\\\\(?:left|right|displaystyle|limits|operatorname|text|textbf|textit|mathrm|mathbf|mathbb|[Bb]ig)${W}`, 'g'), '')
    .replace(/\\[,;:!]/g, ' ').replace(/\\ /g, ' ')
    .replace(/\\([{}])/g, '$1')
    .replace(/'/g, '′')
    // Anything still unmapped: a bare macro name reads better than a backslash.
    .replace(/[\\{}]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
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
  // repairOmml both fixes the presentation (matrix fences, accent characters)
  // and REFUSES markup Word would reject. That refusal is the point: malformed
  // OMML does not render badly, it makes Word decline to open the whole file, so
  // one bad equation would cost the student the entire set. Returning null here
  // drops that one zone to readable text and keeps the other 300.
  const latexToOmml = (latex, displayMode = false) => {
    try {
      const html = renderToString(latex, { output: 'mathml', throwOnError: true, displayMode })
      const math = String(html || '').match(/<math[\s\S]*?<\/math>/)
      if (!math) return null
      const omml = mml2omml(math[0])
      if (!omml || typeof omml !== 'string' || !omml.includes('m:oMath')) return null
      return repairOmml(omml)
    } catch { return null }
  }

  // Text with inline maths and **bold** -> runs. A failed conversion falls back
  // to the prettified source rather than dumping raw LaTeX at a student.
  const mathRuns = (text, extra = {}) => {
    const out = []
    for (const seg of parseRichSegments(text)) {
      const props = { bold: seg.bold || undefined, ...extra }
      if (seg.type === 'text') {
        seg.content.split('\n').forEach((line, i) => {
          if (i > 0) out.push(new TextRun({ break: 1 }))
          if (line) out.push(new TextRun({ text: line, ...props }))
        })
        continue
      }
      const omml = latexToOmml(seg.content, seg.type === 'block')
      if (omml) {
        ommlByIndex.push(omml)
        // The marker run carries NO properties: the whole run is replaced by
        // OMML after packing, and the swap regex has to recognise its shape.
        out.push(new TextRun({ text: `${MARKER}${ommlByIndex.length - 1}` }))
        continue
      }
      out.push(new TextRun({ text: prettifyMath(seg.content), ...props }))
    }
    return out.length ? out : [new TextRun({ text: '', ...extra })]
  }

  const EDGE = { style: BorderStyle.SINGLE, size: 4, color: '999999' }
  const blank = () => new Paragraph({ children: [] })
  const cell = (text, header = false, width) => new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: 'EEEEEE' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: header, size: SIZE })] })],
  })
  const TABLE_BORDERS = {
    top: EDGE, bottom: EDGE, left: EDGE, right: EDGE,
    insideHorizontal: EDGE, insideVertical: EDGE,
  }

  // A GFM pipe-table lifted out of a question stem, as a native Word table.
  // Cells go through mathRuns rather than a plain TextRun — a data-interpretation
  // table routinely has \(n^2\) in a header — and the header row is marked by
  // shading, the same convention the cover table uses.
  const contentTable = (block) => {
    const colPct = Math.floor(100 / Math.max(1, block.headers.length))
    const tcell = (content, header) => new TableCell({
      width: { size: colPct, type: WidthType.PERCENTAGE },
      shading: header ? { fill: 'EEEEEE' } : undefined,
      children: [new Paragraph({ children: mathRuns(content) })],
    })
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        new TableRow({ tableHeader: true, children: block.headers.map(h => tcell(h, true)) }),
        ...block.rows.map(row => new TableRow({ children: row.map(c => tcell(c, false)) })),
      ],
    })
  }

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
    borders: TABLE_BORDERS,
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
      // Factories, not shared instances — a docx run object belongs to one
      // paragraph.
      const numRun = () => new TextRun({ text: `Q${q.n}. `, bold: true })
      const tagRun = () => new TextRun({
        text: ` [${q.bucket.toUpperCase()}]${q.difficulty ? ` [${q.difficulty.toUpperCase()}]` : ''}`,
        bold: true, size: 15, color: TAG_COLOR[q.bucket],
      })
      // A stem may carry a GFM pipe-table, which has to become a real Word
      // table rather than print as raw pipes. The question NUMBER rides on the
      // first paragraph and the bucket tag on the last prose one; a stem that
      // opens with a table, or ends with one, gets each as its own paragraph so
      // neither is lost. Options are never tables.
      const blocks = parseTableBlocks(q.question)
      const lastText = blocks.reduce((acc, b, i) => (b.kind === 'text' ? i : acc), -1)
      let numbered = false
      let tagged = false
      blocks.forEach((b, i) => {
        if (b.kind === 'table') {
          if (!numbered) {
            body.push(new Paragraph({ children: [numRun()] }))
            numbered = true
          }
          body.push(contentTable(b))
          return
        }
        const withTag = i === lastText
        body.push(new Paragraph({
          children: [
            ...(numbered ? [] : [numRun()]),
            ...mathRuns(b.text),
            ...(withTag ? [tagRun()] : []),
          ],
        }))
        numbered = true
        tagged = tagged || withTag
      })
      if (!numbered) body.push(new Paragraph({ children: [numRun(), tagRun()] }))
      else if (!tagged) body.push(new Paragraph({ children: [tagRun()] }))
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
      borders: TABLE_BORDERS,
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
    // ONE pass over the document, not one per equation. This was a loop that
    // built a marker-specific regex per index and re-scanned the whole of
    // document.xml each time — O(equations × document size), on a document that
    // GROWS as OMML is spliced in. Measured on a real 1.19 MB set with 1740
    // equations: 388 ms per pass × 1740 = 675 s, against 441 ms for the single
    // pass below. That was ~90% of the build, and it is why the download felt
    // hung for minutes; the progress bar made the wait legible, not shorter.
    // The index is captured instead, and an unknown marker is left untouched
    // rather than deleted.
    const xml = (await docFile.async('text')).replace(
      new RegExp(
        `<w:r>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t[^>]*>${escapeRegex(MARKER)}(\\d+)</w:t></w:r>`, 'g'),
      (whole, i) => ommlByIndex[Number(i)] ?? whole)
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
