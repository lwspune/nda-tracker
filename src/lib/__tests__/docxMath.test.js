// The shared LaTeX -> Word-equation pipeline, extracted from practiceSetDocx.js
// so the practice set, the GAT error set and the class exam report run one
// implementation instead of three.
//
// The integration guards live in practiceSetDocx.test.js / gatErrorSetDocx.test.js
// — they build a real .docx and read the OOXML back, which is the only way to
// catch a marker that never got swapped. What is pinned HERE is the pieces those
// two used to own a copy of each, and above all `pickFn`'s refusal: a resolver
// that falls back instead of throwing is what shipped "dfrac 1 16" to a student.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { prettifyMath, pickFn, createMathRenderer, applyOmml, MARKER } from '../docxMath'

describe('prettifyMath — the last-resort renderer', () => {
  it('renders a fraction readably instead of leaking the macro name', () => {
    expect(prettifyMath(String.raw`\dfrac{1}{16}`)).toBe('(1)/(16)')
    expect(prettifyMath(String.raw`\frac{3}{4}`)).toBe('(3)/(4)')
    expect(prettifyMath(String.raw`\tfrac{1}{2}`)).toBe('(1)/(2)')
  })

  it('never emits a bare macro name — the "dfrac 1 16" leak', () => {
    for (const src of [String.raw`\dfrac{1}{16}`, String.raw`\sqrt{2}`,
                       String.raw`\pi`, String.raw`\times`]) {
      expect(prettifyMath(src)).not.toMatch(/frac|sqrt|pi\b|times/)
    }
  })

  it('maps the common symbols', () => {
    expect(prettifyMath(String.raw`\sqrt{2}`)).toBe('√(2)')
    expect(prettifyMath(String.raw`\pi`)).toBe('π')
    expect(prettifyMath(String.raw`a \times b`)).toBe('a × b')
    expect(prettifyMath(String.raw`x \leq y`)).toBe('x ≤ y')
  })

  it('leaves plain text alone', () => {
    expect(prettifyMath('n + 1')).toBe('n + 1')
  })
})

describe('pickFn — the interop guard', () => {
  it('finds a named export', () => {
    const f = () => 1
    expect(pickFn({ mml2omml: f }, 'mml2omml')).toBe(f)
  })

  it('finds it under .default when Vite wraps the CJS exports object', () => {
    const f = () => 1
    expect(pickFn({ default: { mml2omml: f } }, 'mml2omml')).toBe(f)
  })

  it('finds a module that IS the function', () => {
    const f = () => 1
    expect(pickFn(f, 'mml2omml')).toBe(f)
  })

  // The whole point. A `a || b || c` chain resolves to the namespace OBJECT,
  // which is not callable, and every equation then degrades to stripped text
  // with nothing thrown — the file ships saying "dfrac 1 16".
  it('THROWS rather than returning a non-callable', () => {
    expect(() => pickFn({ default: { somethingElse: 1 } }, 'mml2omml')).toThrow(/mml2omml/)
    expect(() => pickFn(null, 'mml2omml')).toThrow(/mml2omml/)
    expect(() => pickFn({}, 'renderToString')).toThrow(/renderToString/)
  })
})

describe('createMathRenderer', () => {
  async function renderer() {
    const docx = await import('docx')
    return { docx, m: await createMathRenderer(docx) }
  }

  it('emits a marker run per equation and collects its OMML in order', async () => {
    const { m } = await renderer()
    const runs = m.mathRuns('Take \\(\\frac{1}{2}\\) then \\(\\sqrt{3}\\)')
    expect(m.ommlByIndex).toHaveLength(2)
    expect(m.ommlByIndex[0]).toContain('m:oMath')
    expect(m.ommlByIndex[1]).toContain('m:oMath')
    expect(runs.length).toBeGreaterThan(2)
  })

  it('falls back to prettified text when the LaTeX will not convert', async () => {
    const { m } = await renderer()
    m.mathRuns('\\(\\notarealmacro{x}\\)')
    expect(m.ommlByIndex).toHaveLength(0)
  })

  it('returns at least one run for empty text, so a paragraph is never childless', async () => {
    const { m } = await renderer()
    expect(m.mathRuns('')).toHaveLength(1)
  })

  it('builds a Word table from a GFM block', async () => {
    const { docx, m } = await renderer()
    const table = m.contentTable({ headers: ['Class', 'f'], rows: [['0-10', '4']] })
    expect(table).toBeInstanceOf(docx.Table)
  })

  it('gives each renderer its OWN equation list', async () => {
    const { m: a } = await renderer()
    const { m: b } = await renderer()
    a.mathRuns('\\(x\\)')
    expect(a.ommlByIndex).toHaveLength(1)
    expect(b.ommlByIndex).toHaveLength(0)
  })
})

describe('applyOmml', () => {
  async function zipWith(documentXml, settingsXml = '<w:settings></w:settings>') {
    const zip = new JSZip()
    zip.file('word/document.xml', documentXml)
    zip.file('word/settings.xml', settingsXml)
    return zip
  }

  const markerRun = i => `<w:r><w:t xml:space="preserve">${MARKER}${i}</w:t></w:r>`

  it('swaps each marker for its OWN equation, in order', async () => {
    const zip = await zipWith(`<w:p>${markerRun(0)}${markerRun(1)}</w:p>`)
    await applyOmml(zip, ['<m:oMath>FIRST</m:oMath>', '<m:oMath>SECOND</m:oMath>'])
    const xml = await zip.file('word/document.xml').async('text')
    expect(xml.indexOf('FIRST')).toBeLessThan(xml.indexOf('SECOND'))
    expect(xml).not.toContain(MARKER)
  })

  it('leaves an unknown marker untouched rather than deleting it', async () => {
    const zip = await zipWith(`<w:p>${markerRun(7)}</w:p>`)
    await applyOmml(zip, ['<m:oMath>ONLY</m:oMath>'])
    expect(await zip.file('word/document.xml').async('text')).toContain(`${MARKER}7`)
  })

  // Without <m:mathPr> Word gives every fraction about an inch of phantom
  // left indent. It is not optional.
  it('injects mathPr into settings.xml', async () => {
    const zip = await zipWith('<w:p/>')
    await applyOmml(zip, ['<m:oMath>X</m:oMath>'])
    expect(await zip.file('word/settings.xml').async('text')).toContain('<m:mathPr')
  })

  it('does not inject mathPr twice', async () => {
    const zip = await zipWith('<w:p/>', '<w:settings><m:mathPr/></w:settings>')
    await applyOmml(zip, ['<m:oMath>X</m:oMath>'])
    const s = await zip.file('word/settings.xml').async('text')
    expect(s.match(/<m:mathPr/g)).toHaveLength(1)
  })

  it('is a no-op on the document when there are no equations', async () => {
    const zip = await zipWith('<w:p>plain</w:p>')
    await applyOmml(zip, [])
    expect(await zip.file('word/document.xml').async('text')).toBe('<w:p>plain</w:p>')
  })
})

// prettifyMath only fires when conversion FAILS, which on the live bank is ~77
// macro occurrences (all data-entry typos). The cost of a thin map is that the
// surrounding, perfectly good maths gets mangled with it — so the map covers
// what the bank actually uses.
describe('prettifyMath — set notation and accents survive the fallback', () => {
  it('maps set operators instead of dropping them', () => {
    expect(prettifyMath(String.raw`A \cup B`)).toBe('A ∪ B')
    expect(prettifyMath(String.raw`A \cap B`)).toBe('A ∩ B')
    expect(prettifyMath(String.raw`x \in A`)).toBe('x ∈ A')
    expect(prettifyMath(String.raw`x \notin A`)).toBe('x ∉ A')
    expect(prettifyMath(String.raw`A \subseteq B`)).toBe('A ⊆ B')
    expect(prettifyMath(String.raw`A \setminus B`)).toBe('A ∖ B')
  })

  // \cap\bar used to become "∩bar": a plain \b word boundary breaks when the
  // next character is a letter, so the macro must be matched as a whole
  // control word instead.
  it('matches a whole control word, not a prefix', () => {
    expect(prettifyMath(String.raw`\cup`)).toBe('∪')
    expect(prettifyMath(String.raw`A \cap \bar{B}`)).not.toMatch(/bar|cap/)
    // \in must not fire inside \infty
    expect(prettifyMath(String.raw`x \to \infty`)).toBe('x → ∞')
  })

  it('keeps an overline as an overline', () => {
    expect(prettifyMath(String.raw`\overline{AB}`)).toBe('A̅B̅')
    expect(prettifyMath(String.raw`\bar{x}`)).toBe('x̅')
  })

  it('renders a complement superscript', () => {
    expect(prettifyMath(String.raw`(A \cup B)^c`)).toBe('(A ∪ B)ᶜ')
  })

  it('maps the greek and relation macros the bank uses', () => {
    expect(prettifyMath(String.raw`\alpha + \beta`)).toBe('α + β')
    expect(prettifyMath(String.raw`\triangle ABC`)).toBe('△ ABC')
    expect(prettifyMath(String.raw`x \geq y`)).toBe('x ≥ y')
  })

  it('keeps a function name as a word', () => {
    expect(prettifyMath(String.raw`\sin x + \cos y`)).toBe('sin x + cos y')
  })

  it('renders degrees', () => {
    expect(prettifyMath(String.raw`90^\circ`)).toBe('90°')
  })
})
