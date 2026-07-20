// Smoke tests only — PDF layout is visual and reviewed out of band.
// These assert that the function returns a non-empty Blob and doesn't throw
// on the realistic input shapes (empty report, full report with all sections).

import { describe, it, expect } from 'vitest'
import { downloadMonthlyReportPdf, buildMonthlyReportPdfBlob, conductBlocks } from '../monthlyReportPdf'

function sampleReport(over = {}) {
  return {
    meta: {
      lwsId: 'LWS-001',
      name: 'Aksheet Patil',
      branch: 'LWS Pune',
      batch: 'LWS_NDA_2Y_(26-28)_A',
      from: '2026-01-01',
      to: '2026-01-31',
      rangeLabel: 'Jan 2026',
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

describe('conductBlocks — exception-only attendance / conduct section', () => {
  function att(over = {}) {
    return {
      present: 10, absent: 1, late: 0, missedLectures: 0,
      totalWorkingDays: 12, attendancePercentage: 92,
      lateDates: [], missedLectureDetails: [],
      ...over,
    }
  }
  const report = (attendance, homeworkFlagged = []) => ({ attendance, homeworkFlagged })

  it('shows the Attendance block as "(present+late) / total days present (pct%)"', () => {
    // present 10 + late 0 = 10 of 12
    const [block] = conductBlocks(report(att()))
    expect(block).toEqual({ label: 'ATTENDANCE', value: '10 / 12 days present (92%)' })
  })

  it('counts late days into the present numerator (they showed up, just late)', () => {
    const blocks = conductBlocks(report(att({ present: 8, late: 2, absent: 2, totalWorkingDays: 12, attendancePercentage: 83, lateDates: ['3 Jan', '12 Jan'] })))
    expect(blocks[0]).toEqual({ label: 'ATTENDANCE', value: '10 / 12 days present (83%)' })
  })

  it('OMITS the Attendance block entirely when there are no working days (0/0)', () => {
    const blocks = conductBlocks(report(att({ present: 0, absent: 0, late: 0, totalWorkingDays: 0, attendancePercentage: 0 })))
    expect(blocks.find(b => b.label === 'ATTENDANCE')).toBeUndefined()
  })

  it('OMITS the Late days block when there were zero late days, even with attendance data', () => {
    const blocks = conductBlocks(report(att({ late: 0, lateDates: [] })))
    expect(blocks.find(b => b.label.startsWith('LATE DAYS'))).toBeUndefined()
  })

  it('shows the Late days block with count in the header and the actual dates below', () => {
    const blocks = conductBlocks(report(att({ present: 8, late: 2, totalWorkingDays: 12, attendancePercentage: 83, lateDates: ['3 Jan', '12 Jan'] })))
    const late = blocks.find(b => b.label.startsWith('LATE DAYS'))
    expect(late).toEqual({ label: 'LATE DAYS (2)', value: '3 Jan, 12 Jan' })
  })

  it('OMITS Missed lectures when empty; shows count + "date subject" list when present', () => {
    expect(conductBlocks(report(att())).find(b => b.label.startsWith('MISSED LECTURES'))).toBeUndefined()
    const blocks = conductBlocks(report(att({
      missedLectures: 2,
      missedLectureDetails: [{ date: '5 Jan', subject: 'Physics' }, { date: '12 Jan', subject: 'Maths' }],
    })))
    const missed = blocks.find(b => b.label.startsWith('MISSED LECTURES'))
    expect(missed).toEqual({ label: 'MISSED LECTURES (2)', value: '5 Jan Physics, 12 Jan Maths' })
  })

  it('Homework incomplete counts ONLY unresolved items and lists them', () => {
    const hw = [
      { date: '12 Jun', subject: 'Physics', chapter: 'Laws', type: 'notes', resolved: false },
      { date: '4 Jun',  subject: 'Maths',   chapter: 'Stats', type: 'homework', resolved: true },  // resolved → excluded
    ]
    const blocks = conductBlocks(report(att(), hw))
    const homework = blocks.find(b => b.label.startsWith('HOMEWORK INCOMPLETE'))
    expect(homework).toEqual({ label: 'HOMEWORK INCOMPLETE (1)', value: '12 Jun - Physics \xB7 Laws' })
  })

  it('OMITS Homework incomplete when every flagged item is resolved', () => {
    const hw = [{ date: '4 Jun', subject: 'Maths', chapter: 'Stats', type: 'homework', resolved: true }]
    expect(conductBlocks(report(att(), hw)).find(b => b.label.startsWith('HOMEWORK INCOMPLETE'))).toBeUndefined()
  })

  it('returns blocks in order: Attendance, Late days, Missed lectures, Homework incomplete', () => {
    const hw = [{ date: '12 Jun', subject: 'Physics', chapter: 'Laws', type: 'notes', resolved: false }]
    const blocks = conductBlocks(report(att({
      present: 8, late: 2, totalWorkingDays: 12, attendancePercentage: 83,
      lateDates: ['3 Jan', '12 Jan'],
      missedLectures: 1, missedLectureDetails: [{ date: '5 Jan', subject: 'Physics' }],
    }), hw))
    expect(blocks.map(b => b.label)).toEqual([
      'ATTENDANCE', 'LATE DAYS (2)', 'MISSED LECTURES (1)', 'HOMEWORK INCOMPLETE (1)',
    ])
  })

  it('returns an empty array when nothing was recorded (no attendance, no exceptions)', () => {
    const blocks = conductBlocks(report(att({ present: 0, absent: 0, late: 0, totalWorkingDays: 0, attendancePercentage: 0 })))
    expect(blocks).toEqual([])
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
