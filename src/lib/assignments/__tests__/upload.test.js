import { describe, it, expect } from 'vitest'
import {
  ALLOWED_TYPES, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES,
  validateUploadFiles, assignmentFilePath, submissionFilePath, isQuestionFilePath,
} from '../upload'

const jpg = (size = 1000) => ({ type: 'image/jpeg', size })

describe('validateUploadFiles', () => {
  it('accepts photos and PDFs and returns each with its extension', () => {
    const r = validateUploadFiles([jpg(), { type: 'application/pdf', size: 5000 }])
    expect(r).toEqual({
      ok: true,
      files: [
        { type: 'image/jpeg', size: 1000, ext: 'jpg' },
        { type: 'application/pdf', size: 5000, ext: 'pdf' },
      ],
    })
  })

  it('refuses an empty list', () => {
    expect(validateUploadFiles([])).toMatchObject({ ok: false })
    expect(validateUploadFiles(undefined)).toMatchObject({ ok: false })
  })

  it('refuses more than MAX_FILES files', () => {
    const r = validateUploadFiles(Array.from({ length: MAX_FILES + 1 }, () => jpg()))
    expect(r.ok).toBe(false)
  })

  // HEIC is what an iPhone shoots; the grader cannot read it. The browser's file
  // picker converts it to JPEG on upload, so refusing it here costs nothing.
  it('refuses a type the grader cannot read', () => {
    expect(validateUploadFiles([{ type: 'image/heic', size: 10 }]).ok).toBe(false)
    expect(validateUploadFiles([{ type: 'text/html', size: 10 }]).ok).toBe(false)
  })

  it('refuses an empty file and a non-integer size', () => {
    expect(validateUploadFiles([jpg(0)]).ok).toBe(false)
    expect(validateUploadFiles([jpg(1.5)]).ok).toBe(false)
    expect(validateUploadFiles([{ type: 'image/jpeg' }]).ok).toBe(false)
  })

  it('refuses one file over the per-file limit', () => {
    expect(validateUploadFiles([jpg(MAX_FILE_BYTES + 1)]).ok).toBe(false)
    expect(validateUploadFiles([jpg(MAX_FILE_BYTES)]).ok).toBe(true)
  })

  it('refuses files that add up to more than the total limit', () => {
    const n = Math.ceil(MAX_TOTAL_BYTES / MAX_FILE_BYTES) + 1
    expect(n).toBeLessThanOrEqual(MAX_FILES)
    expect(validateUploadFiles(Array.from({ length: n }, () => jpg(MAX_FILE_BYTES))).ok).toBe(false)
  })

  it('every allowed type maps to an extension', () => {
    for (const ext of Object.values(ALLOWED_TYPES)) expect(ext).toMatch(/^[a-z]+$/)
  })
})

describe('storage paths', () => {
  const A = '11111111-1111-1111-1111-111111111111'
  const S = '22222222-2222-2222-2222-222222222222'

  it('numbers files from 01 in upload order, which is the page order the grader reads', () => {
    expect(submissionFilePath(A, 'LWS-12', S, 0, 'jpg')).toBe(`${A}/LWS-12/${S}/01.jpg`)
    expect(submissionFilePath(A, 'LWS-12', S, 10, 'pdf')).toBe(`${A}/LWS-12/${S}/11.pdf`)
  })

  it('keeps questions and the answer key in separate folders', () => {
    expect(assignmentFilePath(A, 'question', 0, 'pdf')).toBe(`${A}/questions/01.pdf`)
    expect(assignmentFilePath(A, 'key', 1, 'png')).toBe(`${A}/key/02.png`)
    expect(() => assignmentFilePath(A, 'other', 0, 'pdf')).toThrow()
  })

  // The student endpoint signs a download link only for a path this accepts, so
  // an answer-key path that ends up in question_files by mistake still never
  // reaches a student.
  it('recognises a question file only inside its own assignment\'s questions folder', () => {
    expect(isQuestionFilePath(A, `${A}/questions/01.pdf`)).toBe(true)
    expect(isQuestionFilePath(A, `${A}/key/01.pdf`)).toBe(false)
    expect(isQuestionFilePath(A, `${S}/questions/01.pdf`)).toBe(false)
    expect(isQuestionFilePath(A, `${A}/questions/../key/01.pdf`)).toBe(false)
    expect(isQuestionFilePath(A, `${A}/questions/sub/01.pdf`)).toBe(false)
    expect(isQuestionFilePath(A, null)).toBe(false)
  })
})
