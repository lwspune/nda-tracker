// The class exam report as Word. Builds a real .docx and reads the OOXML back —
// the same posture as practiceSetDocx.test.js, because every failure this
// guards is silent: a missed marker swap prints "OMML_3" at a teacher and
// throws nothing, and a solution leaking into the question section is invisible
// until someone has already read the answer.
//
// Spec: EXAM_REPORT_DOCX.md.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildExamReportDocx, examReportDocxFilename } from '../examReportDocx'

function mcqExam(over = {}) {
  const questions = [
    {
      q: 1, chapter: 'Integration', subtopic: 'Definite Integrals',
      question: 'Evaluate \\(\\int_0^1 \\dfrac{x^2}{1+x^2}\\,dx\\)',
      optionA: '\\(\\frac{1}{3}\\)', optionB: '2', optionC: '3', optionD: '4',
      answer: 'A', difficulty: 'Moderate',
      solution: 'Split the integrand: \\(\\frac{x^2}{1+x^2} = 1 - \\frac{1}{1+x^2}\\).',
    },
    {
      q: 2, chapter: 'Statistics', subtopic: 'Mean',
      question: 'Given:\n| Class | f |\n|---|---|\n| 0-10 | 4 |\nfind the mean',
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
      answer: 'B', difficulty: 'Easy', solution: '',
    },
    {
      q: 3, chapter: 'Matrices', subtopic: 'Determinants',
      question: 'Find \\(\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}\\)',
      optionA: 'ad-bc', optionB: 'B', optionC: 'C', optionD: 'D',
      answer: 'A', difficulty: 'Hard', solution: 'Expand along the first row.',
    },
  ]
  // Everyone gets q1 and q3 wrong and skips q2, so all three reach the report.
  const students = Array.from({ length: 6 }, (_, i) => ({
    name: `Student ${i + 1}`,
    totalMarks: 30 - i * 4,
    correct: 10, incorrect: 2, notAttempted: 1,
    responses: { 1: -1, 2: 0, 3: -1 },
  }))
  return {
    name: 'Maths Mock 1', date: '2026-09-05', subject: 'Maths',
    batch: 'APJ_NDA_11th_A', branch: 'APJ',
    marking: { correct: 2.5, wrong: -0.83 },
    questions, students,
    ...over,
  }
}

function writtenExam(over = {}) {
  return {
    name: 'Sets', date: '2026-07-27', subject: 'Maths',
    marking: { correct: 1, wrong: 0 }, questions: [], maxMarks: 20,
    students: [
      { name: 'Alice', totalMarks: 18, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
      { name: 'Bob', totalMarks: 8, correct: 0, incorrect: 0, notAttempted: 0, responses: {} },
    ],
    ...over,
  }
}

async function docXml(exam, opts) {
  const blob = await buildExamReportDocx({ exam, ...opts })
  return (await JSZip.loadAsync(blob)).file('word/document.xml').async('text')
}

describe('buildExamReportDocx', () => {
  it('produces a valid docx package', async () => {
    const blob = await buildExamReportDocx({ exam: mcqExam() })
    const zip = await JSZip.loadAsync(blob)
    expect(zip.file('word/document.xml')).toBeTruthy()
    expect(zip.file('word/settings.xml')).toBeTruthy()
  })

  it('produces well-formed XML — Word refuses the file otherwise', async () => {
    const xml = await docXml(mcqExam())
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('leaves no OMML markers behind', async () => {
    expect(await docXml(mcqExam())).not.toContain('OMML_')
  })

  it('emits real Word equations rather than raw LaTeX', async () => {
    const xml = await docXml(mcqExam())
    expect(xml).toContain('<m:oMath')
    expect(xml).not.toContain('dfrac')
    expect(xml).not.toContain('\\int')
  })

  it('injects mathPr — without it Word indents every fraction', async () => {
    const blob = await buildExamReportDocx({ exam: mcqExam() })
    const settings = await (await JSZip.loadAsync(blob)).file('word/settings.xml').async('text')
    expect(settings).toContain('<m:mathPr')
  })

  it('heads the report with the exam, its date and its cohort', async () => {
    const xml = await docXml(mcqExam())
    for (const s of ['Maths Mock 1', '2026-09-05', 'Maths', 'APJ_NDA_11th_A', 'APJ']) {
      expect(xml).toContain(s)
    }
  })
})

// Every number in this document also appears in the PDF. They come from the
// same exported builders so the two cannot drift — a second implementation of
// "median" is how one surface ends up quoting a different figure to a parent.
describe('buildExamReportDocx — shares the PDF’s numbers', () => {
  it('carries the class overview tiles, MCQ-flavoured', async () => {
    const xml = await docXml(mcqExam())
    expect(xml).toContain('Questions')
    expect(xml).toContain('Students')
    expect(xml).toContain('Avg Score')
  })

  it('uses the paper ceiling instead of a question count for a written paper', async () => {
    const xml = await docXml(writtenExam())
    expect(xml).toContain('Max Marks')
  })

  it('prints the median line', async () => {
    expect(await docXml(mcqExam())).toContain('Median')
  })

  it('lists every student, ranked, on the all-students table', async () => {
    const xml = await docXml(mcqExam())
    for (let i = 1; i <= 6; i++) expect(xml).toContain(`Student ${i}`)
    expect(xml.indexOf('Student 1')).toBeLessThan(xml.indexOf('Student 6'))
  })

  it('shows the marking scheme for an MCQ paper', async () => {
    expect(await docXml(mcqExam())).toContain('+2.5')
  })
})

describe('buildExamReportDocx — question sections', () => {
  it('names the most-wrong questions with their chapter and subtopic', async () => {
    const xml = await docXml(mcqExam())
    expect(xml).toContain('Integration')
    expect(xml).toContain('Definite Integrals')
  })

  it('marks the correct option', async () => {
    const xml = await docXml(mcqExam())
    expect(xml).toContain('Answer: A')
  })

  it('renders a pipe-table in a stem as a Word table, not a wall of pipes', async () => {
    const xml = await docXml(mcqExam())
    expect(xml).toContain('<w:tbl>')
    expect(xml).not.toContain('|---|')
  })

  // A written paper records a total and nothing else, so every per-question
  // section is empty by construction.
  it('builds no question sections for a written paper', async () => {
    const xml = await docXml(writtenExam())
    expect(xml).not.toContain('Most Wrong')
    expect(xml).not.toContain('Most Skipped')
  })
})

describe('buildExamReportDocx — worked solutions (D3)', () => {
  it('includes them by default', async () => {
    expect(await docXml(mcqExam())).toContain('Split the integrand')
  })

  it('omits them when asked', async () => {
    const xml = await docXml(mcqExam(), { includeSolutions: false })
    expect(xml).not.toContain('Split the integrand')
    expect(xml).not.toContain('Expand along the first row')
  })

  it('says so when a question has no worked solution, rather than an empty gap', async () => {
    expect(await docXml(mcqExam())).toContain('No worked solution recorded')
  })

  it('typesets maths inside a solution', async () => {
    // The solution on q1 carries two fractions; they must be equations, not text.
    const xml = await docXml(mcqExam())
    expect(xml).not.toContain('frac{x^2}')
  })
})

describe('examReportDocxFilename', () => {
  it('keeps a plain name readable', () => {
    expect(examReportDocxFilename('Maths Mock 1')).toBe('Maths_Mock_1_insights.docx')
  })

  it('collapses everything a filesystem would reject', () => {
    expect(examReportDocxFilename('Maths: Mock #1 / rev.2')).toBe('Maths_Mock_1_rev_2_insights.docx')
  })

  // 10 of 213 exams are Marathi/Hindi. Those get no Word export under D2, but a
  // filename must never be the reason a download fails.
  it('survives a non-Latin title', () => {
    const f = examReportDocxFilename('३. बेटा मी ऐकतो आहे')
    expect(f).toMatch(/^[A-Za-z0-9_-]*_?insights\.docx$/)
    expect(f.endsWith('_insights.docx')).toBe(true)
  })

  it('never produces a bare extension', () => {
    expect(examReportDocxFilename('')).toBe('exam_insights.docx')
  })
})
