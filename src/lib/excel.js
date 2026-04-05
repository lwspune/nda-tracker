import * as XLSX from 'xlsx'

// ============================================================
// PARSE RESULTS EXCEL
// Reads the student responses file from Evalbee/similar
// Returns: { examName, examDate, subject, markCorrect, markWrong,
//            hasNegative, totalQs, students }
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
  const ti  = idx('total marks')
  const ci  = idx('correct answers')
  const ii  = idx('incorrect answers')
  const nai = idx('not attempted')

  // Q columns: "Q N Marks" and "Q N Options"
  const qm = {}, qo = {}
  headers.forEach((h, i) => {
    const m = h.match(/^Q\s+(\d+)\s+Marks$/i);   if (m) qm[parseInt(m[1])] = i
    const o = h.match(/^Q\s+(\d+)\s+Options$/i);  if (o) qo[parseInt(o[1])] = i
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

  // Subject guess
  const subject = rawExamName
    .replace(/quiz|test|mock|exam|maths|math|nda/gi, '')
    .replace(/[-_]/g, ' ').trim()

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
    hasNegative, totalQs, students,
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
  const qui  = headers.findIndex(c => c === 'question')
  const oai  = headers.findIndex(c => c === 'optiona' || c === 'option a' || c === 'option_a')
  const obi  = headers.findIndex(c => c === 'optionb' || c === 'option b' || c === 'option_b')
  const oci  = headers.findIndex(c => c === 'optionc' || c === 'option c' || c === 'option_c')
  const odi  = headers.findIndex(c => c === 'optiond' || c === 'option d' || c === 'option_d')
  const ani  = headers.findIndex(c => c === 'answer')
  const soli = headers.findIndex(c => c === 'solution')

  if (qi < 0)  throw new Error('Could not find "Q" column')
  if (chi < 0) throw new Error('Could not find "Chapter" column')

  const tags = []
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row[qi] === undefined || row[qi] === '') continue
    const qNum = parseInt(row[qi])
    if (isNaN(qNum)) continue

    tags.push({
      q:        qNum,
      chapter:  cell(row, chi) || 'Unknown',
      subtopic: cell(row, sti) || 'General',
      // Enriched columns (optional — null if not present)
      question: cell(row, qui),
      optionA:  cell(row, oai),
      optionB:  cell(row, obi),
      optionC:  cell(row, oci),
      optionD:  cell(row, odi),
      answer:   cell(row, ani)?.toUpperCase() || null,
      solution: cell(row, soli),
    })
  }

  if (!tags.length) throw new Error('No valid rows found in tags file')
  tags.sort((a, b) => a.q - b.q)
  return tags
}

// ── Helper ───────────────────────────────────────────────────
function cell(row, idx) {
  if (idx < 0 || row[idx] === undefined || row[idx] === null || row[idx] === '') return null
  return String(row[idx]).trim()
}
