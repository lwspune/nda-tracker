import { describe, it, expect } from 'vitest'
import {
  docxExamRows, docxFilename, hasNonLatinExamTitle, buildMonthlyReportDocxBlob,
} from '../monthlyReportDocx'
import { conductBlocks } from '../monthlyReportPdf'

const report = (over = {}) => ({
  meta: { name: 'Aayush Bhujabal', rangeLabel: '1 Jul - 29 Aug 2026' },
  attendance: {
    present: 0, absent: 0, late: 0, totalWorkingDays: 0,
    attendancePercentage: 0, lateDates: [], missedLectureDetails: [],
  },
  homeworkFlagged: [],
  examTable: [
    { examName: 'Unit Test 1: Maths - I (9th)', subject: 'Maths', date: '2026-08-10', marks: 16, percentage: 80, attended: true, format: 'written' },
    { examName: '२. बिल्ली का बिलुंगडा', subject: 'Hindi', date: '2026-08-24', marks: 4, percentage: 80, attended: true, format: 'written' },
  ],
  ...over,
})

describe('docxExamRows', () => {
  // The entire reason the Word export exists. jsPDF cannot draw this; Word can,
  // because a .docx stores text as UTF-8 and the reader's own Word shapes it.
  it('keeps the REAL Devanagari title — no English fallback', () => {
    const rows = docxExamRows(report())
    expect(rows[1].label).toBe('२. बिल्ली का बिलुंगडा (Written)')
  })

  it('renders Latin titles identically to the PDF', () => {
    const rows = docxExamRows(report())
    expect(rows[0].label).toBe('Unit Test 1: Maths - I (9th) (Written)')
  })

  it('labels an MCQ exam as MCQ', () => {
    const rows = docxExamRows(report({
      examTable: [{ examName: 'Mock 1', subject: 'Maths', date: '2026-08-10', marks: 90, percentage: 75, attended: true, format: 'mcq' }],
    }))
    expect(rows[0].label).toBe('Mock 1 (MCQ)')
  })

  it('formats the date the same way the PDF does', () => {
    expect(docxExamRows(report())[0].date).toBe('10th Aug 2026')
  })

  // Matches the PDF: an absentee shows ABSENT in both numeric columns, never 0,
  // so a no-show can't be read as a score of zero.
  it('shows ABSENT in both numeric columns for a missed exam', () => {
    const rows = docxExamRows(report({
      examTable: [{ examName: 'Sets', subject: 'Maths', date: '2026-07-27', marks: null, percentage: null, attended: false, format: 'written' }],
    }))
    expect(rows[0].marks).toBe('ABSENT')
    expect(rows[0].percentage).toBe('ABSENT')
  })

  it('colours the percentage on the same thresholds as the PDF', () => {
    const rows = docxExamRows(report({
      examTable: [
        { examName: 'A', subject: 'M', date: '2026-08-01', marks: 9, percentage: 90, attended: true, format: 'written' },
        { examName: 'B', subject: 'M', date: '2026-08-01', marks: 5, percentage: 50, attended: true, format: 'written' },
        { examName: 'C', subject: 'M', date: '2026-08-01', marks: 2, percentage: 20, attended: true, format: 'written' },
      ],
    }))
    expect(rows.map(r => r.color)).toEqual(['16A34A', 'CA8A04', 'DC2626'])
  })
})

describe('hasNonLatinExamTitle', () => {
  it('is true when any exam title is non-Latin', () => {
    expect(hasNonLatinExamTitle(report())).toBe(true)
  })

  it('is false for an all-Latin report', () => {
    expect(hasNonLatinExamTitle(report({
      examTable: [{ examName: 'Unit Test 1: Physics (11th)', subject: 'Physics', date: '2026-08-10', marks: 25, percentage: 100, attended: true, format: 'written' }],
    }))).toBe(false)
  })

  it('is false for an empty exam table', () => {
    expect(hasNonLatinExamTitle(report({ examTable: [] }))).toBe(false)
  })
})

describe('docxFilename', () => {
  it('mirrors the PDF name with a .docx extension', () => {
    expect(docxFilename('Aayush Bhujabal', '1 Jul - 29 Aug 2026'))
      .toBe('Aayush_Bhujabal_1_Jul_-_29_Aug_2026_Report.docx')
  })
})

describe('buildMonthlyReportDocxBlob — smoke', () => {
  it('produces a non-empty docx for a report containing Devanagari', async () => {
    const blob = await buildMonthlyReportDocxBlob(report(), { remark: 'Doing well.' })
    expect(blob.size).toBeGreaterThan(0)
  })

  // The conduct section is shared with the PDF so the two cannot drift.
  it('reuses conductBlocks, so the attendance line matches the PDF', () => {
    expect(conductBlocks(report())).toEqual([
      { label: 'ATTENDANCE', value: 'Not recorded for this period', muted: true },
    ])
  })
})
