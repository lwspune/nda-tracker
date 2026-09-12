// A question detail card for the class PDF, as HTML.
//
// jsPDF draws these cards natively everywhere else in `examPdf.js`, but it
// cannot typeset maths: it has no layout engine, and its Standard-14 fonts are
// WinAnsi-encoded, so every symbol above U+00FF is unprintable. The card text
// therefore went through `stripLatex`, a LaTeX -> ASCII flattener that turned
// `\int_0^1 x^2\,dx` into "int_0^1 x^2 dx" and dropped anything it did not
// recognise. On a maths paper the question is the report.
//
// So the card is built here as HTML, rendered offscreen with the same KaTeX the
// app already uses on screen, captured with html2canvas and placed into the PDF
// as an image. `stripLatex` survives as the fallback for a card whose capture
// fails — see `examPdf.js`.
//
// Pure: returns a string, touches no DOM. The geometry constants are what tie it
// to the PDF — the card is laid out at a fixed pixel width that maps 1:1 onto
// the printed width, so wrapping in the capture is what wrapping in the PDF is.

import { renderRichHtml, escHtml } from './mathHtml'

// A4 portrait at 14mm margins — the card width `examPdf.js` draws to.
export const CARD_WIDTH_MM = 182
const PX_PER_MM = 4
export const CARD_WIDTH_PX = CARD_WIDTH_MM * PX_PER_MM   // 728

// jsPDF sizes in points; this surface sizes in CSS pixels. Same physical size.
const px = pt => Math.round(pt * (25.4 / 72) * PX_PER_MM)

const INK = '#0f172a'
const INK2 = '#475569'
const INK3 = '#94a3b8'
const BORDER = '#e2e8f0'
const SUCCESS = '#16a34a'
const SURFACE = '#f8fafc'

// Mirrors `questionDetailCards`' palette, so the two paths produce cards that
// sit next to each other without looking like two different reports.
const PALETTE = {
  wrong:   { bg: '#fee2e2', fg: '#dc2626', label: 'Wrong',   countKey: 'wrong',   rateKey: 'wrongRate' },
  skipped: { bg: '#fef3c7', fg: '#ca8a04', label: 'Skipped', countKey: 'skipped', rateKey: 'skipRate' },
}

// html2canvas paints with the document's own fonts; naming the family keeps the
// capture on Helvetica/Arial rather than inheriting the app's UI face, so the
// card matches the jsPDF text around it.
const FONT = 'Helvetica, Arial, sans-serif'

const LETTERS = ['A', 'B', 'C', 'D']

/**
 * One question card.
 *
 * @param {{q: object, wrong?: number, wrongRate?: number, skipped?: number, skipRate?: number}} item
 * @param {'wrong'|'skipped'} type
 * @returns {string} self-contained HTML — every style inline, nothing inherited
 *                   except the global KaTeX stylesheet.
 */
export function buildQuestionCardHtml(item, type) {
  const p = PALETTE[type] || PALETTE.wrong
  const q = item?.q || {}

  const rate = Math.round((item?.[p.rateKey] || 0) * 100)
  const meta = [`Q${escHtml(q.q ?? '')}`, q.chapter || '—', q.subtopic || null]
    .filter(Boolean).map(escHtml).join('&nbsp; · &nbsp;')

  const header =
    `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;` +
      `background:${p.bg};padding:6px 12px;font-size:${px(8)}px">` +
      `<span style="font-weight:700;color:${p.fg}">${meta}</span>` +
      `<span style="color:${INK2};white-space:nowrap">${p.label}: ${item?.[p.countKey] ?? 0} (${rate}%)</span>` +
    `</div>`

  const stem =
    `<div style="font-size:${px(8.5)}px;color:${INK};line-height:1.5">` +
      renderRichHtml(q.question || '') +
    `</div>`

  return (
    `<div style="width:${CARD_WIDTH_PX}px;box-sizing:border-box;font-family:${FONT};` +
      `background:${SURFACE};border:1px solid ${BORDER};border-radius:8px;overflow:hidden">` +
      header +
      `<div style="padding:9px 12px 10px">` +
        stem +
        optionsBlock(q) +
        footer(q) +
      `</div>` +
    `</div>`
  )
}

// Two columns — A|B then C|D — matching the jsPDF card. The correct option is
// bold and green, as on screen; `data-correct` is what a test can assert on
// without pinning a hex.
function optionsBlock(q) {
  const opts = LETTERS
    .map(letter => ({ letter, text: q[`option${letter}`] }))
    .filter(o => o.text !== undefined && o.text !== null && String(o.text) !== '')

  if (!opts.length) return ''

  const answer = String(q.answer || '').trim().toUpperCase()

  const cells = opts.map(({ letter, text }) => {
    const isCorrect = answer === letter
    return (
      `<div${isCorrect ? ' data-correct="true"' : ''} style="display:flex;gap:5px;` +
        `color:${isCorrect ? SUCCESS : INK2};font-weight:${isCorrect ? 700 : 400}">` +
        `<span>${letter})</span><span>${renderRichHtml(String(text))}</span>` +
      `</div>`
    )
  }).join('')

  return (
    `<div data-options style="margin-top:8px;padding-top:7px;border-top:1px solid ${BORDER};` +
      `display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:${px(8)}px;line-height:1.5">` +
      cells +
    `</div>`
  )
}

function footer(q) {
  const answer = String(q.answer || '').trim()
  const difficulty = String(q.difficulty || '').trim()
  if (!answer && !difficulty) return ''

  return (
    `<div style="display:flex;justify-content:space-between;align-items:baseline;` +
      `margin-top:8px;font-size:${px(8)}px">` +
      `<span style="font-weight:700;color:${SUCCESS}">${answer ? `Answer: ${escHtml(answer)}` : ''}</span>` +
      `<span style="color:${INK3}">${difficulty ? `Difficulty: ${escHtml(difficulty)}` : ''}</span>` +
    `</div>`
  )
}
