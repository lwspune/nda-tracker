// Smoke tests only — PDF layout is visual and reviewed out of band.
// These assert that the function returns a non-empty Blob and doesn't throw
// on the realistic input shapes (empty report, full report with all sections).

import { describe, it, expect } from 'vitest'
import { downloadMonthlyReportPdf, buildMonthlyReportPdfBlob, attendanceDescriptor } from '../monthlyReportPdf'

function sampleReport(over = {}) {
  return {
    meta: {
      lwsId: 'LWS-001',
      name: 'Aksheet Patil',
      branch: 'LWS Pune',
      batch: 'LWS_NDA_2Y_(26-28)_A',
      month: '2026-01',
      monthLabel: 'Jan 2026',
    },
    examTable: [
      { examName: 'Geog - Atmospheric Belts', subject: 'Geog',    date: '2026-01-03', marks: 216, percentage: 68, attended: true },
      { examName: 'Maths - Circle',           subject: 'Maths',   date: '2026-01-09', marks: null, percentage: null, attended: false },
      { examName: 'Maths - Binomial Theorem', subject: 'Maths',   date: '2026-01-16', marks: 17,  percentage: 57, attended: true },
      { examName: 'Physics - Properties',     subject: 'Physics', date: '2026-01-17', marks: 12,  percentage: 40, attended: true },
    ],
    attendance: {
      present: 22, absent: 1, late: 3, missedLectures: 2,
      totalWorkingDays: 26,
      attendancePercentage: 96,
      lateDates: ['3 Jan', '12 Jan', '20 Jan'],
      missedLectureDetails: [
        { date: '5 Jan', subject: 'Physics' },
        { date: '12 Jan', subject: 'Maths' },
      ],
    },
    nextMonthFocus: {
      monthLabel: 'Feb 2026',
      chapters: [
        { subject: 'Maths',   chapter: 'Limits' },
        { subject: 'Physics', chapter: 'Optics' },
      ],
    },
    ...over,
  }
}

describe('buildMonthlyReportPdfBlob — smoke', () => {
  it('returns a non-empty Blob for a fully-populated report', async () => {
    const blob = await buildMonthlyReportPdfBlob(sampleReport(), { remark: 'Strong start; focus on conics in February.' })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(1000)   // a real PDF is at least a few KB
  })

  it('renders an empty-month report (no exams, no attendance) without throwing', async () => {
    const empty = sampleReport({
      examTable: [],
      attendance: { present: 0, absent: 0, late: 0, missedLectures: 0, totalWorkingDays: 0, attendancePercentage: 0, lateDates: [], missedLectureDetails: [] },
      nextMonthFocus: null,
    })
    const blob = await buildMonthlyReportPdfBlob(empty, { remark: '' })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(800)
  })

  it('omits the remark section when remark is empty', async () => {
    const blob = await buildMonthlyReportPdfBlob(sampleReport(), { remark: '' })
    expect(blob.size).toBeGreaterThan(800)
  })

  it('handles an exam table with all ABSENT rows', async () => {
    const allAbsent = sampleReport({
      examTable: [
        { examName: 'Maths', subject: 'Maths', date: '2026-01-09', marks: null, percentage: null, attended: false },
        { examName: 'Physics', subject: 'Physics', date: '2026-01-16', marks: null, percentage: null, attended: false },
      ],
    })
    const blob = await buildMonthlyReportPdfBlob(allAbsent, { remark: '' })
    expect(blob.size).toBeGreaterThan(800)
  })
})

describe('attendanceDescriptor', () => {
  it('includes every segment when all four counts are non-zero', () => {
    expect(attendanceDescriptor({ present: 22, absent: 1, late: 3, missedLectures: 2 }))
      .toBe('22 present \xB7 1 absent \xB7 3 late \xB7 2 missed lectures')
  })

  it('omits absent/late/missed segments when zero, keeps present', () => {
    expect(attendanceDescriptor({ present: 22, absent: 0, late: 0, missedLectures: 0 }))
      .toBe('22 present')
  })

  it('only includes the segments that are non-zero (sparse mix)', () => {
    expect(attendanceDescriptor({ present: 20, absent: 2, late: 0, missedLectures: 1 }))
      .toBe('20 present \xB7 2 absent \xB7 1 missed lecture')
  })

  it("uses singular 'missed lecture' when count is 1", () => {
    expect(attendanceDescriptor({ present: 22, absent: 0, late: 0, missedLectures: 1 }))
      .toBe('22 present \xB7 1 missed lecture')
  })

  it("shows '0 present' when there are no working days (the row never reads empty)", () => {
    expect(attendanceDescriptor({ present: 0, absent: 0, late: 0, missedLectures: 0 }))
      .toBe('0 present')
  })
})

describe('downloadMonthlyReportPdf — file-name shape', () => {
  it('returns the filename used when saving', async () => {
    const filename = await downloadMonthlyReportPdf(sampleReport(), { remark: '', save: false })
    expect(filename).toBe('Aksheet_Patil_Jan_2026_Report.pdf')
  })
})

describe('PDF smoke — Roll No removed', () => {
  it('renders cleanly even though the report has no rollNo field', async () => {
    const noRoll = sampleReport({ meta: { ...sampleReport().meta, rollNo: undefined } })
    const blob = await buildMonthlyReportPdfBlob(noRoll, { remark: '' })
    expect(blob.size).toBeGreaterThan(800)
  })
})
