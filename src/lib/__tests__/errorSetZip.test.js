// Bulk-download path for Error Sets. Structure only — the layout of each
// document is covered by gatErrorSetDocx.test.js.
//
// Progress reporting is tested because it is load-bearing here in a way it is
// not for monthly reports: an error-set document runs to hundreds of questions
// with rendered equations, so a cohort build takes minutes. A plain spinner
// would be indistinguishable from a hang.

import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
import {
  buildErrorSetsZipBlob,
  errorSetsZipFilename,
} from '../errorSetZip'

const subjects = [{
  subject: 'Maths',
  counts: { wrong: 1, skipped: 0, absent: 0 },
  chapters: [{
    chapter: 'Vectors',
    counts: { wrong: 1, skipped: 0, absent: 0 },
    questions: [{
      n: 1, bucket: 'wrong', difficulty: '', q: 7, repeats: [],
      showContext: false, context: '',
      subject: 'Maths', chapter: 'Vectors', subtopic: 'Dot Product and Angle',
      question: 'The angle between two vectors is',
      options: ['0', '30', '60', '90'],
      answer: 'C', solution: 'Use the dot product identity throughout.',
      examName: 'Maths Mock 7', examDate: '2026-09-07',
    }],
  }],
}]

const totals = {
  questions: 1, available: 1, counts: { wrong: 1, skipped: 0, absent: 0 },
  droppedNoText: 0, missingSolution: 0, repeats: 0, exams: 1,
}

const item = (studentName, filename) => ({
  studentName, subject: 'Maths', subjects, totals, meta: {}, filename,
})

describe('buildErrorSetsZipBlob', () => {
  it('writes one real Word file per student', async () => {
    const blob = await buildErrorSetsZipBlob([
      item('Aarav Kulkarni', 'Aarav_Kulkarni_Errors.docx'),
      item('Riya Deshpande', 'Riya_Deshpande_Errors.docx'),
    ])
    const zip = await JSZip.loadAsync(blob)
    expect(Object.keys(zip.files).sort())
      .toEqual(['Aarav_Kulkarni_Errors.docx', 'Riya_Deshpande_Errors.docx'])
    const inner = await JSZip.loadAsync(
      await zip.file('Aarav_Kulkarni_Errors.docx').async('arraybuffer'))
    expect(Object.keys(inner.files)).toContain('word/document.xml')
  })

  it('reports progress per student so a multi-minute build is legible', async () => {
    const onProgress = vi.fn()
    await buildErrorSetsZipBlob([
      item('Aarav Kulkarni', 'a.docx'),
      item('Riya Deshpande', 'b.docx'),
    ], { onProgress })
    const calls = onProgress.mock.calls.map(([p]) => p)
    expect(calls.at(-1)).toMatchObject({ done: 2, total: 2 })
    expect(calls.some(c => c.studentName === 'Riya Deshpande')).toBe(true)
  })

  it('passes includeSolutions through to every document', async () => {
    const blob = await buildErrorSetsZipBlob([item('Aarav Kulkarni', 'a.docx')],
      { includeSolutions: false })
    const zip = await JSZip.loadAsync(blob)
    const inner = await JSZip.loadAsync(await zip.file('a.docx').async('arraybuffer'))
    const xml = await inner.file('word/document.xml').async('text')
    expect(xml).not.toContain('Use the dot product identity throughout.')
    expect(xml).toContain('The angle between two vectors is')
  })

  it('returns an empty archive for no items rather than throwing', async () => {
    const blob = await buildErrorSetsZipBlob([])
    const zip = await JSZip.loadAsync(blob)
    expect(Object.keys(zip.files)).toEqual([])
  })
})

describe('errorSetsZipFilename', () => {
  it('names the archive after the batch and range', () => {
    expect(errorSetsZipFilename('LWS_NDA_2Y_(25-27)_A', 'Aug 2026'))
      .toBe('LWS_NDA_2Y_25-27_A_Aug_2026_ErrorSets.zip')
  })
})
