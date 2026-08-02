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

// ── progress reporting ──────────────────────────────────────────────────────
// The build is one synchronous CPU block: without an AWAITED seam the caller
// never gets a frame to repaint in, so a progress bar sits at 0 and then
// disappears. These pin the seam, not the cosmetics.

describe('buildPracticeSetDocx — onProgress', () => {
  it('reports monotonically and finishes at exactly 100', async () => {
    const seen = []
    await buildPracticeSetDocx({
      studentName: 'Amy Example', rows, totals,
      onProgress: (pct, label) => { seen.push({ pct, label }) },
    })
    expect(seen.length).toBeGreaterThan(3)
    expect(seen[0].pct).toBeLessThanOrEqual(15)
    expect(seen.at(-1).pct).toBe(100)
    for (const { pct } of seen) {
      expect(pct).toBeGreaterThanOrEqual(0)
      expect(pct).toBeLessThanOrEqual(100)
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].pct, `step ${i} went backwards`).toBeGreaterThanOrEqual(seen[i - 1].pct)
    }
    expect(seen.every(s => typeof s.label === 'string' && s.label.length > 0)).toBe(true)
  }, 30000)

  it('ticks once per subtopic through the rendering stretch', async () => {
    const seen = []
    await buildPracticeSetDocx({
      studentName: 'Amy Example', rows, totals,
      onProgress: (pct, label) => { seen.push({ pct, label }) },
    })
    // rows has 2 subtopics — the question stretch must report each, else the
    // bar jumps the part of the build that actually takes the time.
    const rendering = seen.filter(s => /question/i.test(s.label))
    expect(rendering.length).toBeGreaterThanOrEqual(rows.length)
  }, 30000)

  it('AWAITS a promise-returning callback — the repaint seam', async () => {
    const order = []
    await buildPracticeSetDocx({
      studentName: 'Amy Example', rows, totals,
      onProgress: (pct) => {
        order.push(`report:${pct}`)
        // A real caller yields a frame here. If the builder does not await,
        // every report lands before any resume and the strict alternation below
        // fails — which is exactly the bug that leaves the bar frozen at 0.
        return new Promise(res => setTimeout(() => { order.push(`resume:${pct}`); res() }, 0))
      },
    })
    expect(order.length).toBeGreaterThan(6)
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].startsWith('report:'), `${order[i]} at ${i}`).toBe(true)
      expect(order[i + 1]).toBe(order[i].replace('report:', 'resume:'))
    }
  }, 30000)

  it('builds fine with no onProgress at all', async () => {
    const { doc } = await build()
    expect(doc).toContain('Answer Key')
  }, 30000)
})

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
