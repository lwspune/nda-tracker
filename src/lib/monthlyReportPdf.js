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

  // Two-line meta block (left): Name + Period
  const labelX = M.left
  const valueX = M.left + 30
  let y = M.top + 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C.ink2)
  doc.text('Name:', labelX, y)
  doc.text('Period:', labelX, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.ink)
  doc.text(report.meta.name || '—', valueX, y)
  doc.text(report.meta.rangeLabel || '', valueX, y + 5)

  return y + 11     // y position to continue from
}

async function drawExamTable(doc, y, report, autoTable) {
  if (report.examTable.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.ink2)
    doc.text('No exams taken this period.', M.left, y + 4)
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

// Builds the ordered attendance / conduct blocks as pure {label, value} data —
// exception-only: a block is included ONLY when it has something to report, so a
// clean month renders just the positive attendance line (or nothing).
//   • Attendance — shown whenever attendance was recorded (totalWorkingDays > 0);
//     omitted at 0/0. Numerator = present + late (they showed up, some late).
//   • Late days — omitted at zero (same source as attendance).
//   • Missed lectures / Homework incomplete — exception logs; omitted when empty.
//     Homework counts ONLY unresolved items.
// Exported for unit testing; drawn by drawConduct.
export function conductBlocks(report) {
  const a = report.attendance || {}
  const blocks = []

  if (a.totalWorkingDays > 0) {
    blocks.push({
      label: 'ATTENDANCE',
      value: `${a.present + a.late} / ${a.totalWorkingDays} days present (${a.attendancePercentage}%)`,
    })
  }
  if (a.late > 0) {
    blocks.push({ label: `LATE DAYS (${a.late})`, value: (a.lateDates || []).join(', ') })
  }
  const missed = a.missedLectureDetails || []
  if (missed.length > 0) {
    blocks.push({
      label: `MISSED LECTURES (${missed.length})`,
      value: missed.map(r => `${r.date} ${r.subject || ''}`.trim()).join(', '),
    })
  }
  const incomplete = (report.homeworkFlagged || []).filter(h => !h.resolved)
  if (incomplete.length > 0) {
    blocks.push({
      label: `HOMEWORK INCOMPLETE (${incomplete.length})`,
      value: incomplete.map(h => {
        const head = [h.subject, h.chapter].filter(Boolean).join(' \xB7 ')  // " · " (WinAnsi)
        return head ? `${h.date} - ${head}` : h.date
      }).join(', '),
    })
  }
  return blocks
}

// Renders the conduct blocks stacked vertically — bold LABEL header, the actual
// data on the line below. The Attendance value is colour-coded by percentage;
// the rest are plain. Draws nothing when there are no blocks.
function drawConduct(doc, y, report) {
  const blocks = conductBlocks(report)
  if (blocks.length === 0) return y
  const W = doc.internal.pageSize.getWidth()
  const maxW = W - M.left - M.right
  let cursor = y + 4

  for (const b of blocks) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C.ink)
    doc.text(b.label, M.left, cursor)
    cursor += 4

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...(b.label === 'ATTENDANCE'
      ? pctColor(report.attendance.attendancePercentage)
      : C.ink2))
    const wrapped = doc.splitTextToSize(b.value || '', maxW)
    doc.text(wrapped, M.left, cursor)
    cursor += wrapped.length * 3.6 + 3.5
  }
  return cursor
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
  y = drawConduct(doc, y, report)
  y = drawRemark(doc, y, remark)
  drawNextMonthFocus(doc, y, report)
  drawFooter(doc)

  return doc.output('blob')
}

export async function downloadMonthlyReportPdf(report, { remark = '', save = true } = {}) {
  const blob = await buildMonthlyReportPdfBlob(report, { remark })
  const filename = `${safeFile(report.meta.name)}_${safeFile(report.meta.rangeLabel)}_Report.pdf`
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
