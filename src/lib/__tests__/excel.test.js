import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { detectSubjectFromName, parseExcelFull, parseTagsFile } from '../excel'

// Build a synthetic results xlsx as a File, mirroring the Evalbee export shape.
// `keys` is { qNum: 'A'|'B'|... } for the Q N Key column. Pass null to omit Key columns.
function buildResultsFile({ examName = 'Test Exam', totalQs = 3, keys = {}, opts = {}, marks = {}, includeKeyColumns = true, fileName = 'Test Exam_2026-05-09.xlsx' } = {}) {
  const headers = ['Exam', 'Roll No', 'Name', 'Total Marks', 'Correct Answers', 'Incorrect Answers', 'Not attempted']
  for (let q = 1; q <= totalQs; q++) {
    headers.push(`Q ${q} Options`)
    if (includeKeyColumns) headers.push(`Q ${q} Key`)
    headers.push(`Q ${q} Marks`)
  }
  const row1 = [examName, '00001', 'Alice', 10, 2, 1, 0]
  for (let q = 1; q <= totalQs; q++) {
    row1.push(opts[q] ?? 'A')
    if (includeKeyColumns) row1.push(keys[q] ?? '')
    row1.push(marks[q] ?? 2.5)
  }
  // Pad first row (titled header) to match width — mirrors real export.
  const titleRow = headers.map((_, i) => String(i))
  const aoa = [titleRow, headers, row1]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Regression: "NDA Maths Mock 2" was being saved with subject = "2"
// because the old logic stripped subject keywords and kept the leftover.
// detectSubjectFromName must detect the subject by *presence*, not by stripping.

describe('detectSubjectFromName', () => {
  it('returns Maths when the name contains "Maths"', () => {
    expect(detectSubjectFromName('NDA Maths Mock 2')).toBe('Maths')
    expect(detectSubjectFromName('Maths Test 3')).toBe('Maths')
    expect(detectSubjectFromName('NDA Maths Mock 5')).toBe('Maths')
  })

  it('returns Maths when the name contains "Math" (singular)', () => {
    expect(detectSubjectFromName('NDA Math Quiz')).toBe('Maths')
  })

  it('returns GAT when the name contains "GAT"', () => {
    expect(detectSubjectFromName('GAT Mock 1')).toBe('GAT')
    expect(detectSubjectFromName('NDA GAT 2')).toBe('GAT')
    expect(detectSubjectFromName('gat combined mock')).toBe('GAT')
  })

  it('does not match "math" inside an unrelated word', () => {
    // Defensive: "format" contains "mat" but not "\bmath\b"
    expect(detectSubjectFromName('Format Test 1')).toBe('Maths')  // falls through to default
  })

  it('defaults to Maths when no subject keyword is present', () => {
    expect(detectSubjectFromName('Random Exam')).toBe('Maths')
    expect(detectSubjectFromName('')).toBe('Maths')
    expect(detectSubjectFromName(undefined)).toBe('Maths')
    expect(detectSubjectFromName(null)).toBe('Maths')
  })

  it('regression — "NDA Maths Mock 2" must never resolve to "2"', () => {
    expect(detectSubjectFromName('NDA Maths Mock 2')).not.toBe('2')
    expect(detectSubjectFromName('NDA Maths Mock 5')).not.toBe('5')
  })
})

describe('parseExcelFull — Q N Key extraction', () => {
  it('returns answerKeys keyed by question number, uppercased', async () => {
    const file = buildResultsFile({ totalQs: 3, keys: { 1: 'A', 2: 'B', 3: 'C' } })
    const out = await parseExcelFull(file)
    expect(out.answerKeys).toEqual({ 1: 'A', 2: 'B', 3: 'C' })
  })

  it('normalises lowercase / whitespace key cells to single uppercase letter', async () => {
    const file = buildResultsFile({ totalQs: 3, keys: { 1: 'd', 2: ' b ', 3: 'c' } })
    const out = await parseExcelFull(file)
    expect(out.answerKeys).toEqual({ 1: 'D', 2: 'B', 3: 'C' })
  })

  it('omits questions whose Key cell is blank', async () => {
    const file = buildResultsFile({ totalQs: 3, keys: { 1: 'A', 3: 'C' } })   // Q2 blank
    const out = await parseExcelFull(file)
    expect(out.answerKeys).toEqual({ 1: 'A', 3: 'C' })
  })

  it('returns empty answerKeys when no Q N Key columns are present (older export)', async () => {
    const file = buildResultsFile({ totalQs: 2, includeKeyColumns: false })
    const out = await parseExcelFull(file)
    expect(out.answerKeys).toEqual({})
  })

  it('rejects values that are not A/B/C/D (drops them rather than persisting garbage)', async () => {
    const file = buildResultsFile({ totalQs: 3, keys: { 1: 'A', 2: 'X', 3: '12' } })
    const out = await parseExcelFull(file)
    expect(out.answerKeys).toEqual({ 1: 'A' })
  })
})

describe('parseExcelFull — choice capture (for re-gradeability)', () => {
  it("captures each student's chosen option letter per question", async () => {
    const file = buildResultsFile({ totalQs: 3, opts: { 1: 'A', 2: 'B', 3: 'C' } })
    const out = await parseExcelFull(file)
    expect(out.students[0].choices).toEqual({ 1: 'A', 2: 'B', 3: 'C' })
  })

  it('stores null for a blank (unattempted) option, and the verdict stays 0', async () => {
    const file = buildResultsFile({ totalQs: 3, opts: { 1: 'A', 2: '', 3: 'C' }, marks: { 1: 2.5, 2: 0, 3: 2.5 } })
    const out = await parseExcelFull(file)
    expect(out.students[0].choices).toEqual({ 1: 'A', 2: null, 3: 'C' })
    expect(out.students[0].responses[2]).toBe(0)
  })

  it('uppercases lowercase choice letters', async () => {
    const file = buildResultsFile({ totalQs: 2, opts: { 1: 'a', 2: 'd' } })
    const out = await parseExcelFull(file)
    expect(out.students[0].choices).toEqual({ 1: 'A', 2: 'D' })
  })

  it('leaves responses (the 1/-1/0 verdict) unchanged — choice capture is purely additive', async () => {
    const file = buildResultsFile({ totalQs: 2, opts: { 1: 'A', 2: 'B' }, marks: { 1: 2.5, 2: -0.83 } })
    const out = await parseExcelFull(file)
    expect(out.students[0].responses).toEqual({ 1: 1, 2: -1 })   // by Evalbee mark sign
    expect(out.students[0].choices).toEqual({ 1: 'A', 2: 'B' })
  })
})

// Build a synthetic tags xlsx as a File. `headers` is the header row, `rows`
// the data rows (each an array aligned to headers).
function buildTagsFile(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tags')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buf], 'tags.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

describe('parseTagsFile — Context / Passage column', () => {
  const ENRICHED = ['Q', 'Subject', 'Chapter', 'Subtopic', 'Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'Answer', 'Solution', 'Difficulty', 'Context']

  it('parses the Context column into tag.context', async () => {
    const file = buildTagsFile(ENRICHED, [
      [1, 'English', 'Reading Comprehension', 'Inference', 'What does line 4 imply?', 'a', 'b', 'c', 'd', 'B', 'because', 'Moderate', 'Read the passage carefully.'],
    ])
    const tags = await parseTagsFile(file)
    expect(tags[0].context).toBe('Read the passage carefully.')
  })

  it('accepts "Passage" as an alias for the context column', async () => {
    const headers = ['Q', 'Chapter', 'Passage']
    const file = buildTagsFile(headers, [[1, 'Reading Comprehension', 'A long passage.']])
    const tags = await parseTagsFile(file)
    expect(tags[0].context).toBe('A long passage.')
  })

  it('returns null context when the column is absent (backward compatible)', async () => {
    const file = buildTagsFile(['Q', 'Chapter', 'Subtopic'], [[1, 'Probability', 'Classical']])
    const tags = await parseTagsFile(file)
    expect(tags[0].context).toBeNull()
  })

  it('parses the full enriched row (options/answer/difficulty/subject) alongside context', async () => {
    const file = buildTagsFile(ENRICHED, [
      [1, 'Maths', 'Statistics', 'Mean', 'find the mean', 'A-t', 'B-t', 'C-t', 'D-t', 'b', 'soln', 'Hard', ''],
    ])
    const [tag] = await parseTagsFile(file)
    expect(tag).toMatchObject({
      q: 1, subject: 'Maths', chapter: 'Statistics', subtopic: 'Mean',
      optionA: 'A-t', optionD: 'D-t', answer: 'B', difficulty: 'Hard',
    })
    expect(tag.context).toBeNull() // blank cell → null (cell() coalesces empty to null)
  })
})

describe('parseTagsFile — notes slug columns (remediation)', () => {
  const WITH_SLUGS = ['Q', 'Subject', 'Chapter', 'Subtopic', 'Answer', 'Context', 'SubtopicSlug', 'ConceptSlug']

  it('parses SubtopicSlug + ConceptSlug into the tag', async () => {
    const file = buildTagsFile(WITH_SLUGS, [
      [1, 'Maths', 'Vectors', 'Dot Product', 'B', '', 'vectors-dot-product', 'dot-product'],
    ])
    const [tag] = await parseTagsFile(file)
    expect(tag.subtopicSlug).toBe('vectors-dot-product')
    expect(tag.conceptSlug).toBe('dot-product')
  })

  it('does not confuse SubtopicSlug with the Subtopic column', async () => {
    const file = buildTagsFile(WITH_SLUGS, [
      [1, 'Maths', 'Vectors', 'Dot Product', 'B', '', 'vectors-dot-product', 'dot-product'],
    ])
    const [tag] = await parseTagsFile(file)
    expect(tag.subtopic).toBe('Dot Product')        // the name, not the slug
    expect(tag.subtopicSlug).toBe('vectors-dot-product')
  })

  it('returns null slugs when the columns are absent (untagged / backward compatible)', async () => {
    const file = buildTagsFile(['Q', 'Chapter', 'Subtopic'], [[1, 'Spotting Errors', 'Conditional Sentences']])
    const [tag] = await parseTagsFile(file)
    expect(tag.subtopicSlug).toBeNull()
    expect(tag.conceptSlug).toBeNull()
  })
})
