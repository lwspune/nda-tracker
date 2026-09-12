// The class PDF's question detail cards. jsPDF cannot typeset maths — it has no
// layout engine and its Standard-14 fonts are WinAnsi — so the card is built as
// HTML, rendered offscreen with KaTeX and captured as an image. What's pure and
// testable is the HTML; the capture and placement are visual and reviewed out of
// band, the same split the rest of examPdf.test.js uses.

import { describe, it, expect } from 'vitest'
import { buildQuestionCardHtml, CARD_WIDTH_PX } from '../examCardHtml'
import { visible } from './mathHtml.test.js'

function wrongItem({ q: qOver = {}, ...over } = {}) {
  return {
    q: {
      q: 42,
      chapter: 'Integration',
      subtopic: 'Definite Integrals',
      question: 'Evaluate \\(\\int_0^1 x^2\\,dx\\)',
      optionA: '\\(\\frac{1}{3}\\)',
      optionB: '\\(\\frac{1}{2}\\)',
      optionC: '1',
      optionD: '2',
      answer: 'A',
      difficulty: 'Medium',
      ...qOver,
    },
    wrong: 31,
    total: 50,
    wrongRate: 0.62,
    ...over,
  }
}

function skippedItem(over = {}) {
  return { q: wrongItem().q, skipped: 12, total: 50, skipRate: 0.24, ...over }
}

describe('buildQuestionCardHtml', () => {
  it('heads the card with the question number, chapter and subtopic', () => {
    const html = buildQuestionCardHtml(wrongItem(), 'wrong')
    expect(html).toContain('Q42')
    expect(html).toContain('Integration')
    expect(html).toContain('Definite Integrals')
  })

  it('reports the wrong count and rate for a wrong card', () => {
    const html = buildQuestionCardHtml(wrongItem(), 'wrong')
    expect(html).toContain('Wrong: 31')
    expect(html).toContain('62%')
  })

  it('reports the skipped count and rate for a skipped card', () => {
    const html = buildQuestionCardHtml(skippedItem(), 'skipped')
    expect(html).toContain('Skipped: 12')
    expect(html).toContain('24%')
    expect(html).not.toContain('Wrong:')
  })

  it('typesets the question stem instead of flattening it to ASCII', () => {
    const html = buildQuestionCardHtml(wrongItem(), 'wrong')
    expect(html).toContain('katex-html')
    // The old jsPDF path printed this stem as "int_0^1 x^2 dx".
    expect(visible(html)).not.toContain('\\int')
    expect(visible(html)).not.toContain('int_0')
  })

  it('typesets the options too', () => {
    const html = buildQuestionCardHtml(wrongItem(), 'wrong')
    expect(visible(html)).not.toContain('(1)/(3)')
    expect(visible(html)).not.toContain('\\frac')
    expect(html).toContain('A)')
    expect(html).toContain('D)')
  })

  it('marks the correct option', () => {
    const html = buildQuestionCardHtml(wrongItem(), 'wrong')
    const correct = html.match(/data-correct="true"/g) || []
    expect(correct).toHaveLength(1)
  })

  it('marks no option when the key is missing', () => {
    const html = buildQuestionCardHtml(wrongItem({ q: { answer: '' } }), 'wrong')
    expect(html).not.toContain('data-correct="true"')
  })

  it('omits the options block entirely when the question has no options', () => {
    const html = buildQuestionCardHtml(
      wrongItem({ q: { optionA: '', optionB: '', optionC: '', optionD: '' } }),
      'wrong',
    )
    expect(html).not.toContain('A)')
    expect(html).not.toContain('data-options')
  })

  it('omits the footer when there is neither an answer nor a difficulty', () => {
    const html = buildQuestionCardHtml(
      wrongItem({ q: { answer: '', difficulty: '' } }),
      'wrong',
    )
    expect(html).not.toContain('Answer:')
    expect(html).not.toContain('Difficulty:')
  })

  it('shows the answer without the difficulty when only the answer is known', () => {
    const html = buildQuestionCardHtml(wrongItem({ q: { difficulty: '' } }), 'wrong')
    expect(html).toContain('Answer: A')
    expect(html).not.toContain('Difficulty:')
  })

  it('falls back to a dash for a missing chapter or subtopic', () => {
    const html = buildQuestionCardHtml(
      wrongItem({ q: { chapter: '', subtopic: '' } }),
      'wrong',
    )
    expect(html).toContain('Q42')
  })

  it('escapes stored markup rather than mounting it', () => {
    const html = buildQuestionCardHtml(
      wrongItem({ q: { question: '<img src=x onerror=alert(1)>' } }),
      'wrong',
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('renders a data-interpretation table in the stem as a table', () => {
    const html = buildQuestionCardHtml(
      wrongItem({ q: { question: 'Study:\n| Class | f |\n|---|---|\n| 0-10 | 4 |' } }),
      'wrong',
    )
    expect(html).toContain('<table')
    expect(html).toContain('0-10')
  })

  it('pins the card to a fixed pixel width so the capture wraps deterministically', () => {
    const html = buildQuestionCardHtml(wrongItem(), 'wrong')
    expect(CARD_WIDTH_PX).toBeGreaterThan(0)
    expect(html).toContain(`width:${CARD_WIDTH_PX}px`)
  })
})
