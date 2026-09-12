// Stored question text -> HTML, with KaTeX for the maths.
//
// This is the string half of `src/components/ui/Math.jsx`, lifted out unchanged
// so a NON-React surface can reach it. The caller that needed it is the class
// PDF: jsPDF has no layout engine and its Standard-14 fonts are WinAnsi, so the
// question cards used to run every stem through a LaTeX -> ASCII flattener
// (`stripLatex`) and print `\int_0^1 x^2 dx` as "int_0^1 x^2 dx". They are now
// built as HTML, rendered offscreen and captured — which only stays honest if
// the export types maths the same way the screen does, i.e. through this file
// rather than a second renderer that drifts from it.
//
// Pure: no DOM, no React. Safe to call under Node.

import katex from 'katex'
import { parseRichSegments, parseTableBlocks } from './richText'
import { matchUnderlineBypass } from './underlineBypass'

/** Inline + display LaTeX, Markdown `**bold**`, underlined vocabulary. */
export function renderMathHtml(text) {
  if (!text) return ''
  const segments = parseRichSegments(String(text))
  if (segments.length === 0) return ''
  return segments.map(renderSegment).join('')
}

function renderSegment(seg) {
  if (seg.type === 'text') return bold(escHtml(seg.content), seg.bold)

  // An underline-only zone is vocabulary, not maths: KaTeX would typeset it in
  // its own face mid-sentence and wrap it in an inline-block that breaks line
  // clamping. Render it in the body font instead.
  if (seg.type === 'inline') {
    const u = matchUnderlineBypass(seg.content)
    if (u) {
      const word = `<span style="text-decoration:underline"${u.italic ? ' class="italic"' : ''}>${escHtml(u.word)}</span>`
      return bold(word + escHtml(u.trailing), seg.bold)
    }
  }

  try {
    return bold(katex.renderToString(seg.content, {
      throwOnError: false,
      displayMode: seg.type === 'block',
      strict: false,
    }), seg.bold)
  } catch {
    // Malformed LaTeX shows as its source rather than taking the page down.
    return bold(escHtml(seg.content), seg.bold)
  }
}

// ── GFM pipe tables ─────────────────────────────────────────────────────────

// Mirrors `RichText.jsx`, which does the same job for the screen. The PARSE is
// shared (`parseTableBlocks`); only the chrome differs, and deliberately: the
// screen wraps a wide distribution in a horizontal scroll box, which a captured
// image cannot scroll. Here the table lays out at full width instead.
const T_BORDER = '1px solid #e2e8f0'

/** Like `renderMathHtml`, plus GFM pipe tables — data-interpretation stems. */
export function renderRichHtml(text) {
  if (!text) return ''
  const src = String(text)
  const blocks = parseTableBlocks(src)

  // Fast path: text with no table (the overwhelming majority) is byte-for-byte
  // what `renderMathHtml` produces, so adding table support cannot change how
  // an ordinary question renders.
  if (blocks.length === 0) return renderMathHtml(src)
  if (blocks.length === 1 && blocks[0].kind === 'text') return renderMathHtml(blocks[0].text)

  return blocks.map(b => b.kind === 'text' ? renderMathHtml(b.text) : renderTable(b)).join('')
}

function renderTable(block) {
  const th = block.headers.map(h =>
    `<th style="border:${T_BORDER};padding:3px 6px;text-align:left;font-weight:600;background:#f1f5f9">${renderMathHtml(h)}</th>`,
  ).join('')

  const rows = block.rows.map(row =>
    `<tr>${row.map(cell =>
      `<td style="border:${T_BORDER};padding:3px 6px;vertical-align:top">${renderMathHtml(cell)}</td>`,
    ).join('')}</tr>`,
  ).join('')

  return `<table style="border-collapse:collapse;margin:5px 0;font-size:inherit">` +
    `<thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`
}

function bold(html, isBold) {
  return isBold ? `<strong>${html}</strong>` : html
}

export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
