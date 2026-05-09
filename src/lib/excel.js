import * as XLSX from 'xlsx'

// Detect exam-level subject by *presence* of a known keyword in the name.
// Returns a value guaranteed to be in the canonical SUBJECTS list.
export function detectSubjectFromName(name) {
  if (!name) return 'Maths'
  if (/\bgat\b/i.test(name)) return 'GAT'
  if (/\bmaths?\b/i.test(name)) return 'Maths'
  return 'Maths'
}

// ============================================================
// PARSE RESULTS EXCEL
// Reads the student responses file from Evalbee/similar
// Returns: { examName, examDate, subject, markCorrect, markWrong,
//            hasNegative, totalQs, students }
// Each student: { name, rollNo, totalMarks, correct, incorrect, notAttempted, responses }
// rollNo is '' when the file has no "Roll No" column.
// ============================================================
export async function parseExcelFull(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })

  // Find header row (contains 'Name')
  let hi = -1
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    if (raw[i]?.some(c => String(c || '').toLowerCase() === 'name')) { hi = i; break }
  }
  if (hi === -1) throw new Error("Cannot find header row with 'Name' column")

  const headers = raw[hi].map(h => String(h || '').trim())
  const idx = l => headers.findIndex(h => h.toLowerCase() === l.toLowerCase())

  const examCol = idx('exam')
  const ni  = idx('name')
  const ri  = idx('roll no')
  const ti  = idx('total marks')
  const ci  = idx('correct answers')
  const ii  = idx('incorrect answers')
  const nai = idx('not attempted')

  const REQUIRED_COLS = ['name', 'total marks', 'correct answers', 'incorrect answers']
  const missing = REQUIRED_COLS.filter(col => idx(col) === -1)
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Check your Excel headers.`)
  }

  // Q columns: "Q N Marks", "Q N Options", "Q N Key"
  const qm = {}, qo = {}, qk = {}
  headers.forEach((h, i) => {
    const m = h.match(/^Q\s+(\d+)\s+Marks$/i);   if (m) qm[parseInt(m[1])] = i
    const o = h.match(/^Q\s+(\d+)\s+Options$/i);  if (o) qo[parseInt(o[1])] = i
    const k = h.match(/^Q\s+(\d+)\s+Key$/i);      if (k) qk[parseInt(k[1])] = i
  })
  const totalQs = Object.keys(qm).length

  // Exam name from first data row
  const firstData = raw[hi + 1] || []
  const rawExamName = examCol >= 0 ? String(firstData[examCol] || '').trim() : ''

  // Detect marking scheme
  const markVals = new Set()
  for (let r = hi + 1; r < raw.length; r++) {
    const row = raw[r]; if (!row || !row[ni]) continue
    Object.values(qm).forEach(ci2 => {
      const v = parseFloat(row[ci2]); if (!isNaN(v)) markVals.add(v)
    })
  }
  const vals = [...markVals].sort((a, b) => a - b)
  const markCorrect = Math.max(...vals, 1)
  const markWrong   = Math.min(...vals, 0)
  const hasNegative = vals.some(v => v < 0)

  // Date from filename
  const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/)
  const examDate = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0]

  // Detect subject by presence of a known keyword.
  // (Old logic stripped the keywords and kept the leftover, which produced
  // garbage like "2" for "NDA Maths Mock 2".)
  const subject = detectSubjectFromName(rawExamName)

  // Answer key per question — sample any data row (key is identical for every student).
  const answerKeys = {}
  const sampleRow = raw.slice(hi + 1).find(r => r && r[ni])
  if (sampleRow) {
    Object.entries(qk).forEach(([qn, ci2]) => {
      const v = String(sampleRow[ci2] ?? '').trim().toUpperCase()
      if (/^[ABCD]$/.test(v)) answerKeys[parseInt(qn)] = v
    })
  }

  // Parse students
  const students = []
  for (let r = hi + 1; r < raw.length; r++) {
    const row = raw[r]; if (!row || !row[ni]) continue
    const tm = row[ti]; if (tm === null || tm === undefined || tm === '') continue
    const responses = {}
    Object.entries(qm).forEach(([qn, ci2]) => {
      const mk = parseFloat(row[ci2])
      const op = row[qo[qn]]
      responses[qn] = (!op || op === '' || op === null) ? 0 : (mk > 0 ? 1 : -1)
    })
    students.push({
      name:         String(row[ni]).trim(),
      rollNo:       ri >= 0 ? String(row[ri] || '').trim() : '',
      totalMarks:   parseFloat(tm) || 0,
      correct:      parseInt(row[ci])  || 0,
      incorrect:    parseInt(row[ii])  || 0,
      notAttempted: parseInt(row[nai]) || 0,
      responses,
    })
  }

  return {
    examName: rawExamName, examDate, subject,
    markCorrect, markWrong: hasNegative ? markWrong : 0,
    hasNegative, totalQs, students, answerKeys,
  }
}

// ============================================================
// PARSE TAGS FILE (XLSX)
// Reads the enriched tags file with columns:
// Q | Chapter | Subtopic | Question | OptionA | OptionB |
// OptionC | OptionD | Answer | Solution
//
// All columns except Q, Chapter, Subtopic are optional —
// the file is backwards compatible with the old 3-column format.
// ============================================================
export async function parseTagsFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })

  if (!rows.length) throw new Error('Tags file is empty')

  // Find header row (first 3 rows)
  let hi = 0
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const r = rows[i].map(c => String(c || '').trim().toLowerCase())
    if (r.some(c => /^q(uestion)?#?$/.test(c)) && r.some(c => c.includes('chapter'))) {
      hi = i; break
    }
  }

  const headers = rows[hi].map(c => String(c || '').trim().toLowerCase())

  // Column indices
  const qi   = headers.findIndex(c => /^q(uestion)?#?$/.test(c))
  const chi  = headers.findIndex(c => c.includes('chapter'))
  const sti  = headers.findIndex(c => c.includes('subtopic') || c.includes('sub topic') || c === 'topic')
  const subi = headers.findIndex(c => c === 'subject')
  const qui  = headers.findIndex(c => c === 'question')
  const oai  = headers.findIndex(c => c === 'optiona' || c === 'option a' || c === 'option_a')
  const obi  = headers.findIndex(c => c === 'optionb' || c === 'option b' || c === 'option_b')
  const oci  = headers.findIndex(c => c === 'optionc' || c === 'option c' || c === 'option_c')
  const odi  = headers.findIndex(c => c === 'optiond' || c === 'option d' || c === 'option_d')
  const ani  = headers.findIndex(c => c === 'answer')
  const soli = headers.findIndex(c => c === 'solution')
  const difi = headers.findIndex(c => c.includes('difficulty'))

  if (qi < 0)  throw new Error('Could not find "Q" column')
  if (chi < 0) throw new Error('Could not find "Chapter" column')

  const tags = []
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row[qi] === undefined || row[qi] === '') continue
    const qNum = parseInt(row[qi])
    if (isNaN(qNum)) continue

    tags.push({
      q:          qNum,
      subject:    cell(row, subi),   // null when column absent — per-tag subject override
      chapter:    cell(row, chi) || 'Unknown',
      subtopic:   cell(row, sti) || 'General',
      // Enriched columns (optional — null if not present)
      question:   cell(row, qui),
      optionA:    cell(row, oai),
      optionB:    cell(row, obi),
      optionC:    cell(row, oci),
      optionD:    cell(row, odi),
      answer:     cell(row, ani)?.toUpperCase() || null,
      solution:   cell(row, soli),
      difficulty: cell(row, difi),   // 'Easy' | 'Moderate' | 'Hard' | null
    })
  }

  if (!tags.length) throw new Error('No valid rows found in tags file')
  tags.sort((a, b) => a.q - b.q)
  return tags
}

// ============================================================
// PARSE STUDENTS EXCEL
// Reads the LWS student list exported from EIS.
// Row 0 is a title row; row 1 is headers; rows 2+ are data.
//
// Returns an array of student objects ready for mergeStudents():
// { eis_reg_no, canonical_name, gender, dob, mobile, email,
//   batches, coming_status, account_status, registration_date, quit_date }
// ============================================================
export async function parseStudentsExcel(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })

  if (raw.length < 3) throw new Error('Student Excel file appears empty')

  // Row 1 (index 1) is headers; row 0 is the title
  const headers = raw[1].map(h => String(h || '').trim())
  const idx = label => headers.findIndex(h => h === label)

  const cols = {
    eisRegNo:      idx('RegistrationNo.'),
    name:          idx('Name'),
    gender:        idx('Gender'),
    dob:           idx('DOB'),
    mobile:        idx('Mobile No'),
    email:         idx('Email'),
    batch:         idx('Batch'),
    branch:        idx('Branch'),
    comingStatus:  idx('Coming Status'),
    accountStatus: idx('Account Status'),
    regDate:       idx('RegistrationDate'),
    quitDate:      idx('Quit Date'),
    guardianMobile: idx('Guardian No.'),
  }

  if (cols.name < 0)     throw new Error('Could not find "Name" column in student Excel')
  if (cols.eisRegNo < 0) throw new Error('Could not find "RegistrationNo." column in student Excel')

  const rows = []
  for (let r = 2; r < raw.length; r++) {
    const row = raw[r]
    if (!row) continue
    const name = cols.name >= 0 ? String(row[cols.name] || '').trim() : ''
    if (!name) continue

    rows.push({
      eis_reg_no:        String(row[cols.eisRegNo] || '').trim(),
      canonical_name:    name,
      gender:            cols.gender        >= 0 ? String(row[cols.gender]        || '').trim() : '',
      dob:               parseStudentDate(row[cols.dob]),
      mobile:            cols.mobile        >= 0 ? String(row[cols.mobile]        || '').trim() : '',
      email:             cols.email         >= 0 ? String(row[cols.email]         || '').trim() : '',
      batches:           parseBatchCell(row[cols.batch]),
      branch:            cols.branch        >= 0 ? String(row[cols.branch]        || '').trim() : '',
      coming_status:     cols.comingStatus   >= 0 ? String(row[cols.comingStatus]   || '').trim() : '',
      account_status:    cols.accountStatus  >= 0 ? String(row[cols.accountStatus]  || '').trim() : '',
      registration_date: parseStudentDate(row[cols.regDate]),
      quit_date:         parseStudentDate(row[cols.quitDate]),
      guardian_mobile:   cols.guardianMobile >= 0 ? String(row[cols.guardianMobile] || '').trim() : '',
    })
  }

  if (!rows.length) throw new Error('No valid student rows found in file')
  return rows
}

// ── Helpers (also exported for testing) ─────────────────────

/** DD/MM/YYYY → YYYY-MM-DD. Returns null for empty/unrecognised values. */
export function parseStudentDate(val) {
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s   // already ISO or unknown — pass through
}

/** Wrap a single batch string in an array; return [] for blank. */
function parseBatchCell(val) {
  if (val === null || val === undefined || val === '') return []
  const s = String(val).trim()
  return s ? [s] : []
}

// ============================================================
// PARSE ATTENDANCE EXCEL
// LWS/EISM attendance export format:
//   Row 0: title, Row 1: headers, Row 2+: student data
// Date columns have DD-MM-YYYY headers; values are P, A, or -
// Returns: { students: [{ name, mobile, dates: { 'YYYY-MM-DD': 'P'|'A' } }] }
// ============================================================
export async function parseAttendanceExcel(file) {
  const buf = await file.arrayBuffer()
  const wb  = XLSX.read(buf, { type: 'array' })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })

  if (raw.length < 3) throw new Error('Attendance file appears empty')

  const headers = raw[1].map(h => String(h || '').trim())
  const nameIdx   = headers.findIndex(h => h === 'Student Name')
  const mobileIdx = headers.findIndex(h => h === 'Mobile No.')

  if (nameIdx < 0) throw new Error('Cannot find "Student Name" column in attendance file')

  // Identify date columns: headers matching DD-MM-YYYY
  const dateColPattern = /^(\d{2})-(\d{2})-(\d{4})$/
  const dateCols = headers
    .map((h, i) => {
      const m = h.match(dateColPattern)
      if (!m) return null
      return { colIdx: i, isoDate: `${m[3]}-${m[2]}-${m[1]}` }
    })
    .filter(Boolean)

  const students = []
  for (let r = 2; r < raw.length; r++) {
    const row  = raw[r]
    if (!row) continue
    const name = String(row[nameIdx] || '').trim()
    if (!name) continue

    const mobile = mobileIdx >= 0 ? String(row[mobileIdx] || '').trim() : ''
    const dates  = {}
    for (const { colIdx, isoDate } of dateCols) {
      const val = String(row[colIdx] || '').trim()
      if (val === 'P' || val === 'A') dates[isoDate] = val
    }
    students.push({ name, mobile, dates })
  }

  return { students }
}

// ── Helper ───────────────────────────────────────────────────
function cell(row, idx) {
  if (idx < 0 || row[idx] === undefined || row[idx] === null || row[idx] === '') return null
  return String(row[idx]).trim()
}
