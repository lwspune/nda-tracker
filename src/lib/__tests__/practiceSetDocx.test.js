import { describe, it, expect } from 'vitest'
import { buildPracticeSetDocx } from '../practiceSetDocx'
import JSZip from 'jszip'

// Builds a real .docx and inspects the OOXML. The failure this guards is silent:
// if the marker->OMML swap misses, the student gets a paper with "OMML_37"
// printed where an equation should be, and nothing throws.

const rows = [
  {
    subtopic: 'Probability via Counting', chapter: 'Probability',
    marksAtStake: 11.8, projected: 4.6, lift: 7.2,
    counts: { right: 1, wrong: 1, skipped: 0, absent: 0 },
    questions: [
      {
        n: 1, bucket: 'wrong', difficulty: 'Easy', q: 1,
        question: 'The probability of getting at least 2 tails is \\(\\frac{1}{2}\\)',
        options: ['\\(\\frac{3}{4}\\)', '\\(\\frac{1}{4}\\)', '\\(\\frac{1}{2}\\)', '\\(\\frac{1}{3}\\)'],
        answer: 'C',
      },
      {
        n: 2, bucket: 'right', difficulty: '', q: 2,
        question: 'Plain text question with no maths at all',
        options: ['one', 'two', '', ''],
        answer: 'A',
      },
    ],
  },
  {
    subtopic: 'Never Set', chapter: 'Lines',
    marksAtStake: 4.5, projected: 0, lift: 4.5,
    counts: { right: 0, wrong: 0, skipped: 0, absent: 0 },
    questions: [],
  },
]
const totals = { questions: 2, lift: 11.7, counts: { right: 1, wrong: 1, skipped: 0, absent: 0 } }

async function build() {
  const blob = await buildPracticeSetDocx({ studentName: 'Amy Example', rows, totals })
  const zip = await JSZip.loadAsync(blob)
  return {
    zip,
    doc: await zip.file('word/document.xml').async('text'),
    settings: await zip.file('word/settings.xml').async('text'),
  }
}

describe('buildPracticeSetDocx', () => {
  it('produces a valid docx package', async () => {
    const { zip } = await build()
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/settings.xml']) {
      expect(zip.file(part), part).toBeTruthy()
    }
  }, 30000)

  it('leaves no OMML markers behind', async () => {
    const { doc } = await build()
    expect(doc).not.toContain('OMML_')
  }, 30000)

  it('emits real Word equations for the LaTeX', async () => {
    const { doc } = await build()
    expect(doc).toContain('<m:oMath')
  }, 30000)

  it('injects mathPr — without it Word indents every fraction', async () => {
    const { settings } = await build()
    expect(settings).toContain('<m:mathPr')
  }, 30000)

  it('runs the question body in two columns', async () => {
    const { doc } = await build()
    expect(doc).toMatch(/<w:cols[^>]*w:num="2"/)
  }, 30000)

  it('tags each question inline and names the student', async () => {
    const { doc } = await build()
    expect(doc).toContain('[WRONG]')
    expect(doc).toContain('[EASY]')
    expect(doc).toContain('Amy Example')
  }, 30000)

  it('says so when a subtopic has no questions rather than dropping it', async () => {
    const { doc } = await build()
    expect(doc).toContain('Never Set')
    expect(doc).toContain('No questions available for this subtopic yet')
  }, 30000)

  it('renders an answer key', async () => {
    const { doc } = await build()
    expect(doc).toContain('Answer Key')
  }, 30000)

  it('does not print raw LaTeX anywhere', async () => {
    const { doc } = await build()
    expect(doc).not.toContain('\\frac')
  }, 30000)
})

// ── interop + fallback ──────────────────────────────────────────────────────
// docx/mathml2omml are CJS. Under Node the named export is present, but
// Vite's browser interop can leave it undefined with `.default` holding the
// exports OBJECT — a `a || b || c` chain then yields a non-callable object and
// every equation silently degrades to stripped text. That shipped once.

import { prettifyMath } from '../practiceSetDocx'

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
