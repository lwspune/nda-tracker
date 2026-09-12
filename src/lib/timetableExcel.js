// The timetable grid as a styled .xlsx.
//
// Moved out of TimetablePage.jsx on 2026-09-12 — ~130 lines of spreadsheet
// construction that had nothing to do with rendering, and that pulled the heavy
// xlsx-js-style import into the page module.
//
// Uses xlsx-js-style, NOT xlsx: the plain package drops cell styling silently,
// and this sheet is printed and pinned to a noticeboard. Do not "simplify" the
// import back.
//
// XLSX.writeFile is deliberately not used — it reaches for Node's fs, which Vite
// externalises, so calling it from the browser throws "Cannot access
// .writeFileSync in client code". Hence write-to-array then downloadBlob.

import * as XLSX from 'xlsx-js-style'
import { downloadBlob } from './download'
import { parseTimeToMinutes, fmtDayDate, getTimetableTitle } from './timetable'

export function downloadTimetableExcel(timetable, mappings, teachers = [], weekDates = null) {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const FONT = 'Times New Roman'
  const BORDER = { style: 'thin', color: { rgb: '000000' } }
  const border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }

  const cell = (v, s) => ({ v, t: 's', s })

  const titleStyle = {
    font: { name: FONT, bold: true, sz: 13 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const headerStyle = {
    font: { name: FONT, bold: true, sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const timeStyle = {
    font: { name: FONT, bold: true, sz: 10 },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border,
  }
  const bodyStyle = {
    font: { name: FONT, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const spanLabelStyle = {
    font: { name: FONT, bold: true, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }

  const slots = [...timetable.timeSlots].sort(
    (a, b) => (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0)
  )
  const { grid } = timetable
  const rows = []
  const merges = []
  const rowHeights = []

  // Row 0: title (custom title if set, else branch — batchName)
  rows.push([
    cell(getTimetableTitle(timetable), titleStyle),
    ...Array(6).fill(cell('', titleStyle)),
  ])
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } })
  rowHeights.push({ hpt: 28 })

  // Row 1: headers — append the week's calendar date under each day when set
  rows.push([
    cell('Time', headerStyle),
    ...DAYS.map(day => {
      const dateLabel = weekDates ? fmtDayDate(weekDates[day]) : ''
      return cell(dateLabel ? `${day}\n${dateLabel}` : day, headerStyle)
    }),
  ])
  rowHeights.push({ hpt: weekDates ? 30 : 20 })

  for (const slot of slots) {
    const timeLabel = `${slot.startTime} – ${slot.endTime}`
    const span = grid[slot.id]?.['__span']
    const r = rows.length

    if (span) {
      rows.push([
        cell(timeLabel, timeStyle),
        cell(span.label || 'Break', spanLabelStyle),
        ...Array(5).fill(cell('', spanLabelStyle)),
      ])
      merges.push({ s: { r, c: 1 }, e: { r, c: 6 } })
      rowHeights.push({ hpt: 22 })
    } else {
      const row = [cell(timeLabel, timeStyle)]
      let hasTeacherLine = false
      for (const day of DAYS) {
        const c = grid[slot.id]?.[day]
        if (!c) { row.push(cell('', bodyStyle)); continue }
        if (c.type === 'class') {
          const m = mappings.find(m => m.id === c.mappingId)
          if (!m) { row.push(cell('', bodyStyle)); continue }
          const subjectText = m.label
          const teacherName = m.teacherId ? (teachers.find(t => t.id === m.teacherId)?.name ?? null) : null
          const text = teacherName ? `${subjectText}\n${teacherName}` : subjectText
          if (teacherName) hasTeacherLine = true
          row.push(cell(text, bodyStyle))
        } else {
          row.push(cell(c.label || 'Break', bodyStyle))
        }
      }
      rows.push(row)
      rowHeights.push({ hpt: hasTeacherLine ? 32 : 22 })
    }
  }

  // Footnotes — append "Notes" header + one row per line
  const footnoteLines = (timetable.footnotes ?? '')
    .split('\n').map(l => l.trim()).filter(Boolean)
  if (footnoteLines.length > 0) {
    const notesHeaderStyle = {
      font: { name: FONT, bold: true, sz: 10 },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border,
    }
    const notesBodyStyle = {
      font: { name: FONT, sz: 10 },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border,
    }
    const headerRow = rows.length
    rows.push([cell('Notes', notesHeaderStyle), ...Array(6).fill(cell('', notesHeaderStyle))])
    merges.push({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: 6 } })
    rowHeights.push({ hpt: 20 })
    footnoteLines.forEach((line, i) => {
      const r = rows.length
      rows.push([cell(`${i + 1}. ${line}`, notesBodyStyle), ...Array(6).fill(cell('', notesBodyStyle))])
      merges.push({ s: { r, c: 0 }, e: { r, c: 6 } })
      rowHeights.push({ hpt: 20 })
    })
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!merges'] = merges
  ws['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }]
  ws['!rows'] = rowHeights

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Timetable')

  // Browser-native download (XLSX.writeFile uses Node's fs which Vite
  // externalises — calling it from the browser throws "Cannot access
  // .writeFileSync in client code").
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  // Its own filename rule, deliberately: it keeps the dot so the .xlsx
  // extension survives, which safeFilename() would strip.
  const name = `${timetable.branch}-${timetable.batchName}-timetable.xlsx`
    .replace(/[^a-z0-9.]+/gi, '-').toLowerCase()
  downloadBlob(blob, name)
}
