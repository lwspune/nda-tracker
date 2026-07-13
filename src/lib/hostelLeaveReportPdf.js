// Daily hostel-leave report — the boarders on leave for a given day, grouped
// gender → class, as a printable PDF for the warden.
//
// Batch grouping is by CLASS LEVEL, ordered 9th → 10th → 11th → 12th → 6M
// (not alphabetical, which would mis-sort 10th/11th/6M). The 11th A/B sub-batches
// collapse into a single "11th" bucket. Anything unrecognised falls to "Other".
//
// The grouping (buildLeaveReportGroups) is pure + unit-tested; the jsPDF render
// mirrors src/lib/studentReportPdf.js (dynamic import, jspdf-autotable).

export const STD_ORDER = ['9th', '10th', '11th', '12th', '6M']

// Gender sections in report order. '' catches blank/unknown so no boarder is
// silently dropped from the report.
const GENDER_SECTIONS = [
  { key: 'Male', label: 'Boys' },
  { key: 'Female', label: 'Girls' },
  { key: '', label: 'Unspecified' },
]

// Class level embedded in a batch name (e.g. APJ_NDA_11th_(26-27)_A → 11th).
// Matched with underscore boundaries so 10th/12th never collide with a bare
// digit. Returns null when no known level is present.
export function classOfBatch(batchName) {
  if (!batchName) return null
  for (const s of STD_ORDER) {
    if (batchName.includes(`_${s}_`) || batchName === s) return s
  }
  return null
}

function genderKey(g) {
  return g === 'Male' ? 'Male' : g === 'Female' ? 'Female' : ''
}

function classRank(cls) {
  const i = STD_ORDER.indexOf(cls)
  return i === -1 ? STD_ORDER.length : i
}

// Group the day's on-leave rows into gender sections, each grouped by class.
// Row shape: { lwsId, name, gender, batch, since, daysOut, mobile, parent }.
// Returns [] when no rows; omits any gender section with no boarders on leave.
export function buildLeaveReportGroups(rows) {
  const out = []
  for (const { key, label } of GENDER_SECTIONS) {
    const mine = rows.filter(r => genderKey(r.gender) === key)
    if (mine.length === 0) continue

    const byClass = new Map()
    for (const r of mine) {
      const cls = classOfBatch(r.batch) || 'Other'
      if (!byClass.has(cls)) byClass.set(cls, [])
      byClass.get(cls).push(r)
    }

    const groups = [...byClass.entries()]
      .sort((a, b) => classRank(a[0]) - classRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([batch, students]) => ({
        batch,
        count: students.length,
        students: students.slice().sort((x, y) => x.name.localeCompare(y.name)),
      }))

    out.push({ gender: label, count: mine.length, groups })
  }
  return out
}

// Render + download the report. `date` is DD-MM-YYYY (the board's day).
export async function downloadHostelLeaveReportPdf({ date, rows }) {
  const groups = buildLeaveReportGroups(rows)
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const ML = 14
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // ── Header ──────────────────────────────────────────────────────────
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Daily Hostel Leave', ML, 16)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(date, pageW - ML, 16, { align: 'right' })

  const total = groups.reduce((n, s) => n + s.count, 0)
  const summary = total === 0
    ? 'No boarders on leave.'
    : groups.map(s => `${s.gender}: ${s.count}`).join('   ·   ') + `   ·   Total: ${total}`
  doc.setFontSize(9)
  doc.text(summary, ML, 23)

  let y = 30

  const ensureSpace = (needed) => {
    if (y + needed > pageH - ML) { doc.addPage(); y = 16 }
  }

  for (const section of groups) {
    ensureSpace(14)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`${section.gender.toUpperCase()} — ${section.count} on leave`, ML, y)
    y += 5

    for (const group of section.groups) {
      ensureSpace(16)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(`${group.batch}  (${group.count})`, ML, y)
      y += 2

      autoTable(doc, {
        startY: y,
        margin: { left: ML, right: ML },
        head: [['Name', 'Since', 'Days out', 'Mobile', 'Parent']],
        body: group.students.map(s => [s.name, s.since, String(s.daysOut), s.mobile || '—', s.parent || '—']),
        styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' },
        headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 58 },
          1: { cellWidth: 24, halign: 'center' },
          2: { cellWidth: 20, halign: 'center' },
          3: { cellWidth: 30 },
          4: { cellWidth: 'auto' },
        },
      })
      y = doc.lastAutoTable.finalY + 4
    }
    y += 3
  }

  const safeDate = String(date).replace(/[^\w-]/g, '')
  doc.save(`hostel_leave_${safeDate}.pdf`)
}
