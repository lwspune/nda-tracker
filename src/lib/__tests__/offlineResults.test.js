import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseOfflineResults, buildOfflineTemplateRows } from '../excel'

// Build a synthetic "offline marks" xlsx as a File.
// `aoa` is the full sheet (array of arrays) so tests can shape headers freely.
function fileFromAoa(aoa, fileName = 'Offline Test.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

describe('parseOfflineResults', () => {
  it('parses Name + Marks into totals-only student rows', async () => {
    const file = fileFromAoa([
      ['Name', 'Marks'],
      ['Alice', 72],
      ['Bob', 55],
    ])
    const { students } = await parseOfflineResults(file)
    expect(students).toHaveLength(2)
    expect(students[0]).toEqual({
      name: 'Alice', rollNo: '', totalMarks: 72,
      correct: 0, incorrect: 0, notAttempted: 0, responses: {},
    })
    expect(students[1].name).toBe('Bob')
    expect(students[1].totalMarks).toBe(55)
  })

  it('accepts a Roll No column and alternate marks headers (Total Marks / Score)', async () => {
    const file = fileFromAoa([
      ['Roll No', 'Name', 'Score'],
      ['R1', 'Alice', 40],
    ])
    const { students } = await parseOfflineResults(file)
    expect(students[0].rollNo).toBe('R1')
    expect(students[0].totalMarks).toBe(40)
  })

  it('skips rows with a blank name or blank marks (absent / not entered)', async () => {
    const file = fileFromAoa([
      ['Name', 'Marks'],
      ['Alice', 72],
      ['', 50],        // no name
      ['Bob', ''],     // no marks
      ['Carol', 0],    // explicit zero IS a valid mark
    ])
    const { students } = await parseOfflineResults(file)
    expect(students.map(s => s.name)).toEqual(['Alice', 'Carol'])
    expect(students[1].totalMarks).toBe(0)
  })

  it('throws when the Name column is missing', async () => {
    const file = fileFromAoa([['Student', 'Marks'], ['Alice', 10]])
    await expect(parseOfflineResults(file)).rejects.toThrow(/name/i)
  })

  it('throws when the Marks column is missing', async () => {
    const file = fileFromAoa([['Name', 'Branch'], ['Alice', 'LWS']])
    await expect(parseOfflineResults(file)).rejects.toThrow(/marks/i)
  })

  it('trims whitespace and coerces numeric-looking marks', async () => {
    const file = fileFromAoa([['Name', 'Marks'], ['  Alice  ', '68.5']])
    const { students } = await parseOfflineResults(file)
    expect(students[0].name).toBe('Alice')
    expect(students[0].totalMarks).toBeCloseTo(68.5)
  })
})

describe('buildOfflineTemplateRows', () => {
  it('returns a header row + one example row', () => {
    const rows = buildOfflineTemplateRows()
    expect(rows[0]).toEqual(['Name', 'Marks'])
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })
})
