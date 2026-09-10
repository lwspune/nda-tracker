import { describe, it, expect } from 'vitest'
import {
  sanitizeOmml, wrapMatrixDelimiters, remapAccentChars, ommlNestingError, repairOmml,
} from '../ommlRepair'

// These fixtures are the SHAPES KaTeX -> mathml2omml actually emits, verified
// against the real pipeline. They are hand-written rather than generated so a
// KaTeX upgrade that changes the shape fails here loudly instead of silently
// making the repair a no-op.

const NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
const grid = '<m:m><m:mPr><m:baseJc m:val="center"/></m:mPr>'
  + '<m:mr><m:e><m:r><m:t xml:space="preserve">1</m:t></m:r></m:e>'
  + '<m:e><m:r><m:t xml:space="preserve">2</m:t></m:r></m:e></m:mr></m:m>'
const fence = c => `<m:r><m:t xml:space="preserve">${c}</m:t></m:r>`
const zone = inner => `<m:oMath ${NS}>${inner}</m:oMath>`

describe('wrapMatrixDelimiters — matrices must be ENCLOSED, not flanked', () => {
  // mathml2omml renders the stretchy fence as a plain single-line text run beside
  // the grid, so Word draws a tiny detached bracket that does not enclose the
  // matrix. 283 Maths questions in the live bank hit this.
  it('wraps a vmatrix determinant — KaTeX emits U+2223, not ASCII pipe', () => {
    const out = wrapMatrixDelimiters(zone(fence('∣') + grid + fence('∣')))
    expect(out).toContain('<m:d>')
    expect(out).toContain('<m:begChr m:val="|"/>')
    expect(out).toContain('<m:endChr m:val="|"/>')
    expect(out).toContain(`<m:e>${grid}</m:e>`)
    // the flanking runs are consumed, not left alongside
    expect(out).not.toContain(fence('∣'))
  })

  it('normalises the determinant bar to ASCII so Word stretches it', () => {
    const out = wrapMatrixDelimiters(zone(fence('∣') + grid + fence('∣')))
    expect(out).not.toContain('∣')
  })

  it('wraps a Vmatrix norm — KaTeX emits U+2225', () => {
    const out = wrapMatrixDelimiters(zone(fence('∥') + grid + fence('∥')))
    expect(out).toContain('<m:begChr m:val="‖"/>')
    expect(out).toContain('<m:endChr m:val="‖"/>')
  })

  it.each([
    ['pmatrix', '(', ')'],
    ['bmatrix', '[', ']'],
    ['Bmatrix', '{', '}'],
  ])('wraps a %s', (_name, open, close) => {
    const out = wrapMatrixDelimiters(zone(fence(open) + grid + fence(close)))
    expect(out).toContain(`<m:begChr m:val="${open}"/>`)
    expect(out).toContain(`<m:endChr m:val="${close}"/>`)
  })

  // \begin{cases} opens with a brace and never closes — the two-sided rule
  // cannot see it, so f(x) = {cases} printed with a tiny orphaned brace.
  it('wraps a one-sided cases brace with an empty closing delimiter', () => {
    const out = wrapMatrixDelimiters(zone(fence('{') + grid))
    expect(out).toContain('<m:begChr m:val="{"/>')
    expect(out).toContain('<m:endChr m:val=""/>')
    expect(out).toContain(`<m:e>${grid}</m:e>`)
  })

  it('leaves a fence-less matrix alone', () => {
    const src = zone(grid)
    expect(wrapMatrixDelimiters(src)).toBe(src)
  })

  it('leaves a mismatched pair alone rather than guessing', () => {
    const src = zone(fence('(') + grid + fence(']'))
    expect(wrapMatrixDelimiters(src)).toBe(src)
  })

  // f(x) must not become a delimiter object just because a matrix appears later.
  it('only consumes a fence run IMMEDIATELY adjacent to the grid', () => {
    const src = zone(fence('(') + '<m:r><m:t>x</m:t></m:r>' + fence(')') + grid)
    const out = wrapMatrixDelimiters(src)
    expect(out).toContain(fence('(') + '<m:r><m:t>x</m:t></m:r>' + fence(')'))
  })

  it('wraps every matrix in a zone, not just the first', () => {
    const src = zone(fence('∣') + grid + fence('∣') + fence('(') + grid + fence(')'))
    const out = wrapMatrixDelimiters(src)
    expect(out.match(/<m:d>/g)).toHaveLength(2)
  })

  it('keeps the result well-formed', () => {
    const out = wrapMatrixDelimiters(zone(fence('∣') + grid + fence('∣')))
    expect(ommlNestingError(out)).toBeNull()
  })
})

describe('remapAccentChars — the accent char must be COMBINING', () => {
  const acc = c => zone(`<m:acc><m:accPr><m:chr m:val="${c}"/></m:accPr>`
    + '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc>')

  // KaTeX gets the STRUCTURE right (<m:acc>) but hands Word a spacing character.
  // Word can only position a combining mark over the base, so \bar{x} renders
  // with the bar off to the side.
  it('remaps \\bar (U+02C9 modifier macron) to combining overline', () => {
    expect(remapAccentChars(acc('ˉ'))).toContain('<m:chr m:val="̅"/>')
  })

  it('remaps \\overline (U+203E overline) to combining overline', () => {
    expect(remapAccentChars(acc('‾'))).toContain('<m:chr m:val="̅"/>')
  })

  it.each([
    ['\\vec', '⃗'],
    ['\\hat', '̂'],
    ['\\tilde', '̃'],
    ['\\dot', '̇'],
  ])('leaves %s alone — already combining', (_n, ch) => {
    expect(remapAccentChars(acc(ch))).toContain(`<m:chr m:val="${ch}"/>`)
  })

  // <m:chr> is ALSO how an integral/summation carries its operator. Remapping by
  // value across the whole document would be a different bug.
  it('never touches an n-ary operator char', () => {
    const nary = zone('<m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:e/></m:nary>')
    expect(remapAccentChars(nary)).toBe(nary)
  })

  it('remaps every accent in a zone', () => {
    const src = zone(acc('ˉ') + acc('‾'))
    expect(remapAccentChars(src).match(/m:val="̅"/g)).toHaveLength(2)
  })
})

describe('ommlNestingError — malformed OMML makes Word refuse the whole file', () => {
  it('passes well-formed markup', () => {
    expect(ommlNestingError(zone(grid))).toBeNull()
  })

  it('reports an unclosed element', () => {
    expect(ommlNestingError('<m:oMath><m:e>x</m:e>')).toMatch(/unclosed/)
  })

  it('reports crossed tags', () => {
    expect(ommlNestingError('<m:a><m:b></m:a></m:b>')).toMatch(/closes/)
  })

  it('ignores self-closing elements', () => {
    expect(ommlNestingError('<m:oMath><m:chr m:val="x"/><m:e/></m:oMath>')).toBeNull()
  })
})

describe('sanitizeOmml', () => {
  it('escapes a real "<" in maths text', () => {
    expect(sanitizeOmml('<m:t>0 < x</m:t>')).toBe('<m:t>0 &lt; x</m:t>')
  })

  // `<m:t` is a prefix of `<m:type>`, which EVERY fraction emits. A prefix match
  // swallows the live markup to the next </m:t> and escapes it, producing a file
  // Word refuses outright.
  it('does not match <m:type>, the prefix trap', () => {
    const src = '<m:fPr><m:type m:val="bar"/></m:fPr><m:num><m:r><m:t>1</m:t></m:r></m:num>'
    expect(sanitizeOmml(src)).toBe(src)
  })

  it('leaves existing entities alone', () => {
    expect(sanitizeOmml('<m:t>a &amp; b</m:t>')).toBe('<m:t>a &amp; b</m:t>')
  })
})

describe('repairOmml — the composed pass', () => {
  it('sanitizes, wraps matrices and remaps accents in one call', () => {
    const src = zone(fence('∣') + grid + fence('∣')
      + `<m:acc><m:accPr><m:chr m:val="ˉ"/></m:accPr><m:e><m:r><m:t>0 < x</m:t></m:r></m:e></m:acc>`)
    const out = repairOmml(src)
    expect(out).toContain('<m:begChr m:val="|"/>')
    expect(out).toContain('<m:chr m:val="̅"/>')
    expect(out).toContain('0 &lt; x')
    expect(ommlNestingError(out)).toBeNull()
  })

  it('returns null when the repaired markup is structurally broken', () => {
    expect(repairOmml('<m:oMath><m:e>x</m:e>')).toBeNull()
  })
})
