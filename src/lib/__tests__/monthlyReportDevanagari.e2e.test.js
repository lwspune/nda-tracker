// End-to-end guard for the Devanagari fix, using the real August 2026 APJ 9th
// data that produced the garbled parent-facing report cards.
//
// Covers the whole contract in one place: the PDF must never carry a character
// its fonts cannot draw, and the Word file must carry the title as typed.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildMonthlyReportPdfBlob, conductBlocks } from '../monthlyReportPdf'
import { buildMonthlyReportDocxBlob, docxExamRows, hasNonLatinExamTitle } from '../monthlyReportDocx'
import { pdfSafeExamLabel, isWinAnsiSafe } from '../pdfSafeText'

// Aayush Bhujabal's real rows for 1 Jul – 29 Aug 2026.
const REPORT = {
  meta: { lwsId: 'LWS-444', name: 'Aayush Bhujabal', rangeLabel: '1 Jul - 29 Aug 2026' },
  examTable: [
    { examName: 'Unit Test 1: History & Pol Sci (9th)', subject: 'History', date: '2026-08-13', marks: 19, percentage: 95, attended: true, format: 'written' },
    { examName: '२. बिल्ली का बिलुंगडा', subject: 'Hindi',   date: '2026-08-24', marks: 4, percentage: 80, attended: true, format: 'written' },
    { examName: '२.आ) संतकृपा झाली',    subject: 'Marathi', date: '2026-08-24', marks: 4, percentage: 80, attended: true, format: 'written' },
    { examName: '३. कबीर',              subject: 'Hindi',   date: '2026-08-28', marks: 3, percentage: 60, attended: true, format: 'written' },
    { examName: '३. बेटा मी ऐकतो आहे',   subject: 'Marathi', date: '2026-08-28', marks: 3, percentage: 60, attended: true, format: 'written' },
    // The one title in the batch with no leading chapter number.
    { examName: 'योगी सर्वकाळ सुखदाता',   subject: 'Marathi', date: '2026-08-26', marks: 4, percentage: 80, attended: true, format: 'written' },
  ],
  // The APJ 9th batch has no attendance rows at all, so the attendance block
  // is omitted — deliberately, since that gap is internal and this card goes
  // to parents.
  attendance: {
    present: 0, absent: 0, late: 0, missedLectures: 5, totalWorkingDays: 0,
    attendancePercentage: 0, lateDates: [],
    missedLectureDetails: [
      { date: '23 Jul', subject: 'Marathi' }, { date: '29 Jul', subject: 'Marathi' },
      { date: '24 Aug', subject: 'Hindi' },   { date: '26 Aug', subject: 'Hindi' },
      { date: '27 Aug', subject: 'Marathi' },
    ],
  },
  homeworkFlagged: [],
  subjectSummary: [], weakestChapter: null, nextMonthFocus: null,
}

describe('Devanagari report cards — end to end', () => {
  it('every label the PDF prints is drawable by its WinAnsi fonts', () => {
    for (const row of REPORT.examTable) {
      const label = pdfSafeExamLabel({ name: row.examName, subject: row.subject })
      expect(isWinAnsiSafe(label), `unprintable label for ${row.examName}`).toBe(true)
    }
  })

  it('substitutes subject + chapter number, falling back to subject alone', () => {
    const labels = REPORT.examTable.map(r => pdfSafeExamLabel({ name: r.examName, subject: r.subject }))
    expect(labels).toEqual([
      'Unit Test 1: History & Pol Sci (9th)',   // Latin — untouched
      'Hindi — Ch. 2',
      'Marathi — Ch. 2',
      'Hindi — Ch. 3',
      'Marathi — Ch. 3',
      'Marathi',                                 // no chapter number in the title
    ])
  })

  it('the PDF still builds and is a real PDF', async () => {
    const blob = await buildMonthlyReportPdfBlob(REPORT, { remark: '' })
    const head = await blob.text()
    expect(head.startsWith('%PDF')).toBe(true)
  })

  it('the Word file carries every Devanagari title exactly as typed', async () => {
    const blob = await buildMonthlyReportDocxBlob(REPORT, { remark: '' })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml').async('string')

    const devanagari = REPORT.examTable.filter(r => !isWinAnsiSafe(r.examName))
    expect(devanagari).toHaveLength(5)
    for (const row of devanagari) {
      expect(xml, `missing ${row.examName}`).toContain(row.examName)
    }

    // The Latin row is there too, but XML-escaped — `&` becomes `&amp;`.
    expect(xml).toContain('Unit Test 1: History &amp; Pol Sci (9th) (Written)')
  })

  it('flags the report as containing titles the PDF cannot print', () => {
    expect(hasNonLatinExamTitle(REPORT)).toBe(true)
  })

  // The APJ 9th batch has no register at all. That is an internal gap, and this
  // card goes to parents, so the block is omitted rather than stating it.
  it('omits the attendance block when there is no register', () => {
    expect(conductBlocks(REPORT).find(b => b.label === 'ATTENDANCE')).toBeUndefined()
  })

  it('both formats agree on marks, dates and percentages', async () => {
    const rows = docxExamRows(REPORT)
    expect(rows.map(r => r.marks)).toEqual(['19', '4', '4', '3', '3', '4'])
    expect(rows.map(r => r.percentage)).toEqual(['95%', '80%', '80%', '60%', '60%', '80%'])
    expect(rows[0].date).toBe('13th Aug 2026')
  })
})
