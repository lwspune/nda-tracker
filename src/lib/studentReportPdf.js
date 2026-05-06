// Per-student exam report PDF — one page per student, landscape A4.
// Grouping auto-detected: multi-subject → Subject, single-subject multi-chapter → Chapter,
// single-chapter → Subtopic.

function getGroupingLevel(questions) {
  const subjects = [...new Set(questions.map(q => q.subject).filter(Boolean))]
  if (subjects.length > 1) return 'subject'
  const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))]
  if (chapters.length > 1) return 'chapter'
  return 'subtopic'
}

function buildGroupedData(exam, student) {
  const { questions, marking } = exam
  const responses = student.responses || {}
  const level = getGroupingLevel(questions)

  const groupMap = new Map()
  for (const q of questions) {
    const key =
      level === 'subject' ? (q.subject  || exam.subject || 'Unknown') :
      level === 'chapter' ? (q.chapter  || 'Untagged') :
                            (q.subtopic || q.chapter   || 'Untagged')
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(q)
  }

  let totC = 0, totI = 0, totNA = 0, totPv = 0, totNv = 0

  const rows = []
  for (const [groupName, qs] of groupMap) {
    const correct = [], incorrect = [], na = []
    for (const q of qs) {
      const r = responses[q.q]
      if      (r === 1)  correct.push(q.q)
      else if (r === -1) incorrect.push(q.q)
      else               na.push(q.q)
    }
    correct.sort((a, b) => a - b)
    incorrect.sort((a, b) => a - b)
    na.sort((a, b) => a - b)

    const pv = correct.length   * marking.correct
    const nv = incorrect.length * marking.wrong  // marking.wrong is already negative e.g. -1

    rows.push({ group: groupName, correctNos: correct, incorrectNos: incorrect, naNos: na,
                totC: correct.length, totI: incorrect.length, totNA: na.length,
                totQs: qs.length, pv, nv, total: pv + nv })

    totC  += correct.length
    totI  += incorrect.length
    totNA += na.length
    totPv += pv
    totNv += nv
  }

  return { level, rows, totC, totI, totNA, totPv, totNv }
}

function fmtMarks(v) {
  return v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)
}

function renderStudentPage(doc, autoTable, exam, student) {
  const { level, rows, totC, totI, totNA, totPv, totNv } = buildGroupedData(exam, student)
  const groupLabel = level === 'subject' ? 'Subject' : level === 'chapter' ? 'Chapter' : 'Subtopic'
  const ML = 14  // left/right margin

  // ── Header ─────────────────────────────────────────────────────────
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(`Name: ${student.name}`, ML, 14)
  doc.text(`Marks: ${student.totalMarks}`, 210 - ML, 14, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `${exam.name}  ·  ${exam.date}  ·  +${exam.marking.correct}/${exam.marking.wrong}`,
    ML, 20
  )

  // ── Table 1: Q-number breakdown ────────────────────────────────────
  // Column widths sum to 269 = 297 - 2×14 (usable page width at 14mm margins)
  const t1body = rows.map(r => [
    r.group,
    r.correctNos.join(', ')   || '—',
    r.incorrectNos.join(', ') || '—',
    r.naNos.join(', ')        || '—',
    r.totC, r.totI, r.totNA, r.totQs,
  ])
  t1body.push(['TOTAL', '', '', '', totC, totI, totNA, totC + totI + totNA])

  autoTable(doc, {
    startY: 24,
    margin: { left: ML, right: ML },
    head: [[groupLabel, 'Correct Q Nos', 'Incorrect Q Nos', 'Not Attempted Q Nos',
            'Tot.\nCorrect', 'Tot.\nIncorrect', 'Tot.\nNA', 'Tot.\nQs']],
    body: t1body,
    styles:     { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 40, halign: 'right' },
      2: { cellWidth: 40, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 14, halign: 'right' },
      6: { cellWidth: 9,  halign: 'right' },
      7: { cellWidth: 7,  halign: 'right' },
    },
    didParseCell: ({ row, cell, column }) => {
      if (row.index === t1body.length - 1) cell.styles.fontStyle = 'bold'
      if (row.section === 'head' && column.index > 0) cell.styles.halign = 'right'
    },
  })

  // ── Table 2: Marks summary ─────────────────────────────────────────
  const t2y = doc.lastAutoTable.finalY + 4
  const t2body = rows.map(r => [r.group, fmtMarks(r.pv), r.nv.toFixed(2), fmtMarks(r.total)])
  t2body.push(['TOTAL', fmtMarks(totPv), totNv.toFixed(2), fmtMarks(totPv + totNv)])

  autoTable(doc, {
    startY: t2y,
    margin: { left: ML, right: ML },
    head: [['Marks Summary', '+ve Marks', '-ve Marks', 'Total Marks']],
    body: t2body,
    styles:     { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 34, halign: 'right' },
      2: { cellWidth: 34, halign: 'right' },
      3: { cellWidth: 34, halign: 'right' },
    },
    didParseCell: ({ row, cell, column }) => {
      if (row.index === t2body.length - 1) cell.styles.fontStyle = 'bold'
      if (row.section === 'head' && column.index > 0) cell.styles.halign = 'right'
    },
  })
}

export async function downloadStudentReportsPdf(exam) {
  const { jsPDF }           = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  exam.students.forEach((student, idx) => {
    if (idx > 0) doc.addPage()
    renderStudentPage(doc, autoTable, exam, student)
  })

  const safeName = exam.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')
  doc.save(`${safeName}_student_reports.pdf`)
}
