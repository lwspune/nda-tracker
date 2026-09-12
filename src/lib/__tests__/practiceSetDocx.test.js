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
      {
        // A genuine "<" inside the maths — the whole reason sanitizeOmml exists.
        // Paired with the fractions above it pins both halves of the sanitizer:
        // real text must be escaped, real markup must not.
        n: 3, bucket: 'skipped', difficulty: 'Hard', q: 3,
        question: 'How many integers satisfy \\(0 < x < 1\\)?',
        options: ['\\(\\frac{1}{x} > 2\\)', 'none', '', ''],
        answer: 'B',
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

  // The failure class this closes: the package is a valid ZIP and every part is
  // present, so every structural assertion above still passes — but document.xml
  // does not parse and Word refuses the file outright ("Word experienced an error
  // trying to open the file"). Containment checks cannot see that; only a parse can.
  it('produces well-formed XML — Word refuses the file otherwise', async () => {
    const { doc } = await build()
    const parsed = new DOMParser().parseFromString(doc, 'application/xml')
    expect(parsed.querySelector('parsererror')?.textContent ?? '').toBe('')
  }, 30000)

  // sanitizeOmml escapes <, > and & inside <m:t> text. Its element test must be
  // exact: `<m:t` is ALSO a prefix of `<m:type>`, which every fraction emits, and
  // a prefix match swallows the live markup up to the next </m:t> and escapes it.
  it('escapes the maths text without escaping the markup around it', async () => {
    const { doc } = await build()
    expect(doc).toContain('<m:type m:val="bar"/>')  // every fraction emits one
    expect(doc).not.toContain('&lt;m:')             // no live OMML turned into text
    expect(doc).toContain('0&lt;x&lt;1')            // a real "<" still escaped
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

  // Each equation is emitted as an indexed marker run and swapped for its OMML
  // after packing. A mis-mapped index puts question 7's equation on question 3:
  // the package is still valid, still parses, still has no markers left and
  // still contains the right SET of equations — so every other assertion here
  // passes. Only position tells you. Distinct denominators (101…115) make each
  // equation identifiable; 15 of them takes the index into two digits, where a
  // prefix-matching swap (OMML_1 eating OMML_12) would show up.
  it('swaps each marker for its OWN equation, in order', async () => {
    const n = 15
    const rowsMany = [{
      subtopic: 'Marker Order', chapter: 'Algebra',
      marksAtStake: 1, projected: 0, lift: 1,
      counts: { right: 0, wrong: 0, skipped: n, absent: 0 },
      questions: Array.from({ length: n }, (_, i) => ({
        n: i + 1, bucket: 'skipped', difficulty: '', q: i + 1,
        question: `Marker check \\(\\frac{1}{${101 + i}}\\)`,
        options: ['', '', '', ''], answer: 'A',
      })),
    }]
    const blob = await buildPracticeSetDocx({
      studentName: 'Amy Example', rows: rowsMany,
      totals: { questions: n, lift: 1, counts: { right: 0, wrong: 0, skipped: n, absent: 0 } },
    })
    const doc = await (await JSZip.loadAsync(blob)).file('word/document.xml').async('text')
    expect(doc).not.toContain('OMML_')

    for (let i = 0; i < n; i++) {
      const here = doc.indexOf(`>Q${i + 1}. <`)
      const next = i + 1 < n ? doc.indexOf(`>Q${i + 2}. <`) : doc.length
      const eq   = doc.indexOf(`>${101 + i}</m:t>`)
      expect(here, `Q${i + 1} missing`).toBeGreaterThan(-1)
      expect(eq, `equation ${101 + i} missing`).toBeGreaterThan(-1)
      expect(eq > here && eq < next,
        `equation ${101 + i} landed outside Q${i + 1}`).toBe(true)
    }
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

// prettifyMath moved to docxMath.js with the rest of the pipeline; its tests
// moved with it, to docxMath.test.js.

// ── formatting parity with PYQ Vault's exporter ─────────────────────────────
// Each block below is a defect that reached a downloaded practice set: the file
// opened fine and every structural assertion above passed, but the maths on the
// page was wrong. Counts are from the live question bank (Maths scope).

async function buildOne(question, options = ['', '', '', '']) {
  const blob = await buildPracticeSetDocx({
    studentName: 'Amy Example',
    rows: [{
      subtopic: 'Fixture', chapter: 'Fixture',
      marksAtStake: 1, projected: 0, lift: 1,
      counts: { right: 0, wrong: 1, skipped: 0, absent: 0 },
      questions: [{ n: 1, bucket: 'wrong', difficulty: '', q: 1, question, options, answer: 'A' }],
    }],
    totals: { questions: 1, lift: 1, counts: { right: 0, wrong: 1, skipped: 0, absent: 0 } },
  })
  return (await JSZip.loadAsync(blob)).file('word/document.xml').async('text')
}

describe('buildPracticeSetDocx — matrices and determinants (283 questions)', () => {
  // mathml2omml renders the stretchy fence as a plain text run beside the grid,
  // so Word draws a tiny fixed-height bar that does not enclose the matrix.
  it('encloses a determinant in a stretching delimiter', async () => {
    const doc = await buildOne(String.raw`Evaluate \(\begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix}\)`)
    expect(doc).toContain('<m:begChr m:val="|"/>')
    expect(doc).toContain('<m:endChr m:val="|"/>')
    // the detached flanking run is gone
    expect(doc).not.toContain('<m:t xml:space="preserve">∣</m:t>')
  }, 30000)

  it('encloses a pmatrix', async () => {
    const doc = await buildOne(String.raw`Given \(\begin{pmatrix} a & b \\ c & d \end{pmatrix}\)`)
    expect(doc).toContain('<m:begChr m:val="("/>')
    expect(doc).toContain('<m:endChr m:val=")"/>')
  }, 30000)

  it('encloses a one-sided cases brace', async () => {
    const doc = await buildOne(String.raw`Let \(f(x)=\begin{cases} x & x>0 \\ 0 & x\le 0 \end{cases}\)`)
    expect(doc).toContain('<m:begChr m:val="{"/>')
    expect(doc).toContain('<m:endChr m:val=""/>')
  }, 30000)

  it('still parses — a bad rewrite makes Word refuse the file', async () => {
    const doc = await buildOne(String.raw`\(\begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix}\)`)
    const parsed = new DOMParser().parseFromString(doc, 'application/xml')
    expect(parsed.querySelector('parsererror')?.textContent ?? '').toBe('')
  }, 30000)
})

describe('buildPracticeSetDocx — accents (57 questions)', () => {
  // KaTeX gets the structure right (<m:acc>) but hands Word a SPACING glyph.
  // Word can only position a combining mark over the base.
  it('gives \\bar a combining overline, not a spacing macron', async () => {
    const doc = await buildOne(String.raw`The mean is \(\bar{x}\)`)
    expect(doc).toContain('<m:chr m:val="̅"/>')
    expect(doc).not.toContain('<m:chr m:val="ˉ"/>')
  }, 30000)

  it('gives \\overline a combining overline', async () => {
    const doc = await buildOne(String.raw`The segment \(\overline{AB}\)`)
    expect(doc).toContain('<m:chr m:val="̅"/>')
    expect(doc).not.toContain('<m:chr m:val="‾"/>')
  }, 30000)

  it('leaves \\vec alone — already combining', async () => {
    const doc = await buildOne(String.raw`The vector \(\vec{a}\)`)
    expect(doc).toContain('<m:chr m:val="⃗"/>')
  }, 30000)
})

describe('buildPracticeSetDocx — pipe tables (15 questions)', () => {
  const STEM = 'Study the table.\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nFind y at x=3.'

  it('renders a GFM table as a Word table, not raw pipes', async () => {
    const doc = await buildOne(STEM)
    expect(doc).not.toContain('|---|')
  }, 30000)

  it('adds a table to the document that a table-free stem does not', async () => {
    const withTable = await buildOne(STEM)
    const without = await buildOne('Study the table. Find y at x=3.')
    const count = d => (d.match(/<w:tbl>/g) || []).length
    expect(count(withTable)).toBe(count(without) + 1)
  }, 30000)

  it('keeps the prose either side of the table', async () => {
    const doc = await buildOne(STEM)
    expect(doc).toContain('Study the table.')
    expect(doc).toContain('Find y at x=3.')
  }, 30000)

  // Sliced between the two prose blocks, so this pins the cell values AND the
  // table's position in the stem — the cover and answer-key tables sit outside
  // the window and cannot satisfy it.
  it('puts the cell values in a table between the prose', async () => {
    const doc = await buildOne(STEM)
    const between = doc.slice(doc.indexOf('Study the table.'), doc.indexOf('Find y at x=3.'))
    expect(between).toContain('<w:tbl>')
    expect(between).toContain('>x</w:t>')
    expect(between).toContain('>1</w:t>')
  }, 30000)

  // The number rides on the first PARAGRAPH; a stem that opens with a table
  // would otherwise lose it.
  it('still numbers a question whose stem OPENS with a table', async () => {
    const doc = await buildOne('| x | y |\n|---|---|\n| 1 | 2 |')
    expect(doc).toContain('Q1. ')
  }, 30000)

  // The bucket tag rides on the last PROSE paragraph, so a stem ending in a
  // table needs it emitted separately.
  it('still tags a question whose stem ENDS with a table', async () => {
    const doc = await buildOne('Study this.\n\n| x | y |\n|---|---|\n| 1 | 2 |')
    expect(doc).toContain('[WRONG]')
  }, 30000)
})

describe('buildPracticeSetDocx — markdown bold (427 questions bank-wide)', () => {
  it('renders **bold** as a bold run, never as asterisks', async () => {
    const doc = await buildOne('Which of the following is **not** a prime?')
    expect(doc).not.toContain('**')
    // docx emits <w:b/><w:bCs/> plus sizing in the run properties, so match the
    // bold flag and the text within one run rather than an exact rPr.
    expect(doc).toMatch(/<w:b\/>[\s\S]{0,200}?<w:t[^>]*>not<\/w:t>/)
  }, 30000)

  it('resolves bold in an option too', async () => {
    const doc = await buildOne('Pick one', ['**yes**', 'no', '', ''])
    expect(doc).not.toContain('**')
    expect(doc).toMatch(/<w:b\/>[\s\S]{0,200}?<w:t[^>]*>yes<\/w:t>/)
  }, 30000)

  // Bold is a flag, not a segment type: the span has to survive the math zone
  // inside it, and the math still has to convert.
  it('carries bold across a maths zone', async () => {
    const doc = await buildOne(String.raw`A **matrix of order \(m \times n\) here**`)
    expect(doc).not.toContain('**')
    expect(doc).toContain('<m:oMath')
  }, 30000)
})

describe('buildPracticeSetDocx — the structural guard', () => {
  // A zone whose OMML is malformed must fall back to text. Shipping it makes
  // Word refuse the ENTIRE document, so one bad equation loses the whole set.
  it('never emits an unparseable document for a hostile stem', async () => {
    const doc = await buildOne(String.raw`Compare \(0 < \alpha < 90\) and \(a & b\) and \(\x\)`)
    const parsed = new DOMParser().parseFromString(doc, 'application/xml')
    expect(parsed.querySelector('parsererror')?.textContent ?? '').toBe('')
    expect(doc).not.toContain('OMML_')
  }, 30000)

  // \x is not a KaTeX macro (17 occurrences in the live bank, all typos). The
  // zone must degrade to readable text, not vanish and not leak a backslash.
  it('falls back to readable text for an unconvertible zone', async () => {
    const doc = await buildOne(String.raw`Let \(\x\) be given`)
    expect(doc).not.toContain('\\x')
    expect(doc).toContain('Let ')
    expect(doc).toContain(' be given')
  }, 30000)
})

