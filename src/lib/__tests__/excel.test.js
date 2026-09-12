import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { detectSubjectFromName, parseExcelFull, parseTagsFile } from '../excel'

// Build a synthetic results xlsx as a File, mirroring the Evalbee export shape.
// `keys` is { qNum: 'A'|'B'|... } for the Q N Key column. Pass null to omit Key columns.
// `students` (optional) builds multiple rows: [{ name, total, opts, marks }].
// Omitted, it keeps the original single "Alice" row so existing tests are unchanged.
function buildResultsFile({ examName = 'Test Exam', totalQs = 3, keys = {}, opts = {}, marks = {}, includeKeyColumns = true, fileName = 'Test Exam_2026-05-09.xlsx', students = null } = {}) {
  const headers = ['Exam', 'Roll No', 'Name', 'Total Marks', 'Correct Answers', 'Incorrect Answers', 'Not attempted']
  for (let q = 1; q <= totalQs; q++) {
    headers.push(`Q ${q} Options`)
    if (includeKeyColumns) headers.push(`Q ${q} Key`)
    headers.push(`Q ${q} Marks`)
  }
  const buildRow = (name, roll, total, rowOpts, rowMarks) => {
    const row = [examName, roll, name, total, 2, 1, 0]
    for (let q = 1; q <= totalQs; q++) {
      row.push(rowOpts[q] ?? 'A')
      if (includeKeyColumns) row.push(keys[q] ?? '')
      row.push(rowMarks[q] ?? 2.5)
    }
    return row
  }
  const dataRows = students
    ? students.map((s, i) =>
        buildRow(s.name, String(i + 1).padStart(5, '0'), s.total, s.opts ?? opts, s.marks ?? marks))
    : [buildRow('Alice', '00001', 10, opts, marks)]
  // Pad first row (titled header) to match width — mirrors real export.
  const titleRow = headers.map((_, i) => String(i))
  const aoa = [titleRow, headers, ...dataRows]
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

// An Evalbee export carries NO date column and no workbook properties — the only
// date it ships is in the FILENAME (`<Exam Name>_YYYY-MM-DD.xlsx`), and that is the
// conduct date. `examDateFromFile` reports it as a fact, distinguishing "the name
// carries no date" from a real answer; `examDate` keeps its today-fallback so the
// upload wizard is untouched. See RESULTS_REUPLOAD.md §2.1.
describe('parseExcelFull — examDateFromFile', () => {
  it('reports the filename date, and examDate still carries the same value', async () => {
    const file = buildResultsFile({ fileName: 'Cloud Test 1_2026-02-05.xlsx' })
    const out = await parseExcelFull(file)
    expect(out.examDateFromFile).toBe('2026-02-05')
    expect(out.examDate).toBe('2026-02-05')
  })

  it('reports null when the filename carries no date — never today', async () => {
    const file = buildResultsFile({ fileName: 'results.xlsx' })
    const out = await parseExcelFull(file)
    expect(out.examDateFromFile).toBeNull()
    // examDate is deliberately unchanged: it still falls back to today so the
    // wizard behaves exactly as before. The distinction lives in the new field.
    expect(out.examDate).toBe(new Date().toISOString().split('T')[0])
  })
})

// The marking scheme is READ OFF the sheet, not inferred: across 210 real exports
// every one used exactly one positive and at most one negative per-question mark
// value. `markValues` reports them so a consumer can verify that, rather than
// trusting max/min blindly. See RESULTS_REUPLOAD.md §2.2.
describe('parseExcelFull — markValues', () => {
  it('returns the distinct per-question mark values, ascending', async () => {
    const file = buildResultsFile({ totalQs: 3, marks: { 1: 4, 2: -0.83, 3: 0 } })
    const out = await parseExcelFull(file)
    expect(out.markValues).toEqual([-0.83, 0, 4])
  })

  it('dedupes across students and questions', async () => {
    const file = buildResultsFile({
      totalQs: 2,
      students: [
        { name: 'Alice', total: 8, marks: { 1: 4, 2: 4 } },
        { name: 'Bob',   total: 4, marks: { 1: 4, 2: 0 } },
      ],
    })
    const out = await parseExcelFull(file)
    expect(out.markValues).toEqual([0, 4])
  })
})

// Sum identity: across all 210 real exports, the per-question marks summed to the
// Total Marks column for EVERY student, without exception. A failure therefore
// means a genuinely broken sheet. Note this deliberately does NOT use the
// Correct/Incorrect count columns, which are unreliable — see RESULTS_REUPLOAD.md §2.3.
describe('parseExcelFull — totalsReconcile', () => {
  it('reports every student reconciling when Σ(Q N Marks) equals Total Marks', async () => {
    const file = buildResultsFile({
      totalQs: 2,
      students: [
        { name: 'Alice', total: 8,    marks: { 1: 4, 2: 4 } },
        { name: 'Bob',   total: 3.17, marks: { 1: 4, 2: -0.83 } },
      ],
    })
    const out = await parseExcelFull(file)
    expect(out.totalsReconcile.checked).toBe(2)
    expect(out.totalsReconcile.ok).toBe(2)
    expect(out.totalsReconcile.failed).toEqual([])
  })

  it('names a student whose Total Marks disagrees, with both numbers', async () => {
    const file = buildResultsFile({
      totalQs: 2,
      students: [
        { name: 'Alice', total: 8,  marks: { 1: 4, 2: 4 } },
        { name: 'Bob',   total: 99, marks: { 1: 4, 2: 0 } },
      ],
    })
    const out = await parseExcelFull(file)
    expect(out.totalsReconcile.ok).toBe(1)
    expect(out.totalsReconcile.failed).toEqual([
      { name: 'Bob', sheetTotal: 99, sumOfMarks: 4 },
    ])
  })

  it('tolerates floating-point noise rather than reporting a false mismatch', async () => {
    // 3 × -0.83 = -2.4899999999999998 in IEEE754; the sheet rounds to -2.49.
    const file = buildResultsFile({
      totalQs: 3,
      students: [{ name: 'Alice', total: -2.49, marks: { 1: -0.83, 2: -0.83, 3: -0.83 } }],
    })
    const out = await parseExcelFull(file)
    expect(out.totalsReconcile.ok).toBe(1)
  })

  it('caps the failed list so a wholly broken sheet cannot flood the UI', async () => {
    const students = Array.from({ length: 9 }, (_, i) => ({
      name: `S${i}`, total: 99, marks: { 1: 4, 2: 4 },
    }))
    const file = buildResultsFile({ totalQs: 2, students })
    const out = await parseExcelFull(file)
    expect(out.totalsReconcile.checked).toBe(9)
    expect(out.totalsReconcile.ok).toBe(0)
    expect(out.totalsReconcile.failed).toHaveLength(5)
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

describe('parseTagsFile — QuestionId column (PYQ Vault provenance)', () => {
  const WITH_ID = ['Q', 'Subject', 'Chapter', 'Subtopic', 'Question', 'Answer', 'QuestionId']

  it('parses QuestionId into the tag', async () => {
    const file = buildTagsFile(WITH_ID, [
      [1, 'Maths', 'Vectors', 'Dot Product', 'find a.b', 'B', '7f3c1e2a-0000-4000-8000-000000000001'],
    ])
    const [tag] = await parseTagsFile(file)
    expect(tag.questionId).toBe('7f3c1e2a-0000-4000-8000-000000000001')
  })

  it('does not confuse QuestionId with the Q or Question columns', async () => {
    const file = buildTagsFile(WITH_ID, [
      [4, 'Maths', 'Vectors', 'Dot Product', 'find a.b', 'B', 'uuid-4'],
    ])
    const [tag] = await parseTagsFile(file)
    expect(tag.q).toBe(4)               // the printed number, not the uuid
    expect(tag.question).toBe('find a.b') // the stem, not the uuid
    expect(tag.questionId).toBe('uuid-4')
  })

  it('accepts the Question_Id / PyqId header spellings', async () => {
    const a = await parseTagsFile(buildTagsFile(['Q', 'Chapter', 'Question_Id'], [[1, 'Vectors', 'uuid-a']]))
    const b = await parseTagsFile(buildTagsFile(['Q', 'Chapter', 'PyqId'], [[1, 'Vectors', 'uuid-b']]))
    expect(a[0].questionId).toBe('uuid-a')
    expect(b[0].questionId).toBe('uuid-b')
  })

  it('returns null when the column is absent (hand-typed / historical sheets)', async () => {
    const file = buildTagsFile(['Q', 'Chapter', 'Subtopic'], [[1, 'Probability', 'Classical']])
    const [tag] = await parseTagsFile(file)
    expect(tag.questionId).toBeNull()
  })
})
