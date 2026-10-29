// Turn an APJ unit-test marks workbook into offline exam objects.
//
// The school runs one paper per timetable slot and reports the whole class in a
// single wide sheet — one column per subject, one row per student. The app
// stores one exam per paper, so this transposes: N subject columns → N exams,
// each carrying only the students who actually sat it.
//
// Marks are TOTALS with no per-question data, so every exam is offline in this
// app's sense (`questions: []` + an explicit `maxMarks`) — see the offline
// upload rules in CLAUDE.md.
//
// Pure: no fetch, no store, no xlsx. The migration script supplies the parsed
// rows and a name resolver, and performs the writes.

// A cell that is blank, or that holds something non-numeric ("Absent"), means
// the student did not appear. That is the same rule `buildOfflineStudentRows`
// uses on the in-app grid, and it is what feeds absentee flagging: a row is
// omitted entirely rather than scored 0.
function readMark(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return { kind: 'blank' }
  const n = Number(s)
  if (!Number.isFinite(n)) return { kind: 'nonNumeric', value: s }
  return { kind: 'mark', value: n }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Wide sheet → { subjects, students }.
//
// Row 0 carries each subject's max in the subject columns, row 1 the headers,
// row 2+ the students. The subject block starts at column 3 (after Sr. No. /
// Name / Class) and ends at Total — everything past it is the sheet's own
// arithmetic, plus, in this workbook, fragments of duplicated rows pasted to
// the right of two students. Bounding the read at Total is what keeps that
// stray data out.
export function parseClassSheet(rows) {
  const maxRow = rows?.[0] ?? []
  const header = rows?.[1] ?? []

  const subjects = []
  for (let c = 3; c < header.length; c++) {
    const name = String(header[c] ?? '').trim()
    if (!name || name === 'Total' || name === 'Percentage') break
    // Blank → NaN, not Number('') === 0, so the builder falls back to the
    // class max instead of building a 0-mark paper.
    const rawMax = String(maxRow[c] ?? '').trim()
    subjects.push({ name, col: c, max: rawMax === '' ? NaN : Number(rawMax) })
  }

  const students = []
  for (const row of (rows ?? []).slice(2)) {
    const name = String(row?.[1] ?? '').trim()
    if (!name) continue
    const marks = {}
    for (const s of subjects) marks[s.name] = row[s.col] ?? ''
    students.push({ name, marks })
  }

  return { subjects, students }
}

// { rows, config, resolveName } → { exams, report }.
//
// config — { cls, batch, branch, maxMarks, papers[], skipAll?, skipZeros?, skipPapers? }
//   examKey     id segment, `exam_<examKey>_<cls>_<paper>` (default 'ut1').
//   examLabel   name prefix, `<examLabel>: <paper> (<cls>)` (default 'Unit Test 1').
//               Together they keep one school exam from overwriting another.
//   papers      [{ column, subject, date }] — one per timetable slot. The column
//               name is the join key to the sheet header.
//   noExamColumns { column: reason } — sheet columns that build no exam: marks
//               not entered yet, or a paper the class does not take. Each is
//               reported with how many marks it holds, so a column that fills in
//               later cannot be left behind silently.
//   skipAll     names recorded as absent from every paper in the class.
//   skipZeros   names whose 0 cells are absences; their non-zero marks still land.
//   skipPapers  { name: [column, …] } — absent from those papers only.
//
// The three skip lists are explicit faculty decisions, deliberately not inferred
// from the marks: a "mostly zeros means absent" heuristic would also swallow a
// genuine 0 scored among real marks, and would do it invisibly.
//
// resolveName — sheet spelling → canonical name, or null when unknown. Writing
// the canonical name is what stops the import minting a new spelling variant.
export function buildUnitTestExams({ rows, config, resolveName }) {
  const { subjects, students } = parseClassSheet(rows)
  const cls = config.cls
  const papers = config.papers ?? []

  const skipAll    = new Set(config.skipAll ?? [])
  const skipZeros  = new Set(config.skipZeros ?? [])
  const skipPapers = config.skipPapers ?? {}
  const overrides  = config.markOverrides ?? {}
  const noExam     = config.noExamColumns ?? {}
  const examKey    = config.examKey ?? 'ut1'
  const examLabel  = config.examLabel ?? 'Unit Test 1'

  const report = {
    unmatched: [], nonNumeric: [], overMax: [], corrected: [],
    skippedAll: [], skippedZeros: [], skippedPapers: [],
    unmappedColumns: [], missingColumns: [], noExam: [],
  }

  // A column the sheet has but no paper claims would silently become a missing
  // exam; a paper whose column is absent would silently become an empty one.
  // Both are reported rather than assumed benign.
  const byColumn = new Map(papers.map(p => [p.column, p]))
  for (const s of subjects) {
    if (byColumn.has(s.name)) continue
    if (s.name in noExam) {
      const marks = students.filter(st => readMark(st.marks[s.name]).kind === 'mark').length
      report.noExam.push({ cls, column: s.name, reason: noExam[s.name], marks })
    } else {
      report.unmappedColumns.push({ cls, column: s.name })
    }
  }
  const present = new Set(subjects.map(s => s.name))
  for (const p of papers) {
    if (!present.has(p.column)) report.missingColumns.push({ cls, column: p.column })
  }

  const skippedAllCount   = new Map()
  const skippedZerosCount = new Map()

  const exams = []
  for (const paper of papers) {
    const subject = subjects.find(s => s.name === paper.column)
    if (!subject) continue
    const max = Number.isFinite(subject.max) ? subject.max : config.maxMarks

    const studentRows = []
    for (const st of students) {
      const canonical = resolveName(st.name)
      if (!canonical) continue                       // reported once, below

      if (skipAll.has(st.name)) {
        skippedAllCount.set(st.name, (skippedAllCount.get(st.name) ?? 0) + 1)
        continue
      }
      if ((skipPapers[st.name] ?? []).includes(paper.column)) {
        report.skippedPapers.push({ cls, name: st.name, column: paper.column })
        continue
      }

      // Applied AFTER the skip lists (a correction must not resurrect someone
      // recorded as absent) and BEFORE the ceiling check (its whole purpose is
      // to replace a value the sheet got wrong, including an impossible one).
      const override = overrides[st.name]?.[paper.column]
      let cell = readMark(st.marks[paper.column])
      if (override !== undefined) {
        const before = cell.kind === 'mark' ? cell.value : String(st.marks[paper.column] ?? '')
        report.corrected.push({ cls, name: st.name, column: paper.column, from: before, to: override })
        cell = readMark(override)
      }

      if (cell.kind === 'blank') continue
      if (cell.kind === 'nonNumeric') {
        report.nonNumeric.push({ cls, name: st.name, column: paper.column, value: cell.value })
        continue
      }
      if (cell.value > max) {
        report.overMax.push({ cls, name: st.name, column: paper.column, value: cell.value, max })
        continue
      }
      if (cell.value === 0 && skipZeros.has(st.name)) {
        skippedZerosCount.set(st.name, (skippedZerosCount.get(st.name) ?? 0) + 1)
        continue
      }

      studentRows.push({
        name: canonical,
        rollNo: '',
        totalMarks: cell.value,
        correct: 0,
        incorrect: 0,
        notAttempted: 0,
        responses: {},
      })
    }

    exams.push({
      // Stable and derived, so a re-run updates the same exam instead of
      // minting a second copy of it.
      id: `exam_${examKey}_${cls}_${slug(paper.column)}`,
      name: `${examLabel}: ${paper.column} (${cls})`,
      date: paper.date,
      subject: paper.subject,
      batch: config.batch,
      branch: config.branch,
      marking: { correct: 1, wrong: 0 },   // inert for offline — maxMarks drives %-of-max
      questions: [],
      maxMarks: max,
      students: studentRows,
    })
  }

  for (const st of students) {
    if (!resolveName(st.name)) report.unmatched.push({ cls, name: st.name })
  }
  for (const [name, n] of skippedAllCount)   report.skippedAll.push({ cls, name, papers: n })
  for (const [name, n] of skippedZerosCount) report.skippedZeros.push({ cls, name, papers: n })

  return { exams, report }
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
const words = s => String(s ?? '').split(/\s+/).map(norm).filter(Boolean)

// { roster, aliases? } → resolveName(sheetName) → canonical name | null.
//
// roster   [{ canonical, names[] }] — the class's students, each with every
//          spelling the app knows (canonical + name_variants). Scope it to the
//          class's batches, so a sheet name cannot land on a same-named student
//          in another class.
// aliases  { sheetName: canonical } — faculty-confirmed spellings. Checked first
//          and NOT scoped by the roster: a student who has since moved branch
//          still sat this class's paper.
//
// Some sheets spell students in full ("Sarthak Santosh Datkhile") where the
// records hold the short form ("Sarthak Datkhile"). After an exact match fails,
// a stored name of two or more words matches when every one of its words is in
// the sheet name. Exactly one student must qualify: two is a refusal, never a
// pick, and a one-word name never qualifies, as it would match too much.
export function makeNameResolver({ roster, aliases = {} }) {
  const exact = new Map()
  for (const st of roster) {
    for (const n of [st.canonical, ...(st.names ?? [])]) exact.set(norm(n), st.canonical)
  }
  return sheetName => {
    if (aliases[sheetName]) return aliases[sheetName]
    const hit = exact.get(norm(sheetName))
    if (hit) return hit
    const sheetWords = new Set(words(sheetName))
    const found = new Set()
    for (const st of roster) {
      for (const n of [st.canonical, ...(st.names ?? [])]) {
        const w = words(n)
        if (w.length >= 2 && w.every(x => sheetWords.has(x))) found.add(st.canonical)
      }
    }
    return found.size === 1 ? [...found][0] : null
  }
}
