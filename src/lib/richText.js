// Question text is not plain text: it carries inline LaTeX, Markdown `**bold**`
// and, in a handful of data-interpretation questions, a GFM pipe-table. The
// practice-set exporter used to treat all of it as one string with maths zones
// in it, so bold printed as literal asterisks and a table printed as raw pipes.
//
// Ported from PYQ Vault's parseLatex.ts + parseTableBlocks.ts, which solve the
// same problem for the question-paper exporter. Pure; no docx dependency.

// Math zones, block delimiters first so \[..\] beats \(..\) and $$..$$ beats
// $..$ when the engine has alternatives at the same position.
export const MATH_PATTERN =
  /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g

// Private-Use-Area sentinels. They cannot collide with question content, and
// building them with fromCharCode keeps this file pure ASCII.
const MASK_OPEN = String.fromCharCode(0xe000)
const MASK_CLOSE = String.fromCharCode(0xe001)
const MASK_RE = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g')

/**
 * Replace every math zone with an opaque sentinel and hand back an `unmask`
 * that restores the ORIGINAL LaTeX verbatim.
 *
 * This is what lets a line/pipe scanner run over question text without
 * mistaking the `|` in \(|A| = 2\) for a column separator. Pure.
 */
export function maskMathZones(input) {
  const zones = []
  const masked = String(input ?? '').replace(MATH_PATTERN, raw => {
    zones.push(raw)
    return `${MASK_OPEN}${zones.length - 1}${MASK_CLOSE}`
  })
  const unmask = s => s.replace(new RegExp(MASK_RE.source, 'g'), (_, i) => zones[Number(i)] ?? '')
  return { masked, unmask }
}

/**
 * Split a plain-text run on Markdown bold into alternating bold / non-bold
 * pieces. A lone, unpaired `**` stays literal (it is usually an exponent). Pure.
 */
export function splitBold(text) {
  const out = []
  const re = /\*\*([\s\S]+?)\*\*/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ bold: false, text: text.slice(last, m.index) })
    out.push({ bold: true, text: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ bold: false, text: text.slice(last) })
  return out
}

// Mask math zones, classifying each and stripping its delimiters.
function maskZones(input) {
  const zones = []
  const masked = String(input ?? '').replace(MATH_PATTERN, raw => {
    const block = raw.startsWith('\\[') || raw.startsWith('$$')
    const inline2 = raw.startsWith('\\(')
    zones.push({
      type: block ? 'block' : 'inline',
      content: (block || inline2 ? raw.slice(2, -2) : raw.slice(1, -1)).trim(),
    })
    return `${MASK_OPEN}${zones.length - 1}${MASK_CLOSE}`
  })
  return { masked, zones }
}

const seg = (type, content, bold) => (bold ? { type, content, bold: true } : { type, content })

/**
 * Parse question/option text into a flat list of text and math runs, each
 * carrying a `bold` flag.
 *
 * Bold is a FLAG, not a segment type, because a `**...**` span may CONTAIN
 * maths — `**order \(m \times n\)**` is one bold span spread over a text run and
 * a math run. That is also why bold is resolved on the MASKED string: splitting
 * on maths first leaves the opening and closing `**` in different pieces, so
 * neither pairs and both print literally. Pure.
 */
export function parseRichSegments(input) {
  if (!input) return []
  const { masked, zones } = maskZones(input)
  const out = []
  for (const piece of splitBold(masked)) {
    const re = new RegExp(MASK_RE.source, 'g')
    let last = 0
    let m
    while ((m = re.exec(piece.text)) !== null) {
      if (m.index > last) out.push(seg('text', piece.text.slice(last, m.index), piece.bold))
      const z = zones[Number(m[1])]
      if (z) out.push(seg(z.type, z.content, piece.bold))
      last = m.index + m[0].length
    }
    if (last < piece.text.length) out.push(seg('text', piece.text.slice(last), piece.bold))
  }
  return out
}

// ── GFM pipe tables ─────────────────────────────────────────────────────────

/** A separator row: only pipes / dashes / colons / spaces, with at least one of each. */
function isSeparatorRow(line) {
  const t = line.trim()
  if (!t.includes('-') || !t.includes('|')) return false
  return /^[|\-:\s]+$/.test(t)
}

/** A plausible table row carries at least one pipe (after math-masking). */
function isRowLike(line) {
  return line.includes('|') && line.trim() !== ''
}

/** Split a masked row on pipes, dropping the empty edges an outer pipe leaves. */
function splitCells(line) {
  const cells = line.trim().split('|')
  if (cells.length && cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map(c => c.trim())
}

/**
 * Split text into an ordered list of prose and table blocks.
 *
 * A run of lines is a table ONLY when a row-like line is immediately followed by
 * a separator row (`|---|---|`). That requirement is the whole safety margin —
 * without it, conditional probability `P(A | B)` and absolute values become
 * tables. Math zones are masked before scanning so a pipe inside \(...\) can
 * never split a cell; cells are unmasked back to their original LaTeX. Pure.
 */
export function parseTableBlocks(input) {
  if (!input) return []

  const { masked, unmask } = maskMathZones(input)
  const lines = masked.replace(/\r\n?/g, '\n').split('\n')

  const blocks = []
  let textBuf = []
  const flushText = () => {
    if (!textBuf.length) return
    const text = unmask(textBuf.join('\n')).trim()
    if (text !== '') blocks.push({ kind: 'text', text })
    textBuf = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const next = lines[i + 1]
    if (isRowLike(line) && next !== undefined && isSeparatorRow(next)) {
      flushText()
      const headers = splitCells(line).map(unmask)
      const rows = []
      let j = i + 2
      for (; j < lines.length && isRowLike(lines[j]) && !isSeparatorRow(lines[j]); j++) {
        const cells = splitCells(lines[j]).map(unmask)
        while (cells.length < headers.length) cells.push('')
        if (cells.length > headers.length) cells.length = headers.length
        rows.push(cells)
      }
      blocks.push({ kind: 'table', headers, rows })
      i = j
    } else {
      textBuf.push(line)
      i++
    }
  }
  flushText()
  return blocks
}
