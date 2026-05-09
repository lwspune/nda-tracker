import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { detectSubjectFromName, parseExcelFull } from '../excel'

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
