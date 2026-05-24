// Per-student monthly report card. Mirrors the existing examPdf.js style.
// Takes the sections object built by monthlyReportBuilder.js plus an optional
// transient remark. Async because jsPDF + autotable are dynamic imports
// (smaller initial bundle).

const C = {
  accent:   [37,  99, 235],
  ink:      [15,  23,  42],
  ink2:     [71,  85, 105],
  ink3:     [148, 163, 184],
  border:   [180, 180, 180],
  surface2: [241, 245, 249],
  success:  [22,  163, 74],
  warning:  [202, 138, 4],
  danger:   [220, 38,  38],
  white:    [255, 255, 255],
}

const M = { left: 18, right: 18, top: 16 }   // page margins (mm)

function safeFile(s) {
  return (s || 'student').replace(/[^A-Za-z0-9_-]+/g, '_')
}

function pctColor(p) {
  if (p == null) return C.ink2
  if (p >= 70) return C.success
  if (p >= 45) return C.warning
  return C.danger
}

function directionGlyph(d) {
  if (d === 'up')   return '↑'   // ↑
  if (d === 'down') return '↓'   // ↓
  if (d === 'flat') return '—'   // —
  return 'new'
}

// 'YYYY-MM-DD' → '3rd Jan 2026' to match the screenshot format
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function ordinal(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return n + 'th'
  switch (n % 10) {
    case 1: return n + 'st'
    case 2: return n + 'nd'
    case 3: return n + 'rd'
    default: return n + 'th'
  }
}
function prettyDate(iso) {
  if (!iso || typeof iso !== 'string') return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${ordinal(d)} ${SHORT_MONTHS[m - 1]} ${y}`
}

// ── Sections ────────────────────────────────────────────────────────────────

function drawHeader(doc, report) {
  const W = doc.internal.pageSize.getWidth()

  // Title
  doc.setTextColor(...C.ink)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  const title = 'REPORT CARD'
  doc.text(title, W / 2, M.top + 4, { align: 'center' })
  const titleWidth = doc.getTextWidth(title)
  doc.setDrawColor(...C.ink)
  doc.setLineWidth(0.4)
  doc.line(W / 2 - titleWidth / 2 - 2, M.top + 5.5, W / 2 + titleWidth / 2 + 2, M.top + 5.5)

  // LWS PUNE branding (top right)
  doc.setTextColor(...C.accent)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('LWS PUNE', W - M.right, M.top + 4, { align: 'right' })

  // Three-line meta block (left)
  const labelX = M.left
  const valueX = M.left + 30
  let y = M.top + 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C.ink2)
  doc.text('Name:', labelX, y)
  doc.text('Roll No:', labelX, y + 5)
  doc.text('Month:', labelX, y + 10)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.ink)
  doc.text(report.meta.name || '—', valueX, y)
  doc.text(String(report.meta.rollNo || '—'), valueX, y + 5)
  doc.text(report.meta.monthLabel || '', valueX, y + 10)

  return y + 16     // y position to continue from
}

async function drawExamTable(doc, y, report, autoTable) {
  if (report.examTable.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.ink2)
    doc.text('No exams taken this month.', M.left, y + 4)
    return y + 10
  }

  const rows = report.examTable.map(row => [
    row.examName,
    prettyDate(row.date),
    row.attended ? String(row.marks ?? '') : 'ABSENT',
    row.attended ? (row.percentage != null ? `${row.percentage}%` : '') : 'ABSENT',
  ])

  autoTable(doc, {
    startY: y,
    head: [['Subject', 'Date', 'Marks', 'Percentage']],
    body: rows,
    margin: { left: M.left, right: M.right },
    styles: { fontSize: 9, cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 } },
    headStyles: { fillColor: C.ink, textColor: C.white, fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 32 },
      2: { halign: 'right', cellWidth: 22 },
      3: { halign: 'right', cellWidth: 28 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const row = report.examTable[data.row.index]
      if (!row.attended && (data.column.index === 2 || data.column.index === 3)) {
        data.cell.styles.textColor = C.danger
        data.cell.styles.fontStyle = 'bold'
      } else if (data.column.index === 3 && row.attended) {
        data.cell.styles.textColor = pctColor(row.percentage)
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  return doc.lastAutoTable.finalY + 4
}

function drawAttendance(doc, y, report, autoTable) {
  const a = report.attendance
  const row = [
    `${a.present} present · ${a.absent} absent · ${a.late} late · ${a.missedLectures} missed lecture${a.missedLectures !== 1 ? 's' : ''}`,
    `${a.present + a.late} / ${a.totalWorkingDays}`,
    `${a.attendancePercentage}%`,
  ]

  autoTable(doc, {
    startY: y,
    head: [['Attendance', 'Days', 'Percentage']],
    body: [row],
    margin: { left: M.left, right: M.right },
    styles: { fontSize: 9, cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 } },
    headStyles: { fillColor: C.ink, textColor: C.white, fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 32 },
      2: { halign: 'right', cellWidth: 28 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        data.cell.styles.textColor = pctColor(report.attendance.attendancePercentage)
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  let nextY = doc.lastAutoTable.finalY + 3

  // Late + missed-lecture detail line (only when non-zero)
  if (a.lateDates.length || a.missedLectureDetails.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.ink2)
    if (a.lateDates.length) {
      doc.text(`Late: ${a.lateDates.join(', ')}`, M.left, nextY)
      nextY += 4
    }
    if (a.missedLectureDetails.length) {
      const msg = a.missedLectureDetails.map(r => `${r.date} ${r.subject}`).join(', ')
      doc.text(`Missed lectures: ${msg}`, M.left, nextY)
      nextY += 4
    }
  }

  return nextY + 2
}

function drawSubjectSummary(doc, y, report, autoTable) {
  if (report.subjectSummary.length === 0) return y

  const rows = report.subjectSummary.map(r => [
    r.subject,
    `${r.thisMonth}%`,
    r.lastMonth != null ? `${r.lastMonth}%` : '—',
    directionGlyph(r.direction),
  ])

  autoTable(doc, {
    startY: y,
    head: [['Subject', 'This month', 'Last month', 'Trend']],
    body: rows,
    margin: { left: M.left, right: M.right },
    styles: { fontSize: 9, cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 } },
    headStyles: { fillColor: C.surface2, textColor: C.ink, fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 30 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'center', cellWidth: 20 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const row = report.subjectSummary[data.row.index]
      if (data.column.index === 1) {
        data.cell.styles.textColor = pctColor(row.thisMonth)
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 3) {
        if (row.direction === 'up')   data.cell.styles.textColor = C.success
        if (row.direction === 'down') data.cell.styles.textColor = C.danger
      }
    },
  })

  return doc.lastAutoTable.finalY + 4
}

function drawWeakestChapter(doc, y, report) {
  if (!report.weakestChapter) return y
  const wc = report.weakestChapter
  const accPct = Math.round(wc.accuracy * 100)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C.ink)
  doc.text('Weakest chapter:', M.left, y + 4)

  doc.setFont('helvetica', 'normal')
  doc.text(`${wc.chapter}  ·  ${accPct}% across ${wc.totalQuestions} question${wc.totalQuestions !== 1 ? 's' : ''}`,
    M.left + 32, y + 4)

  return y + 9
}

function drawRemark(doc, y, remark) {
  if (!remark || !remark.trim()) return y
  const W = doc.internal.pageSize.getWidth()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C.ink)
  doc.text('Faculty remark:', M.left, y + 4)

  doc.setFont('helvetica', 'italic')
  doc.setTextColor(...C.ink2)
  const wrapped = doc.splitTextToSize(remark.trim(), W - M.left - M.right - 32)
  doc.text(wrapped, M.left + 32, y + 4)

  return y + 5 + wrapped.length * 4
}

function drawNextMonthFocus(doc, y, report) {
  if (!report.nextMonthFocus) return y
  const W = doc.internal.pageSize.getWidth()
  const list = report.nextMonthFocus.chapters
    .map(c => `${c.subject}: ${c.chapter}`)
    .join(', ')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.ink)
  doc.text(`${report.nextMonthFocus.monthLabel} focus:`, M.left, y + 4)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...C.ink2)
  const wrapped = doc.splitTextToSize(list, W - M.left - M.right - 30)
  doc.text(wrapped, M.left + 30, y + 4)

  return y + 5 + wrapped.length * 3.5
}

function drawFooter(doc) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...C.ink3)
  doc.text('Please visit the institute for further discussion', W / 2, H - 10, { align: 'center' })
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function buildMonthlyReportPdfBlob(report, { remark = '' } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  let y = drawHeader(doc, report)
  y = await drawExamTable(doc, y, report, autoTable)
  y = drawAttendance(doc, y, report, autoTable)
  y = drawSubjectSummary(doc, y, report, autoTable)
  y = drawWeakestChapter(doc, y, report)
  y = drawRemark(doc, y, remark)
  y = drawNextMonthFocus(doc, y, report)
  drawFooter(doc)

  return doc.output('blob')
}

export async function downloadMonthlyReportPdf(report, { remark = '', save = true } = {}) {
  const blob = await buildMonthlyReportPdfBlob(report, { remark })
  const filename = `${safeFile(report.meta.name)}_${safeFile(report.meta.monthLabel)}_Report.pdf`
  if (save) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
  return filename
}
