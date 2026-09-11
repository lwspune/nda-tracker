// The on-screen question renderer. It used to split only on \(...\) and escape
// everything else, so bold printed as asterisks, \[...\] printed as source, and
// an underlined vocab word was typeset in KaTeX_Main mid-sentence.
//
// The FIRST describe block is the safety net for that change: text carrying none
// of the new markup — ~12,600 of 13,548 stored questions — must render exactly
// as it did before.
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Math as MathText } from '../Math'

const html = node => node.container.innerHTML

describe('Math — plain text is untouched', () => {
  it('renders prose with no markup as escaped text', () => {
    const out = render(<MathText>{'What is the mean of the numbers?'}</MathText>)
    expect(out.container.textContent).toBe('What is the mean of the numbers?')
    expect(html(out)).not.toContain('katex')
  })

  it('still escapes HTML', () => {
    const out = render(<MathText>{'a < b & c > d'}</MathText>)
    expect(html(out)).toContain('&lt;')
    expect(html(out)).toContain('&amp;')
    expect(html(out)).not.toContain('<b>')
  })

  it('renders nothing for empty input', () => {
    expect(html(render(<MathText>{''}</MathText>))).toBe('')
    expect(html(render(<MathText>{null}</MathText>))).toBe('')
  })

  it('still renders inline \\(...\\) through KaTeX, as before', () => {
    const out = render(<MathText>{'the value of \\(x^2\\) is'}</MathText>)
    expect(html(out)).toContain('katex')
    expect(out.container.textContent).toContain('the value of')
  })
})

describe('Math — the markup that used to print as source', () => {
  it('renders **bold** as bold, not as asterisks', () => {
    const out = render(<MathText>{'the **incorrect** statement'}</MathText>)
    expect(html(out)).toContain('<strong>')
    expect(out.container.textContent).not.toContain('**')
  })

  it('keeps bold when the bold span CONTAINS maths', () => {
    // bold is resolved on the masked string precisely so this pairs
    const out = render(<MathText>{'**value \\(x^2\\) here**'}</MathText>)
    expect(html(out)).toContain('<strong>')
    expect(html(out)).toContain('katex')
  })

  it('renders \\[...\\] as display maths rather than raw LaTeX', () => {
    const out = render(<MathText>{'result: \\[\\int_0^4 x\\,dx\\]'}</MathText>)
    // KaTeX embeds the source in a MathML annotation, so textContent legitimately
    // still contains it; what matters is that a DISPLAY-mode node was produced,
    // which the old renderer never did for \[...\].
    expect(html(out)).toContain('katex-display')
  })

  it('renders $...$ maths, which the bank stores for matrices', () => {
    const out = render(<MathText>{'Let $A$ and $B$ be matrices'}</MathText>)
    expect(html(out)).toContain('katex')
    expect(out.container.textContent).not.toContain('$A$')
  })

  it('leaves a currency amount inside a math zone alone', () => {
    // stored as \(\$1{,}000{,}000\) — the dollar is escaped INSIDE the zone,
    // so zone-masking protects it from the single-$ rule
    const out = render(<MathText>{'a budget of \\(\\$1{,}000{,}000\\) is'}</MathText>)
    expect(out.container.textContent).toContain('a budget of')
    expect(html(out)).toContain('katex')
  })
})

describe('Math — underlined vocabulary keeps the body font', () => {
  it('renders an underline-only zone as a native span, not KaTeX', () => {
    const out = render(<MathText>{'he answered \\(\\underline{\\text{absently}}\\) today'}</MathText>)
    expect(out.container.textContent).toContain('absently')
    expect(html(out)).toContain('underline')
    expect(html(out)).not.toContain('katex')
  })

  it('keeps trailing punctuation outside the underline', () => {
    const out = render(<MathText>{'the word \\(\\underline{\\text{gone}}.\\)'}</MathText>)
    expect(out.container.textContent).toContain('gone')
  })

  it('does NOT bypass a real expression that merely contains an underline', () => {
    const out = render(<MathText>{'\\(\\underline{x} + y^2\\)'}</MathText>)
    expect(html(out)).toContain('katex')
  })
})
