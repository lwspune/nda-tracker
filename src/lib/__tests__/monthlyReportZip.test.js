// Smoke + structure tests for the bulk-download ZIP path.
// Verifies the produced Blob is a real ZIP and contains one entry per item
// with the expected filenames. Visual layout of each PDF is covered by
// monthlyReportPdf.test.js.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  buildMonthlyReportsZipBlob,
  downloadMonthlyReportsZip,
  zipFilename,
} from '../monthlyReportZip'

function sampleReport(name, rangeLabel = 'Jan 2026') {
  return {
    meta: { lwsId: 'LWS-X', name, rollNo: '1', branch: 'LWS Pune',
            batch: 'B', from: '2026-01-01', to: '2026-01-31', rangeLabel },
    examTable: [],
    attendance: { present: 0, absent: 0, late: 0, missedLectures: 0,
                  totalWorkingDays: 0, attendancePercentage: 0,
                  lateDates: [], missedLectureDetails: [] },
    subjectSummary: [],
    weakestChapter: null,
    nextMonthFocus: null,
  }
}

describe('buildMonthlyReportsZipBlob', () => {
  it('returns a non-empty Blob', async () => {
    const blob = await buildMonthlyReportsZipBlob([
      { report: sampleReport('Alice'), remark: '', filename: 'Alice.pdf' },
    ])
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(500)
  })

  it('contains one .pdf entry per input item, keyed by the supplied filename', async () => {
    const blob = await buildMonthlyReportsZipBlob([
      { report: sampleReport('Alice'), remark: '', filename: 'Alice_Report.pdf' },
      { report: sampleReport('Bob'),   remark: '', filename: 'Bob_Report.pdf' },
      { report: sampleReport('Cara'),  remark: '', filename: 'Cara_Report.pdf' },
    ])
    const zip = await JSZip.loadAsync(blob)
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['Alice_Report.pdf', 'Bob_Report.pdf', 'Cara_Report.pdf'])
  })

  it('each entry is a valid PDF (starts with %PDF magic bytes)', async () => {
    const blob = await buildMonthlyReportsZipBlob([
      { report: sampleReport('Alice'), remark: 'Hello', filename: 'Alice.pdf' },
    ])
    const zip = await JSZip.loadAsync(blob)
    const buffer = await zip.files['Alice.pdf'].async('uint8array')
    expect(buffer[0]).toBe(0x25) // %
    expect(buffer[1]).toBe(0x50) // P
    expect(buffer[2]).toBe(0x44) // D
    expect(buffer[3]).toBe(0x46) // F
  })

  it('returns an empty zip Blob when items list is empty', async () => {
    const blob = await buildMonthlyReportsZipBlob([])
    const zip = await JSZip.loadAsync(blob)
    expect(Object.keys(zip.files).length).toBe(0)
  })
})

describe('zipFilename', () => {
  it("composes a safe filename from batch + monthLabel ('{batch}_{Month}_Reports.zip')", () => {
    expect(zipFilename('LWS_NDA_2Y_(26-28)_A', 'Jan 2026'))
      .toBe('LWS_NDA_2Y_26-28_A_Jan_2026_Reports.zip')
  })

  it('sanitises unsafe filesystem characters', () => {
    expect(zipFilename('Foo / Bar', 'Jan 2026')).toBe('Foo_Bar_Jan_2026_Reports.zip')
  })
})

describe('downloadMonthlyReportsZip', () => {
  it('returns the filename used when saving (no save when save:false)', async () => {
    const filename = await downloadMonthlyReportsZip(
      [{ report: sampleReport('Alice'), remark: '', filename: 'Alice.pdf' }],
      'LWS_NDA_2Y_26-28_A_Jan_2026_Reports.zip',
      { save: false },
    )
    expect(filename).toBe('LWS_NDA_2Y_26-28_A_Jan_2026_Reports.zip')
  })
})
