// The nightly attendance report: EIS's "Punch Monitor" export → one WhatsApp
// per LWS Pune student (and each parent) with the day's in and out times.
//
// Replaces a Jupyter notebook that clicked through EIS with pyautogui and sent
// from the same Wabridge account. Three of its habits are deliberately NOT
// carried over: it read "Recent Punch" as the out time (a student who punched
// once got "In 10:34, Out 10:34"), it sent a repeated registration number
// twice, and it sent to one number from a separate Student Search download.
//
// Pure and dependency-light: api/send-attendance-alerts.js imports
// `reportTimes` so the preview and the message cannot disagree, which means
// relative imports here need their file extensions (Node ESM).

import { isBlockedStatus } from './accountStatus.js'

export const ATTENDANCE_REPORT_BRANCH = 'LWS Pune'

// Students per request. The browser sends in groups so no single call outlives
// the serverless function; the endpoint refuses a bigger group.
export const ATTENDANCE_REPORT_GROUP = 25

// The template variables a parent reads when there is no time to show.
export const ABSENT = 'Absent'
export const NOT_PUNCHED_IN = 'Not punched in'
export const NOT_PUNCHED_OUT = 'Not punched out'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

const REQUIRED = {
  regNo:   'Reg No.',
  name:    'Name',
  inTime:  'In Time',
  outTime: 'Out Time',
  status:  'Att Status',
}

const text = v => String(v ?? '').replace(/\s+/g, ' ').trim()

// "Punch_Monitor_list_23 Oct 2026" → "2026-10-23", or null.
function dateFromTitle(title) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/.exec(text(title))
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return null
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

// A number cell (250522204) and a text cell ('250522204') are the same id.
function regNoOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : ''
  return text(v).replace(/\.0+$/, '')
}

/**
 * Read the sheet as an array of rows (SheetJS `header: 1`).
 *
 * @returns {{ date: string|null, rows: Array<{regNo,name,batch,status,inTime,outTime}>, duplicates: string[] }}
 *   `date` comes from the title row: the report's day, which is not always
 *   today. A repeated registration number keeps its first row and is listed in
 *   `duplicates`, so one family is never messaged twice.
 */
export function parsePunchSheet(matrix) {
  const raw = Array.isArray(matrix) ? matrix : []
  const headerIdx = raw.findIndex(r => Array.isArray(r) && r.some(c => text(c) === REQUIRED.regNo))
  if (headerIdx < 0) throw new Error(`Cannot find the "${REQUIRED.regNo}" header — is this the Punch Monitor export?`)

  const headers = raw[headerIdx].map(text)
  const col = {}
  for (const [key, label] of Object.entries(REQUIRED)) {
    col[key] = headers.indexOf(label)
    if (col[key] < 0) throw new Error(`Cannot find the "${label}" column in the punch file`)
  }
  col.batch = headers.indexOf('Batch')

  const title = raw.slice(0, headerIdx).flat().map(text).find(Boolean) ?? ''
  const rows = []
  const duplicates = []
  const seen = new Set()
  for (const r of raw.slice(headerIdx + 1)) {
    if (!Array.isArray(r)) continue
    const regNo = regNoOf(r[col.regNo])
    // Footer lines ("Note : Total 96 records…") carry text in the first cell
    // only, so they never yield a registration number.
    if (!/^\d+$/.test(regNo)) continue
    if (seen.has(regNo)) { duplicates.push(regNo); continue }
    seen.add(regNo)
    rows.push({
      regNo,
      name:    text(r[col.name]),
      batch:   col.batch >= 0 ? text(r[col.batch]) : '',
      status:  text(r[col.status]).toUpperCase(),
      inTime:  text(r[col.inTime]),
      outTime: text(r[col.outTime]),
    })
  }
  return { date: dateFromTitle(title), rows, duplicates }
}

// "8:05 am" → "8:05 AM"; anything that is not a clock time → ''. What reaches
// a template variable is a time or one of the fixed words above, nothing else.
function clock(v) {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(text(v))
  return m ? `${m[1]}:${m[2]} ${m[3].toUpperCase()}` : ''
}

/** The two time variables of the message. Shared by the preview and the sender. */
export function reportTimes({ status, inTime, outTime } = {}) {
  if (text(status).toUpperCase() !== 'P') return { inText: ABSENT, outText: ABSENT }
  return {
    inText:  clock(inTime) || NOT_PUNCHED_IN,
    outText: clock(outTime) || NOT_PUNCHED_OUT,
  }
}

/**
 * Pair file rows with tracker students by EIS registration number.
 *
 * Only `ready` rows are sent. The rest are listed in the preview so the office
 * can see who is left out and why: not in the tracker (or two records share
 * the number — never guessed), not an LWS Pune student, or blocked.
 *
 * @param {Array} rows        parsePunchSheet().rows
 * @param {Array} studentList the store's raw snake_case students
 */
export function matchPunchRows(rows, studentList) {
  const byReg = new Map()
  for (const s of studentList || []) {
    const reg = regNoOf(s?.eis_reg_no)
    if (!reg) continue
    if (!byReg.has(reg)) byReg.set(reg, [])
    byReg.get(reg).push(s)
  }

  const ready = [], unmatched = [], otherBranch = [], blocked = []
  for (const row of rows || []) {
    const hits = byReg.get(row.regNo) || []
    if (hits.length !== 1) {
      unmatched.push({ ...row, reason: hits.length ? `${hits.length} students share this Reg No.` : 'Not in the tracker' })
      continue
    }
    const s = hits[0]
    const entry = {
      lwsId: s.lws_id,
      name: text(s.canonical_name) || row.name,
      regNo: row.regNo,
      status: row.status,
      inTime: row.inTime,
      outTime: row.outTime,
      ...reportTimes(row),
      mobile: s.mobile || '',
      parentMobiles: s.parent_mobiles || [],
    }
    if (s.branch !== ATTENDANCE_REPORT_BRANCH) otherBranch.push({ ...entry, branch: s.branch || '' })
    else if (isBlockedStatus(s.account_status)) blocked.push(entry)
    else ready.push(entry)
  }
  return { ready, unmatched, otherBranch, blocked }
}
