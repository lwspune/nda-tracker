// `renderMathHtml` is the string half of the <Math> component, lifted out so a
// non-React surface (the class PDF's question cards, rendered offscreen and
// captured) types its maths the same way the screen does. The component's own
// tests still cover the React wrapper; these pin the extracted function.

import { describe, it, expect } from 'vitest'
import { renderMathHtml, renderRichHtml } from '../mathHtml'

// KaTeX keeps the LaTeX source in a MathML <annotation> for copy-paste and
// screen readers, so the raw macro is always present in the markup. What
// matters is what gets DRAWN — assert on that, with the annotation removed.
export function visible(html) {
  return String(html).replace(/<annotation[\s\S]*?<\/annotation>/g, '')
}

describe('renderMathHtml', () => {
  it('typesets inline maths with KaTeX rather than emitting its source', () => {
    const html = renderMathHtml('Evaluate \\(\\frac{1}{2}\\) now')
    expect(html).toContain('katex-html')
    expect(html).toContain('Evaluate')
    // The whole point of the exercise: no raw macro, no flattened ASCII.
    expect(visible(html)).not.toContain('\\frac')
    expect(visible(html)).not.toContain('(1)/(2)')
  })

  it('renders display maths in display mode', () => {
    const html = renderMathHtml('\\[x^2\\]')
    expect(html).toContain('katex-display')
  })

  it('resolves **bold** around a maths zone', () => {
    const html = renderMathHtml('**find \\(x\\)**')
    expect(html).toContain('<strong>')
    expect(html).toContain('katex')
  })

  it('escapes markup in prose so stored text cannot inject nodes', () => {
    const html = renderMathHtml('a < b & <img src=x onerror=1>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('renders an underline-only zone as underlined prose, not as maths', () => {
    const html = renderMathHtml('The \\(\\underline{\\text{dog}}\\) barked')
    expect(html).toContain('text-decoration:underline')
    expect(html).toContain('dog')
    expect(html).not.toContain('katex')
  })

  it('falls back to the source text for LaTeX KaTeX cannot parse', () => {
    expect(() => renderMathHtml('\\(\\notacommand{x}\\)')).not.toThrow()
  })

  it('returns an empty string for empty input', () => {
    expect(renderMathHtml('')).toBe('')
    expect(renderMathHtml(null)).toBe('')
  })
})

describe('renderRichHtml', () => {
  it('lays a GFM pipe table out as a real table', () => {
    const html = renderRichHtml('Marks table:\n| Class | f |\n|---|---|\n| 0-10 | 4 |')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('0-10')
    expect(html).toContain('Marks table:')
  })

  it('typesets maths inside table cells', () => {
    const html = renderRichHtml('| \\(n^2\\) | f |\n|---|---|\n| 1 | 4 |')
    expect(html).toContain('katex')
  })

  it('leaves a pipe inside a maths zone alone', () => {
    const html = renderRichHtml('Find \\(P(A \\mid B)\\) given')
    expect(html).not.toContain('<table')
  })

  it('is the plain renderer when there is no table', () => {
    expect(renderRichHtml('Solve \\(x\\)')).toBe(renderMathHtml('Solve \\(x\\)'))
  })
})
