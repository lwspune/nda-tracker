import {
  getExamTopStudents, getExamBottomStudents,
  getExamWrongQuestions, getExamSkippedQuestions,
  getExamToppers,
} from './analytics'

// ── LaTeX → plain ASCII (jsPDF Helvetica is WinAnsi-encoded;
//    every Unicode symbol above U+00FF renders as garbage) ─────
function stripLatex(text) {
  if (!text) return ''
  return text
    // strip math-mode delimiters
    .replace(/\\\[|\\\]/g, '')
    .replace(/\\\(|\\\)/g, '')
    // flatten environments before anything else
    .replace(/\\begin\{[^}]+\}|\\end\{[^}]+\}/g, '')
    .replace(/\\\\/g, '; ')          // LaTeX line break → semicolon
    .replace(/\\cr\b/g, '; ')
    .replace(/&/g, ' ')              // alignment character → space
    // invisible spacing commands
    .replace(/\\!/g, '')             // negative thin space
    .replace(/\\[,;:]\s*/g, ' ')     // thin / medium / thick space
    // math function names — must come before the final command strip
    .replace(/\\log\b/g, 'log').replace(/\\ln\b/g, 'ln').replace(/\\exp\b/g, 'exp')
    .replace(/\\sin\b/g, 'sin').replace(/\\cos\b/g, 'cos').replace(/\\tan\b/g, 'tan')
    .replace(/\\cot\b/g, 'cot').replace(/\\sec\b/g, 'sec').replace(/\\csc\b/g, 'csc')
    .replace(/\\arcsin\b/g, 'arcsin').replace(/\\arccos\b/g, 'arccos').replace(/\\arctan\b/g, 'arctan')
    .replace(/\\max\b/g, 'max').replace(/\\min\b/g, 'min').replace(/\\lim\b/g, 'lim')
    .replace(/\\gcd\b/g, 'gcd').replace(/\\det\b/g, 'det').replace(/\\mod\b/g, 'mod')
    // fracs — handle one level of nested braces (e.g. \frac{x^{2}}{1+x^{2}})
    .replace(/\\frac\{((?:[^{}]|\{[^{}]*\})*)\}\{((?:[^{}]|\{[^{}]*\})*)\}/g, '($1)/($2)')
    // sqrt — same nested-brace handling
    .replace(/\\sqrt\{((?:[^{}]|\{[^{}]*\})*)\}/g, 'sqrt($1)')
    .replace(/\\sqrt\s+(\w)/g, 'sqrt($1)')
    // superscripts — plain ^n (Unicode sup chars ⁰⁴-⁹ outside WinAnsi)
    .replace(/\^\{(\d+)\}/g, '^$1')
    .replace(/\^(\d)/g, '^$1')
    .replace(/\^\{([^}]*)\}/g, '^($1)')
    // subscripts — plain _n (Unicode sub chars ₀-₉ outside WinAnsi)
    .replace(/_\{(\d+)\}/g, '_$1')
    .replace(/_(\d)/g, '_$1')
    .replace(/_\{([^}]*)\}/g, '_($1)')
    .replace(/_([a-zA-Z])/g, '_$1')
    // number sets — plain letters (ℕℝℤℚℂ outside WinAnsi)
    .replace(/\\mathbb\{N\}/g, 'N').replace(/\\mathbb\{R\}/g, 'R')
    .replace(/\\mathbb\{Z\}/g, 'Z').replace(/\\mathbb\{Q\}/g, 'Q')
    .replace(/\\mathbb\{C\}/g, 'C')
    // set operations — ASCII equivalents (∈⊆∪∩∅ outside WinAnsi)
    .replace(/\\in\b/g, ' in ').replace(/\\notin\b/g, ' not in ')
    .replace(/\\subseteq\b/g, ' C= ').replace(/\\subset\b/g, ' C ')
    .replace(/\\supseteq\b/g, ' =C ').replace(/\\supset\b/g, ' D ')
    .replace(/\\cup\b/g, ' U ').replace(/\\cap\b/g, ' n ')
    .replace(/\\setminus\b/g, '\\').replace(/\\emptyset\b/g, '{}')
    .replace(/\\varnothing\b/g, '{}')
    // arithmetic / comparison
    // × ÷ ± · are U+00D7/F7/B1/B7 — inside WinAnsi, safe to keep
    .replace(/\\times\b/g, '\xD7').replace(/\\div\b/g, '\xF7')
    .replace(/\\cdot\b/g, '\xB7').replace(/\\pm\b/g, '\xB1').replace(/\\mp\b/g, '-/+')
    // ≤ ≥ ≠ ≈ ≡ are outside WinAnsi — use ASCII
    .replace(/\\leq\b/g, '<=').replace(/\\geq\b/g, '>=')
    .replace(/\\le\b/g, '<=').replace(/\\ge\b/g, '>=')
    .replace(/\\neq\b/g, '!=').replace(/\\ne\b/g, '!=')
    .replace(/\\approx\b/g, '~=').replace(/\\equiv\b/g, '==').replace(/\\sim\b/g, '~')
    // arrows — all outside WinAnsi
    .replace(/\\Rightarrow\b/g, '=>').replace(/\\Leftarrow\b/g, '<=')
    .replace(/\\Leftrightarrow\b/g, '<=>').replace(/\\rightarrow\b/g, '->')
    .replace(/\\leftarrow\b/g, '<-').replace(/\\leftrightarrow\b/g, '<->')
    .replace(/\\to\b/g, '->').replace(/\\mapsto\b/g, '|->')
    // Greek — ASCII names (all Greek code-points outside WinAnsi)
    .replace(/\\alpha\b/g, 'alpha').replace(/\\beta\b/g, 'beta').replace(/\\gamma\b/g, 'gamma')
    .replace(/\\delta\b/g, 'delta').replace(/\\varepsilon\b/g, 'eps').replace(/\\epsilon\b/g, 'eps')
    .replace(/\\zeta\b/g, 'zeta').replace(/\\eta\b/g, 'eta')
    .replace(/\\vartheta\b/g, 'theta').replace(/\\theta\b/g, 'theta')
    .replace(/\\iota\b/g, 'iota').replace(/\\kappa\b/g, 'kappa').replace(/\\lambda\b/g, 'lambda')
    .replace(/\\mu\b/g, 'mu').replace(/\\nu\b/g, 'nu').replace(/\\xi\b/g, 'xi')
    .replace(/\\pi\b/g, 'pi').replace(/\\rho\b/g, 'rho').replace(/\\sigma\b/g, 'sigma')
    .replace(/\\tau\b/g, 'tau').replace(/\\upsilon\b/g, 'upsilon')
    .replace(/\\varphi\b/g, 'phi').replace(/\\phi\b/g, 'phi')
    .replace(/\\chi\b/g, 'chi').replace(/\\psi\b/g, 'psi').replace(/\\omega\b/g, 'omega')
    // Greek uppercase
    .replace(/\\Gamma\b/g, 'Gamma').replace(/\\Delta\b/g, 'Delta').replace(/\\Theta\b/g, 'Theta')
    .replace(/\\Lambda\b/g, 'Lambda').replace(/\\Xi\b/g, 'Xi').replace(/\\Pi\b/g, 'Pi')
    .replace(/\\Sigma\b/g, 'Sigma').replace(/\\Upsilon\b/g, 'Upsilon').replace(/\\Phi\b/g, 'Phi')
    .replace(/\\Psi\b/g, 'Psi').replace(/\\Omega\b/g, 'Omega')
    // misc symbols — all outside WinAnsi
    .replace(/\\infty\b/g, 'inf').replace(/\\forall\b/g, 'for all').replace(/\\exists\b/g, 'exists')
    .replace(/\\partial\b/g, 'd').replace(/\\nabla\b/g, 'del')
    .replace(/\\angle\b/g, 'angle').replace(/\\perp\b/g, '_|_').replace(/\\parallel\b/g, '||')
    .replace(/\\therefore\b/g, ':.').replace(/\\because\b/g, 'because')
    // text / font wrappers
    .replace(/\\(?:text|mathrm|mathbf|mathit|textbf|textit)\{([^}]*)\}/g, '$1')
    // escaped braces and pipes
    .replace(/\\{/g, '{').replace(/\\}/g, '}')
    .replace(/\\\|/g, '|').replace(/\\lvert\b/g, '|').replace(/\\rvert\b/g, '|')
    .replace(/\\lVert\b/g, '||').replace(/\\rVert\b/g, '||')
    // strip any remaining unknown commands, then bare braces
    .replace(/\\[a-zA-Z]+[*]?/g, '').replace(/[{}]/g, '')
    .replace(/\s+/g, ' ').trim()
}

// ── Colour palette ────────────────────────────────────────────
const C = {
  accent:     [37,  99, 235],   // blue-600
  accentSoft: [219, 234, 254],  // blue-100
  success:    [22,  163, 74],   // green-600
  warning:    [202, 138, 4],    // yellow-600
  danger:     [220, 38,  38],   // red-600
  wrongBg:    [254, 226, 226],  // red-100
  skippedBg:  [254, 243, 199],  // amber-100
  ink:        [15,  23,  42],   // slate-900
  ink2:       [71,  85,  105],  // slate-600
  ink3:       [148, 163, 184],  // slate-400
  border:     [226, 232, 240],  // slate-200
  surface2:   [241, 245, 249],  // slate-100
  white:      [255, 255, 255],
}

function pctColor(p) {
  if (p >= 70) return C.success
  if (p >= 45) return C.warning
  return C.danger
}

function fmtPct(p) { return `${Math.round(p)}%` }

// ── Header band ───────────────────────────────────────────────
function drawHeader(doc, exam) {
  const W = doc.internal.pageSize.getWidth()

  // Accent band
  doc.setFillColor(...C.accent)
  doc.rect(0, 0, W, 28, 'F')

  // Institute name
  doc.setTextColor(...C.white)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('LWS PUNE — NDA MATHS TRACKER', 14, 10)

  // Exam name
  doc.setFontSize(15)
  doc.text(exam.name, 14, 20)

  // Meta row (right-aligned)
  const meta = [
    exam.date,
    exam.subject || 'Maths',
    exam.batch   || '',
    exam.branch  || '',
  ].filter(Boolean).join('  ·  ')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(meta, W - 14, 20, { align: 'right' })

  // Marking scheme badge
  const scheme = `+${exam.marking.correct} / ${exam.marking.wrong}`
  doc.setFontSize(7.5)
  doc.text(`Marking: ${scheme}`, W - 14, 10, { align: 'right' })

  return 34  // y after header
}

// ── Section label ─────────────────────────────────────────────
function sectionLabel(doc, y, label) {
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.ink3)
  doc.text(label.toUpperCase(), 14, y)
  doc.setDrawColor(...C.border)
  doc.line(14, y + 1.5, doc.internal.pageSize.getWidth() - 14, y + 1.5)
  return y + 6
}

// ── Stat boxes row ────────────────────────────────────────────
function drawStatBoxes(doc, y, exam) {
  const W       = doc.internal.pageSize.getWidth()
  const scores  = exam.students.map(s => s.totalMarks)
  const maxM    = exam.questions.length * exam.marking.correct
  const avg     = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const min     = scores.length ? Math.min(...scores) : 0
  const max     = scores.length ? Math.max(...scores) : 0
  const pct     = v => maxM > 0 ? v / maxM * 100 : 0

  const boxes = [
    { label: 'Students',  value: exam.students.length,         sub: '',                   color: C.accent  },
    { label: 'Questions', value: exam.questions.length,        sub: `Max ${maxM} marks`,  color: C.ink2    },
    { label: 'Min Score', value: `${min}`,  sub: fmtPct(pct(min)), color: pctColor(pct(min)) },
    { label: 'Avg Score', value: `${Math.round(avg)}`, sub: fmtPct(pct(avg)), color: pctColor(pct(avg)) },
    { label: 'Max Score', value: `${max}`,  sub: fmtPct(pct(max)), color: pctColor(pct(max)) },
  ]

  const bw = (W - 28 - (boxes.length - 1) * 4) / boxes.length
  const bh = 20

  boxes.forEach((b, i) => {
    const x = 14 + i * (bw + 4)
    doc.setFillColor(...C.surface2)
    doc.roundedRect(x, y, bw, bh, 2, 2, 'F')
    doc.setDrawColor(...b.color)
    doc.setLineWidth(0.8)
    doc.roundedRect(x, y, bw, bh, 2, 2, 'S')
    doc.setLineWidth(0.2)

    doc.setTextColor(...b.color)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(String(b.value), x + bw / 2, y + 10, { align: 'center' })

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C.ink3)
    doc.text(b.label, x + bw / 2, y + 15.5, { align: 'center' })
    if (b.sub) {
      doc.setTextColor(...b.color)
      doc.text(b.sub, x + bw / 2, y + 19, { align: 'center' })
    }
  })

  return y + bh + 8
}

// ── Students table (top or bottom) ───────────────────────────
function studentsTable(doc, autoTable, students, startY, title, rankOffset = 1) {
  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    tableWidth: (doc.internal.pageSize.getWidth() - 28) / 2 - 3,
    head: [[{ content: title, colSpan: 4, styles: { halign: 'left', fillColor: C.accent, textColor: C.white, fontStyle: 'bold', fontSize: 8 } }],
           ['#', 'Student', 'Score', '%']],
    body: students.map((s, i) => [
      rankOffset + i,
      s.name,
      s.score,
      fmtPct(s.pct * 100),
    ]),
    styles:     { fontSize: 8, cellPadding: 2.5, textColor: C.ink },
    headStyles: { fillColor: C.surface2, textColor: C.ink2, fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell(data) {
      if (data.section === 'head' && data.row.index === 0) return
      if (data.section === 'body' && data.column.index === 3) {
        const p = parseFloat(data.cell.raw)
        data.cell.styles.textColor = pctColor(p)
      }
    },
    didDrawPage: () => {},
  })
  return doc.lastAutoTable.finalY
}

// ── Questions table (wrong or skipped) ───────────────────────
function questionsTable(doc, autoTable, items, startY, title, type) {
  const isWrong  = type === 'wrong'
  const hdrColor = isWrong ? [239, 68, 68] : [245, 158, 11]
  const rowBg    = isWrong ? C.wrongBg : C.skippedBg
  const countKey = isWrong ? 'wrong'   : 'skipped'
  const rateKey  = isWrong ? 'wrongRate' : 'skipRate'

  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    showHead: 'firstPage',
    head: [
      [{ content: title, colSpan: 5, styles: { halign: 'left', fillColor: hdrColor, textColor: C.white, fontStyle: 'bold', fontSize: 8 } }],
      ['Q#', 'Chapter', 'Subtopic', isWrong ? 'Wrong' : 'Skipped', 'Rate'],
    ],
    body: items.map(item => [
      `Q${item.q.q}`,
      item.q.chapter   || '—',
      item.q.subtopic  || '—',
      item[countKey],
      fmtPct(item[rateKey] * 100),
    ]),
    styles:     { fontSize: 8, cellPadding: 2.5, textColor: C.ink },
    headStyles: { fillColor: C.surface2, textColor: C.ink2, fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
    },
    bodyStyles: { fillColor: rowBg },
    didParseCell(data) {
      if (data.section === 'head' && data.row.index === 0) return
      if (data.section === 'body' && data.column.index === 4) {
        data.cell.styles.textColor = hdrColor
      }
    },
  })
  return doc.lastAutoTable.finalY
}

// ── Question detail cards (question text + options + answer) ─
function questionDetailCards(doc, items, startY, type) {
  const isWrong  = type === 'wrong'
  const countKey = isWrong ? 'wrong'     : 'skipped'
  const rateKey  = isWrong ? 'wrongRate' : 'skipRate'
  const accentBg = isWrong ? [254, 226, 226] : [254, 243, 199]
  const accentFg = isWrong ? C.danger : C.warning

  const withText = items.filter(item => item.q?.question)
  if (!withText.length) return startY

  const W      = doc.internal.pageSize.getWidth()
  const margin = 14
  const cardW  = W - margin * 2
  const half   = (cardW - 12) / 2
  let y = startY

  for (const item of withText) {
    const q = item.q

    // Pre-measure lines at their render sizes
    doc.setFontSize(8.5)
    const qLines = doc.splitTextToSize(stripLatex(q.question || ''), cardW - 8)

    doc.setFontSize(8)
    const oA = q.optionA ? doc.splitTextToSize(`A)  ${stripLatex(q.optionA)}`, half) : []
    const oB = q.optionB ? doc.splitTextToSize(`B)  ${stripLatex(q.optionB)}`, half) : []
    const oC = q.optionC ? doc.splitTextToSize(`C)  ${stripLatex(q.optionC)}`, half) : []
    const oD = q.optionD ? doc.splitTextToSize(`D)  ${stripLatex(q.optionD)}`, half) : []

    const hasOpts   = oA.length || oB.length || oC.length || oD.length
    const row1H     = hasOpts ? Math.max(oA.length, oB.length) * 4.5 + 1 : 0
    const row2H     = hasOpts ? Math.max(oC.length, oD.length) * 4.5 + 1 : 0
    const hasAnswer = !!(q.answer || q.difficulty)

    const cardH = 8 +
      qLines.length * 4.5 + 5 +
      (hasOpts   ? row1H + row2H + 8 : 0) +
      (hasAnswer ? 7 : 0) +
      4

    y = ensureSpace(doc, y, cardH + 4)

    // Card background + border
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(margin, y, cardW, cardH, 2, 2, 'F')
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.roundedRect(margin, y, cardW, cardH, 2, 2, 'S')

    // Header strip
    doc.setFillColor(...accentBg)
    doc.roundedRect(margin, y, cardW, 8, 2, 2, 'F')
    doc.setFillColor(248, 250, 252)
    doc.rect(margin, y + 4, cardW, 4, 'F')

    // Header text — left: Q# · chapter · subtopic
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...accentFg)
    const hdrL = `Q${q.q}  ·  ${q.chapter || ''}${q.subtopic ? '  ·  ' + q.subtopic : ''}`
    doc.text(hdrL, margin + 4, y + 5.5)

    // Header text — right: count + rate
    doc.setTextColor(...C.ink2)
    doc.setFont('helvetica', 'normal')
    const hdrR = `${isWrong ? 'Wrong' : 'Skipped'}: ${item[countKey]} (${fmtPct(item[rateKey] * 100)})`
    doc.text(hdrR, margin + cardW - 4, y + 5.5, { align: 'right' })

    let cy = y + 11

    // Question text
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C.ink)
    doc.text(qLines, margin + 4, cy)
    cy += qLines.length * 4.5 + 4

    // Options
    if (hasOpts) {
      doc.setDrawColor(...C.border)
      doc.setLineWidth(0.2)
      doc.line(margin + 4, cy, margin + cardW - 4, cy)
      cy += 4

      doc.setFontSize(8)
      const ans = (q.answer || '').toUpperCase()

      function drawOpt(lines, letter, x) {
        if (!lines.length) return
        const isCorrect = ans === letter
        doc.setFont('helvetica', isCorrect ? 'bold' : 'normal')
        doc.setTextColor(...(isCorrect ? C.success : C.ink2))
        doc.text(lines, x, cy)
      }

      drawOpt(oA, 'A', margin + 4)
      drawOpt(oB, 'B', margin + 4 + half + 6)
      cy += Math.max(oA.length, oB.length, 1) * 4.5 + 1

      drawOpt(oC, 'C', margin + 4)
      drawOpt(oD, 'D', margin + 4 + half + 6)
      cy += Math.max(oC.length, oD.length, 1) * 4.5 + 2
    }

    // Answer + difficulty footer
    if (hasAnswer) {
      cy += 1
      doc.setFontSize(8)
      if (q.answer) {
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...C.success)
        doc.text(`Answer: ${q.answer}`, margin + 4, cy)
      }
      if (q.difficulty) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...C.ink3)
        doc.text(`Difficulty: ${q.difficulty}`, margin + cardW - 4, cy, { align: 'right' })
      }
    }

    y += cardH + 4
  }

  return y
}

// ── Footer on every page ──────────────────────────────────────
function addFooters(doc) {
  const W      = doc.internal.pageSize.getWidth()
  const H      = doc.internal.pageSize.getHeight()
  const pages  = doc.internal.getNumberOfPages()
  const today  = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(...C.border)
    doc.line(14, H - 10, W - 14, H - 10)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C.ink3)
    doc.text(`LWS Pune · NDA Tracker · Generated ${today}`, 14, H - 6)
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 6, { align: 'right' })
  }
}

// ── Ensure enough space on current page ──────────────────────
function ensureSpace(doc, y, needed) {
  if (y + needed > doc.internal.pageSize.getHeight() - 18) {
    doc.addPage()
    return 18
  }
  return y
}

// ── Main export function ──────────────────────────────────────
export async function downloadExamPdf(exam) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W       = doc.internal.pageSize.getWidth()
  const maxM    = exam.questions.length * exam.marking.correct

  // ── Page 1 ────────────────────────────────────────────────
  let y = drawHeader(doc, exam)

  // Class overview
  y = sectionLabel(doc, y, 'Class Overview')
  y = drawStatBoxes(doc, y, exam)

  // Score distribution note
  if (exam.students.length > 0) {
    const scores = exam.students.map(s => s.totalMarks).sort((a, b) => a - b)
    const median = scores[Math.floor(scores.length / 2)]
    const above50 = scores.filter(s => maxM > 0 && s / maxM >= 0.5).length
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C.ink2)
    doc.text(
      `Median: ${median} · Students above 50%: ${above50} of ${scores.length}`,
      14, y
    )
    y += 8
  }

  // Top & Bottom students
  y = ensureSpace(doc, y, 60)
  y = sectionLabel(doc, y, 'Student Performance')

  const top    = getExamTopStudents(exam, 5)
  const bottom = getExamBottomStudents(exam, 5)

  // Left table: Top 5
  studentsTable(doc, autoTable, top, y, 'Top 5 Students')
  const leftY = doc.lastAutoTable.finalY

  // Right table: Bottom 5 — placed to the right of top table
  const halfW = (W - 28) / 2 + 3
  autoTable(doc, {
    startY: y,
    margin: { left: 14 + halfW, right: 14 },
    head: [
      [{ content: 'Bottom 5 Students', colSpan: 4, styles: { halign: 'left', fillColor: C.danger, textColor: C.white, fontStyle: 'bold', fontSize: 8 } }],
      ['#', 'Student', 'Score', '%'],
    ],
    body: bottom.map((s, i) => [
      exam.students.length - bottom.length + i + 1,
      s.name,
      s.score,
      fmtPct(s.pct * 100),
    ]),
    styles:     { fontSize: 8, cellPadding: 2.5, textColor: C.ink },
    headStyles: { fillColor: C.surface2, textColor: C.ink2, fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell(data) {
      if (data.section === 'head' && data.row.index === 0) return
      if (data.section === 'body' && data.column.index === 3) {
        const p = parseFloat(data.cell.raw)
        data.cell.styles.textColor = pctColor(p)
      }
    },
  })
  const rightY = doc.lastAutoTable.finalY

  y = Math.max(leftY, rightY) + 8

  // ── Wrong & Skipped questions ─────────────────────────────
  const wrong   = getExamWrongQuestions(exam, null, 5)
  const skipped = getExamSkippedQuestions(exam, null, 5)

  if (wrong.length) {
    y = ensureSpace(doc, y, 50)
    y = sectionLabel(doc, y, 'Most Challenging Questions — All Students')
    y = questionsTable(doc, autoTable, wrong, y, 'Top 5 Most Wrong Questions', 'wrong') + 6
    y = questionDetailCards(doc, wrong, y, 'wrong') + 4
  }

  if (skipped.length) {
    y = ensureSpace(doc, y, 50)
    if (!wrong.length) y = sectionLabel(doc, y, 'Most Challenging Questions — All Students')
    y = questionsTable(doc, autoTable, skipped, y, 'Top 5 Most Skipped Questions', 'skipped') + 6
    y = questionDetailCards(doc, skipped, y, 'skipped') + 4
  }

  // ── Toppers section (questions only, no list) ─────────────
  const { names, count, cutoffScore } = getExamToppers(exam, 0.25)
  const cutoffPct = maxM > 0 ? Math.round(cutoffScore / maxM * 100) : 0
  const tWrong    = getExamWrongQuestions(exam, names, 5)
  const tSkipped  = getExamSkippedQuestions(exam, names, 5)

  if (tWrong.length || tSkipped.length) {
    y = ensureSpace(doc, y, 55)
    y = sectionLabel(doc, y, `Topper Analysis — Top 25% (${count} students · cutoff ≥ ${cutoffScore}, ${cutoffPct}%)`)

    if (tWrong.length) {
      y = questionsTable(doc, autoTable, tWrong, y, 'Wrong Questions Among Toppers', 'wrong') + 6
      y = questionDetailCards(doc, tWrong, y, 'wrong') + 4
    }
    if (tSkipped.length) {
      y = ensureSpace(doc, y, 45)
      y = questionsTable(doc, autoTable, tSkipped, y, 'Skipped Questions Among Toppers', 'skipped') + 6
      y = questionDetailCards(doc, tSkipped, y, 'skipped') + 4
    }
  }

  // ── All students score table ──────────────────────────────
  if (exam.students.length > 0) {
    doc.addPage()
    y = drawHeader(doc, exam)
    y = sectionLabel(doc, y, `All Students — ${exam.students.length} total`)

    const allSorted = [...exam.students].sort((a, b) => b.totalMarks - a.totalMarks)
    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14 },
      head: [['Rank', 'Student Name', 'Score', '%', 'Correct', 'Wrong', 'Skipped']],
      body: allSorted.map((s, i) => {
        const pct = maxM > 0 ? s.totalMarks / maxM * 100 : 0
        return [
          i + 1,
          s.name,
          s.totalMarks,
          fmtPct(pct),
          s.correct ?? '—',
          s.incorrect ?? '—',
          s.notAttempted ?? '—',
        ]
      }),
      styles:     { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
      headStyles: { fillColor: C.accent, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: C.surface2 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 16, halign: 'center' },
        5: { cellWidth: 16, halign: 'center' },
        6: { cellWidth: 16, halign: 'center' },
      },
      didParseCell(data) {
        if (data.section === 'body' && data.column.index === 3) {
          const p = parseFloat(data.cell.raw)
          data.cell.styles.textColor = pctColor(p)
        }
      },
    })
  }

  addFooters(doc)

  // Sanitise filename
  const filename = `${exam.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim()}_insights.pdf`
  doc.save(filename)
}
