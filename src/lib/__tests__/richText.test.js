import { describe, it, expect } from 'vitest'
import { maskMathZones, parseRichSegments, parseTableBlocks } from '../richText'

describe('maskMathZones', () => {
  it('hides math from a line/pipe scanner and restores it verbatim', () => {
    const { masked, unmask } = maskMathZones('the set \\(|A| = 2\\) is finite')
    expect(masked).not.toContain('|')
    expect(unmask(masked)).toBe('the set \\(|A| = 2\\) is finite')
  })

  it('masks every zone flavour', () => {
    const { masked } = maskMathZones('a \\(x\\) b \\[y\\] c $z$ d $$w$$')
    expect(masked).not.toMatch(/[xyzw]/)
  })

  it('leaves math-free text untouched', () => {
    const { masked, unmask } = maskMathZones('plain text')
    expect(masked).toBe('plain text')
    expect(unmask(masked)).toBe('plain text')
  })
})

describe('parseRichSegments — **bold** must not print as asterisks', () => {
  it('resolves a bold span', () => {
    expect(parseRichSegments('say **this** now')).toEqual([
      { type: 'text', content: 'say ' },
      { type: 'text', content: 'this', bold: true },
      { type: 'text', content: ' now' },
    ])
  })

  // Bold is a FLAG, not a segment type: a bold span may CONTAIN math, so the
  // `**` must be resolved on the MASKED string. Splitting on math first leaves
  // the opening and closing `**` in different pieces and neither pairs.
  it('carries bold across a math zone', () => {
    const out = parseRichSegments('**order \\(m \\times n\\) matrix**')
    expect(out.every(s => s.bold)).toBe(true)
    expect(out.map(s => s.type)).toEqual(['text', 'inline', 'text'])
    expect(out[1].content).toBe('m \\times n')
  })

  it('keeps an unpaired ** as literal text', () => {
    expect(parseRichSegments('2 ** 3')).toEqual([{ type: 'text', content: '2 ** 3' }])
  })

  it('classifies inline and block zones', () => {
    const out = parseRichSegments('a \\(x\\) b \\[y\\] c')
    expect(out.map(s => s.type)).toEqual(['text', 'inline', 'text', 'block', 'text'])
    expect(out[1].content).toBe('x')
    expect(out[3].content).toBe('y')
  })

  it('strips the delimiters from every zone flavour', () => {
    expect(parseRichSegments('$a$').map(s => s.content)).toEqual(['a'])
    expect(parseRichSegments('$$b$$').map(s => s.content)).toEqual(['b'])
  })

  it('returns nothing for empty input', () => {
    expect(parseRichSegments('')).toEqual([])
  })
})

describe('parseTableBlocks — a GFM pipe-table must become a real Word table', () => {
  const TABLE = 'Study the data.\n\n| x | f(x) |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nFind f(5).'

  it('splits prose from the table, in order', () => {
    const out = parseTableBlocks(TABLE)
    expect(out.map(b => b.kind)).toEqual(['text', 'table', 'text'])
    expect(out[0].text).toBe('Study the data.')
    expect(out[1].headers).toEqual(['x', 'f(x)'])
    expect(out[1].rows).toEqual([['1', '2'], ['3', '4']])
    expect(out[2].text).toBe('Find f(5).')
  })

  // The separator row is what makes this safe. Without requiring it, ordinary
  // prose with a pipe — or conditional probability — becomes a table.
  it('needs a separator row: P(A | B) is not a table', () => {
    const out = parseTableBlocks('Find P(A | B) given P(B) = 0.5')
    expect(out.map(b => b.kind)).toEqual(['text'])
  })

  it('does not split a cell on a pipe inside math', () => {
    const out = parseTableBlocks('| set | size |\n|---|---|\n| \\(|A|\\) | 2 |')
    expect(out[0].rows).toEqual([['\\(|A|\\)', '2']])
  })

  it('keeps LaTeX in cells for the math renderer', () => {
    const out = parseTableBlocks('| n | \\(n^2\\) |\n|---|---|\n| \\(x\\) | \\(x^2\\) |')
    expect(out[0].headers).toEqual(['n', '\\(n^2\\)'])
    expect(out[0].rows[0]).toEqual(['\\(x\\)', '\\(x^2\\)'])
  })

  it('normalises a short or long row to the header width', () => {
    const out = parseTableBlocks('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |')
    expect(out[0].rows).toEqual([['1', ''], ['1', '2']])
  })

  it('returns a single text block when there is no table', () => {
    expect(parseTableBlocks('just prose')).toEqual([{ kind: 'text', text: 'just prose' }])
  })

  it('returns nothing for empty input', () => {
    expect(parseTableBlocks('')).toEqual([])
  })
})
