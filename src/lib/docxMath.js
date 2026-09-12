// The shared LaTeX -> Word-equation pipeline.
//
// LaTeX -> KaTeX -> MathML -> mathml2omml -> OMML. The `docx` package has no
// OMML node, so each equation is emitted as a MARKER RUN and swapped into
// word/document.xml after packing (`applyOmml`).
//
// This lived inside `buildPracticeSetDocx` and was then copied, verbatim, into
// `gatErrorSetDocx`. Copying cost real money once already: the single-pass
// marker swap below was measured at 675 s -> 441 ms on a 1,740-equation set,
// and the fix then had to be applied twice, by hand. The class exam report
// would have been copy three. One implementation, three consumers.
//
// Pure except the two dynamic imports — katex and mathml2omml are paid for only
// by someone who actually downloads a document.

import { parseRichSegments } from './richText'
import { repairOmml } from './ommlRepair'

export const MARKER = 'OMML_'

export const MATH_PR_BLOCK =
  '<m:mathPr>' +
  '<m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/>' +
  '<m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/>' +
  '<m:defJc m:val="left"/><m:wrapIndent m:val="0"/><m:intLim m:val="subSup"/>' +
  '<m:naryLim m:val="undOvr"/></m:mathPr>'

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


// Resolve to the actual FUNCTION, whatever the interop shape.
// These are CJS packages: under Node/Vitest the named export is present, but
// Vite's browser interop can leave `.name` undefined with `.default` holding
// the exports OBJECT. A plain `a || b || c` chain then yields an object, not a
// callable — every equation degrades to stripped text and the document ships
// with "dfrac 1 16" where a fraction belongs. Resolve by typeof, and THROW if no
// function is found: a silent fallback is what let that reach a student.
export function pickFn(mod, name) {
  const found = [mod?.[name], mod?.default?.[name], mod?.default, mod]
    .find(c => typeof c === 'function')
  if (!found) throw new Error(`docxMath: could not resolve ${name}() from its module`)
  return found
}

/**
 * The per-document maths renderer. ONE call per document build — the OMML it
 * collects is positional, so two documents must never share a renderer.
 *
 * @param docxMod the caller's ALREADY-IMPORTED `docx` module. Passed in rather
 *   than imported here so both sides use one module instance and the caller
 *   keeps its single `Promise.all` of heavy imports.
 * @returns {{mathRuns, contentTable, TABLE_BORDERS, ommlByIndex}}
 */
export async function createMathRenderer(docxMod) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, WidthType } = docxMod

  const [katexMod, mml2ommlMod] = await Promise.all([
    import('katex'),
    import('mathml2omml'),
  ])
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
  // OMML does not render badly, it makes Word decline to open the WHOLE file, so
  // one bad equation would cost the reader the entire document. Returning null
  // here drops that one zone to readable text and keeps the other 300.
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
  // to the prettified source rather than dumping raw LaTeX at a reader.
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
  const TABLE_BORDERS = {
    top: EDGE, bottom: EDGE, left: EDGE, right: EDGE,
    insideHorizontal: EDGE, insideVertical: EDGE,
  }

  // A GFM pipe-table lifted out of a question stem, as a native Word table.
  // Cells go through mathRuns rather than a plain TextRun — a data-interpretation
  // table routinely has \(n^2\) in a header — and the header row is marked by
  // shading, the same convention the cover tables use.
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

  return { mathRuns, contentTable, TABLE_BORDERS, ommlByIndex }
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Swap every marker run in a packed document for its equation, and make Word
 * lay the equations out properly. Mutates the JSZip in place.
 */
export async function applyOmml(zip, ommlByIndex) {
  const docFile = zip.file('word/document.xml')
  if (docFile && ommlByIndex.length) {
    // ONE pass over the document, not one per equation. The per-equation loop
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
    // Without <m:mathPr> Word gives every fraction about an inch of phantom
    // left indent. It is not optional.
    if (!s.includes('<m:mathPr')) {
      zip.file('word/settings.xml', s.replace('</w:settings>', `${MATH_PR_BLOCK}</w:settings>`))
    }
  }
}
