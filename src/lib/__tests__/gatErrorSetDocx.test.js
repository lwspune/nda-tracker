import { describe, it, expect } from 'vitest'
import { buildGatErrorSetDocx } from '../gatErrorSetDocx'
import JSZip from 'jszip'

// Builds a real .docx and inspects the OOXML. Every failure guarded here is
// silent: a missed marker swap prints "OMML_3" at a student and throws nothing,
// and a solution leaking into the question section is invisible until he has
// already read the answer.

const subjects = [
  {
    subject: 'English',
    counts: { wrong: 1, skipped: 1 },
    chapters: [{
      chapter: 'Reading Comprehension',
      counts: { wrong: 1, skipped: 1 },
      questions: [
        {
          n: 1, bucket: 'wrong', difficulty: 'Moderate', q: 4, repeats: [],
          showContext: true, context: 'Directions: read the passage below.',
          subject: 'English', chapter: 'Reading Comprehension', subtopic: 'Inference',
          question: 'The author most nearly implies that',
          options: ['alpha', 'beta', 'gamma', 'delta'],
          answer: 'C', solution: 'Answer: C. The second paragraph says so.',
          examName: 'GAT Mock 3', examDate: '2026-08-11',
        },
        {
          n: 2, bucket: 'skipped', difficulty: '', q: 5,
          repeats: [{ examName: 'GAT Mock 5', examDate: '2026-08-21', bucket: 'wrong' }],
          showContext: false, context: 'Directions: read the passage below.',
          subject: 'English', chapter: 'Reading Comprehension', subtopic: '',
          question: 'The tone of the passage is best described as',
          options: ['wry', 'bleak', '', ''],
          answer: 'A', solution: '',
          examName: 'GAT Mock 3', examDate: '2026-08-11',
        },
      ],
    }],
  },
  {
    subject: 'Physics',
    counts: { wrong: 1, skipped: 0 },
    chapters: [{
      chapter: 'Optics',
      counts: { wrong: 1, skipped: 0 },
      questions: [{
        n: 3, bucket: 'wrong', difficulty: 'Hard', q: 9, repeats: [],
        showContext: false, context: '',
        subject: 'Physics', chapter: 'Optics', subtopic: 'Mirrors',
        // A genuine "<" inside the maths alongside a fraction pins both halves
        // of the OMML sanitizer: real text escaped, real markup left alone.
        question: 'For \\(0 < u < f\\), the magnification is \\(\\frac{f}{f-u}\\)?',
        options: ['\\(\\frac{1}{2}\\)', 'no', '', ''],
        answer: 'B', solution: 'Use \\(\\frac{1}{v}-\\frac{1}{u}=\\frac{1}{f}\\).',
        examName: 'GAT Mock 4', examDate: '2026-08-14',
      }],
    }],
  },
]

const totals = { questions: 3, counts: { wrong: 2, skipped: 1 }, droppedNoText: 0, missingSolution: 1, repeats: 1, exams: 2 }

async function build() {
  const blob = await buildGatErrorSetDocx({ studentName: 'Jagannath Rout', subjects, totals })
  const zip = await JSZip.loadAsync(blob)
  return zip.file('word/document.xml').async('text')
}

describe('buildGatErrorSetDocx', () => {
  it('emits real Word equations and leaves no marker behind', async () => {
    const xml = await build()
    expect(xml).toContain('<m:oMath')
    expect(xml).not.toMatch(/OMML_\d+/)
    // The fallback renderer would print this instead of a fraction.
    expect(xml).not.toContain('frac')
  })

  it('renders a shared Directions block once, not per question', async () => {
    const xml = await build()
    const hits = xml.split('Directions: read the passage below.').length - 1
    expect(hits).toBe(1)
  })

  it('keeps solutions out of the question section', async () => {
    const xml = await build()
    const qStart = xml.indexOf('The author most nearly implies')
    const sStart = xml.indexOf('Solutions')
    expect(qStart).toBeGreaterThan(-1)
    expect(sStart).toBeGreaterThan(qStart)
    expect(xml.indexOf('The second paragraph says so')).toBeGreaterThan(sStart)
  })

  it('strips the duplicated "Answer: C." prefix from a solution', async () => {
    const xml = await build()
    // The letter is printed on its own line; the solution should not repeat it.
    expect(xml).toContain('The second paragraph says so')
    expect(xml).not.toContain('Answer: C. The second paragraph')
  })

  it('says so when a question has no worked solution', async () => {
    const xml = await build()
    expect(xml).toContain('No worked solution recorded')
  })

  it('flags a question the student has seen more than once', async () => {
    const xml = await build()
    expect(xml).toContain('[SEEN 2')
  })

  it('tags every question with its bucket', async () => {
    const xml = await build()
    expect(xml).toContain('[WRONG]')
    expect(xml).toContain('[SKIPPED]')
  })
})
