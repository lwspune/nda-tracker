import { describe, it, expect } from 'vitest'
import { parseClassSheet, buildUnitTestExams, makeNameResolver } from '../unitTest1Import'

// A miniature of the real workbook's shape: row 0 carries the per-subject max
// in the subject columns, row 1 the headers, row 2+ the students. Columns 0-2
// are Sr. No. / Name / Class; the subject block runs until Total.
const ROWS = [
  ['', 'Max Marks', '', 25, 25, 25, '', ''],
  ['Sr. No.', 'Name', 'Class', 'Physics', 'English', 'Maths', 'Total', 'Percentage'],
  [1, 'Asha Kale', '11th', 20, 18, 15, 53, 0.7],
  [2, 'Bhavesh Rao', '11th', 0, 0, 0, 0, 0],
  [3, 'Chetan Naik', '11th', 12, '', 'Absent', 12, 0.16],
]

const PAPERS = [
  { column: 'Physics', subject: 'Physics', date: '2026-08-10' },
  { column: 'English', subject: 'English', date: '2026-08-10' },
  { column: 'Maths',   subject: 'Maths',   date: '2026-08-12' },
]

const CONFIG = {
  cls: '11th',
  batch: 'APJ_NDA_11th_(26-27)_A, APJ_NDA_11th_(26-27)_B',
  branch: 'APJ',
  maxMarks: 25,
  papers: PAPERS,
}

// Identity resolver — every sheet name is already canonical.
const resolveAll = n => n

describe('parseClassSheet', () => {
  it('reads the subject block and stops at Total', () => {
    const { subjects } = parseClassSheet(ROWS)
    expect(subjects.map(s => s.name)).toEqual(['Physics', 'English', 'Maths'])
    expect(subjects.map(s => s.max)).toEqual([25, 25, 25])
  })

  it('returns one entry per named student, keyed by column name', () => {
    const { students } = parseClassSheet(ROWS)
    expect(students).toHaveLength(3)
    expect(students[0]).toEqual({ name: 'Asha Kale', marks: { Physics: 20, English: 18, Maths: 15 } })
  })

  it('keeps blank and non-numeric cells raw so the builder can tell them apart', () => {
    const { students } = parseClassSheet(ROWS)
    expect(students[2].marks).toEqual({ Physics: 12, English: '', Maths: 'Absent' })
  })

  it('ignores stray data pasted to the right of the subject block', () => {
    const rows = ROWS.map(r => [...r])
    rows[2] = [1, 'Asha Kale', '11th', 20, 18, 15, 53, 0.7, 99, 'Asha Kale', 77]
    const { students } = parseClassSheet(rows)
    expect(students[0].marks).toEqual({ Physics: 20, English: 18, Maths: 15 })
  })

  it('skips rows with no name', () => {
    const rows = [...ROWS, ['', '', '', '', '', '']]
    expect(parseClassSheet(rows).students).toHaveLength(3)
  })
})

describe('buildUnitTestExams', () => {
  it('builds one offline exam per paper', () => {
    const { exams } = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolveAll })
    expect(exams).toHaveLength(3)
    const phy = exams.find(e => e.subject === 'Physics')
    expect(phy).toMatchObject({
      id: 'exam_ut1_11th_physics',
      name: 'Unit Test 1: Physics (11th)',
      date: '2026-08-10',
      subject: 'Physics',
      batch: 'APJ_NDA_11th_(26-27)_A, APJ_NDA_11th_(26-27)_B',
      branch: 'APJ',
      maxMarks: 25,
      questions: [],
    })
  })

  it('ids are stable across runs so a re-run updates instead of duplicating', () => {
    const a = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolveAll }).exams
    const b = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolveAll }).exams
    expect(a.map(e => e.id)).toEqual(b.map(e => e.id))
  })

  it('produces the offline student-row shape', () => {
    const { exams } = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolveAll })
    const row = exams.find(e => e.subject === 'Physics').students.find(s => s.name === 'Asha Kale')
    expect(row).toEqual({
      name: 'Asha Kale', rollNo: '', totalMarks: 20,
      correct: 0, incorrect: 0, notAttempted: 0, responses: {},
    })
  })

  // A blank means "did not appear" on every offline path in this app; a
  // non-numeric cell ("Absent") means the same thing said out loud.
  it('omits blank and non-numeric cells rather than scoring them 0', () => {
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolveAll })
    const eng = exams.find(e => e.subject === 'English')
    const maths = exams.find(e => e.subject === 'Maths')
    expect(eng.students.map(s => s.name)).not.toContain('Chetan Naik')
    expect(maths.students.map(s => s.name)).not.toContain('Chetan Naik')
    expect(report.nonNumeric).toEqual([
      { cls: '11th', name: 'Chetan Naik', column: 'Maths', value: 'Absent' },
    ])
  })

  // Evalbee-style grading is not in play here, but the paper ceiling still is:
  // a mark above it is a data error, and guessing at the real value is worse
  // than leaving the cell out for faculty to fill via Edit marks.
  it('omits marks above the paper ceiling and reports them', () => {
    const rows = ROWS.map(r => [...r])
    rows[2][5] = 31                                  // Asha Kale, Maths, max 25
    const { exams, report } = buildUnitTestExams({ rows, config: CONFIG, resolveName: resolveAll })
    const maths = exams.find(e => e.subject === 'Maths')
    expect(maths.students.map(s => s.name)).not.toContain('Asha Kale')
    expect(report.overMax).toEqual([
      { cls: '11th', name: 'Asha Kale', column: 'Maths', value: 31, max: 25 },
    ])
    // and only that one cell — her Physics mark still lands
    expect(exams.find(e => e.subject === 'Physics').students.map(s => s.name)).toContain('Asha Kale')
  })

  it('keeps a genuine 0 that sits among real marks', () => {
    const rows = ROWS.map(r => [...r])
    rows[2][5] = 0                                   // Asha Kale scored 0 in Maths
    const { exams } = buildUnitTestExams({ rows, config: CONFIG, resolveName: resolveAll })
    const maths = exams.find(e => e.subject === 'Maths')
    expect(maths.students.find(s => s.name === 'Asha Kale').totalMarks).toBe(0)
  })

  // The absence calls are faculty decisions, so they are explicit config — NOT
  // a "mostly zeros" heuristic, which would also swallow a real 0 like the one
  // above and would be invisible in the dry run.
  it('skipAll drops a student from every paper in the class', () => {
    const config = { ...CONFIG, skipAll: ['Bhavesh Rao'] }
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    for (const e of exams) expect(e.students.map(s => s.name)).not.toContain('Bhavesh Rao')
    expect(report.skippedAll).toEqual([{ cls: '11th', name: 'Bhavesh Rao', papers: 3 }])
  })

  it('skipZeros drops only that student\'s 0 cells, keeping their real marks', () => {
    const rows = ROWS.map(r => [...r])
    rows[3] = [2, 'Bhavesh Rao', '11th', 0, 0, 8, 8, 0.1]
    const config = { ...CONFIG, skipZeros: ['Bhavesh Rao'] }
    const { exams, report } = buildUnitTestExams({ rows, config, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Physics').students.map(s => s.name)).not.toContain('Bhavesh Rao')
    expect(exams.find(e => e.subject === 'Maths').students.find(s => s.name === 'Bhavesh Rao').totalMarks).toBe(8)
    expect(report.skippedZeros).toEqual([{ cls: '11th', name: 'Bhavesh Rao', papers: 2 }])
  })

  // The sheet is not always right. A faculty-confirmed correction replaces the
  // cell value BEFORE the ceiling check, so a mark the sheet recorded as
  // impossible (31/25) can be restored to the real one rather than dropped.
  // Recorded here, not patched into the database directly: this import deletes
  // and re-inserts an exam's results, so a correction that lives only in the DB
  // would be erased by the next re-run.
  it('markOverrides replaces a sheet value and reports the correction', () => {
    const rows = ROWS.map(r => [...r])
    rows[2][5] = 31                                  // Asha Kale, Maths, max 25
    const config = { ...CONFIG, markOverrides: { 'Asha Kale': { Maths: 21 } } }
    const { exams, report } = buildUnitTestExams({ rows, config, resolveName: resolveAll })

    const maths = exams.find(e => e.subject === 'Maths')
    expect(maths.students.find(s => s.name === 'Asha Kale').totalMarks).toBe(21)
    expect(report.overMax).toEqual([])
    expect(report.corrected).toEqual([
      { cls: '11th', name: 'Asha Kale', column: 'Maths', from: 31, to: 21 },
    ])
  })

  it('markOverrides touches only the named paper', () => {
    const config = { ...CONFIG, markOverrides: { 'Asha Kale': { Maths: 21 } } }
    const { exams } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Physics').students.find(s => s.name === 'Asha Kale').totalMarks).toBe(20)
  })

  // A correction is a claim about a real mark, so it must still be a real mark.
  it('still rejects an override that is itself above the ceiling', () => {
    const config = { ...CONFIG, markOverrides: { 'Asha Kale': { Maths: 99 } } }
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Maths').students.map(s => s.name)).not.toContain('Asha Kale')
    expect(report.overMax).toHaveLength(1)
  })

  // An override for someone who did not sit the paper would silently invent a
  // result row; it corrects a value, it does not create one.
  it('does not resurrect a student who is skipped entirely', () => {
    const config = {
      ...CONFIG,
      skipAll: ['Bhavesh Rao'],
      markOverrides: { 'Bhavesh Rao': { Maths: 10 } },
    }
    const { exams } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Maths').students.map(s => s.name)).not.toContain('Bhavesh Rao')
  })

  it('skipPapers drops one named paper for one student only', () => {
    const config = { ...CONFIG, skipPapers: { 'Asha Kale': ['Maths'] } }
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Maths').students.map(s => s.name)).not.toContain('Asha Kale')
    expect(exams.find(e => e.subject === 'Physics').students.map(s => s.name)).toContain('Asha Kale')
    expect(report.skippedPapers).toEqual([{ cls: '11th', name: 'Asha Kale', column: 'Maths' }])
  })

  // Writing the canonical name is what stops the import minting a new spelling
  // variant the dedup machinery then has to reconcile.
  it('writes the resolved canonical name, not the sheet spelling', () => {
    const resolve = n => (n === 'Asha Kale' ? 'Asha Ramesh Kale' : n)
    const { exams } = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolve })
    const names = exams.find(e => e.subject === 'Physics').students.map(s => s.name)
    expect(names).toContain('Asha Ramesh Kale')
    expect(names).not.toContain('Asha Kale')
  })

  it('reports an unresolvable name instead of filing it under the sheet spelling', () => {
    const resolve = n => (n === 'Chetan Naik' ? null : n)
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config: CONFIG, resolveName: resolve })
    for (const e of exams) expect(e.students.map(s => s.name)).not.toContain('Chetan Naik')
    expect(report.unmatched).toEqual([{ cls: '11th', name: 'Chetan Naik' }])
  })

  // A renamed or added column would otherwise vanish silently — the sheet has
  // one column per timetable slot, so an unmapped one means a missing exam.
  it('reports a sheet column with no configured paper', () => {
    const config = { ...CONFIG, papers: PAPERS.slice(0, 2) }
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams).toHaveLength(2)
    expect(report.unmappedColumns).toEqual([{ cls: '11th', column: 'Maths' }])
  })

  it('reports a configured paper with no matching sheet column', () => {
    const config = { ...CONFIG, papers: [...PAPERS, { column: 'Biology', subject: 'Biology', date: '2026-08-13' }] }
    const { report } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(report.missingColumns).toEqual([{ cls: '11th', column: 'Biology' }])
  })

  it('an exam nobody sat is still built, with zero result rows', () => {
    const rows = ROWS.map(r => [...r])
    rows.forEach((r, i) => { if (i >= 2) r[5] = '' })
    const { exams } = buildUnitTestExams({ rows, config: CONFIG, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Maths').students).toEqual([])
  })

  // The same importer serves every school exam on this sheet layout. The exam
  // key and label are what keep Term 1's papers from overwriting Unit Test 1's.
  it('takes the exam key and label from config, defaulting to Unit Test 1', () => {
    const config = { ...CONFIG, examKey: 'term1', examLabel: 'Term 1' }
    const { exams } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams.find(e => e.subject === 'Physics')).toMatchObject({
      id: 'exam_term1_11th_physics',
      name: 'Term 1: Physics (11th)',
    })
  })

  it('reads each paper\'s own max from the sheet, half marks included', () => {
    const rows = [
      ['', 'Max Marks', '', 80, 40, '', ''],
      ['Sr. No.', 'Name', 'Class', 'English', 'Geography', 'Total', 'Percentage'],
      [1, 'Asha Kale', '9th', 79.5, 37.5, 117, 0.97],
    ]
    const config = {
      ...CONFIG, cls: '9th', maxMarks: 20,
      papers: [
        { column: 'English',   subject: 'English',   date: '2026-10-12' },
        { column: 'Geography', subject: 'Geography', date: '2026-10-16' },
      ],
    }
    const { exams } = buildUnitTestExams({ rows, config, resolveName: resolveAll })
    expect(exams.map(e => [e.maxMarks, e.students[0].totalMarks])).toEqual([[80, 79.5], [40, 37.5]])
  })

  // `Number('')` is 0, so a blank Max Marks cell read naively becomes a 0-mark
  // paper and every real mark on it is dropped as over the max.
  it('a blank max cell falls back to the class maxMarks', () => {
    const rows = ROWS.map(r => [...r])
    rows[0][5] = ''                                  // Maths max left blank
    const { exams, report } = buildUnitTestExams({ rows, config: CONFIG, resolveName: resolveAll })
    const maths = exams.find(e => e.subject === 'Maths')
    expect(maths.maxMarks).toBe(25)
    expect(maths.students.find(s => s.name === 'Asha Kale').totalMarks).toBe(15)
    expect(report.overMax).toEqual([])
  })

  // A column the school has not filled yet (or a paper the class does not take)
  // is named in config rather than mapped to an empty exam, so the student sees
  // no blank paper in their history. If it ever does carry marks, saying so is
  // what stops a re-run from silently leaving them behind.
  it('noExamColumns builds no exam, is not reported unmapped, and counts any marks', () => {
    const config = { ...CONFIG, papers: PAPERS.slice(0, 2), noExamColumns: { Maths: 'marks not in yet' } }
    const { exams, report } = buildUnitTestExams({ rows: ROWS, config, resolveName: resolveAll })
    expect(exams.map(e => e.subject)).toEqual(['Physics', 'English'])
    expect(report.unmappedColumns).toEqual([])
    // Asha 15 and Bhavesh 0 are marks; Chetan's "Absent" is not
    expect(report.noExam).toEqual([{ cls: '11th', column: 'Maths', reason: 'marks not in yet', marks: 2 }])
  })

  it('a noExamColumns column that is empty reports zero marks', () => {
    const rows = ROWS.map((r, i) => (i >= 2 ? [...r.slice(0, 5), '', ...r.slice(6)] : r))
    const config = { ...CONFIG, papers: PAPERS.slice(0, 2), noExamColumns: { Maths: 'not offered' } }
    const { report } = buildUnitTestExams({ rows, config, resolveName: resolveAll })
    expect(report.noExam).toEqual([{ cls: '11th', column: 'Maths', reason: 'not offered', marks: 0 }])
  })
})

// The Term 1 sheet spells students in full ("Sarthak Santosh Datkhile") where
// the records hold the short form ("Sarthak Datkhile"), so an exact match finds
// almost nobody. The resolver accepts a stored name whose every word appears in
// the sheet name, but only when exactly one student in the class qualifies.
describe('makeNameResolver', () => {
  const ROSTER = [
    { canonical: 'Sarthak Datkhile', names: ['Sarthak Datkhile'] },
    { canonical: 'Sai Mane',         names: ['Sai Mane'] },
    { canonical: 'Pratik Mane',      names: ['Pratik Mane', 'Pratik S Mane'] },
    { canonical: 'Anavita kharat',   names: ['Anavita kharat'] },
    { canonical: 'Neel Wardhamane',  names: ['Neel Wardhamane'] },
    { canonical: 'Neel Ugale',       names: ['Neel Ugale'] },
  ]

  it('matches exactly after normalising case and punctuation', () => {
    const resolve = makeNameResolver({ roster: ROSTER })
    expect(resolve('sarthak  DATKHILE')).toBe('Sarthak Datkhile')
  })

  it('matches a full name that contains every word of one stored name', () => {
    const resolve = makeNameResolver({ roster: ROSTER })
    expect(resolve('Sarthak Santosh Datkhile')).toBe('Sarthak Datkhile')
    expect(resolve('Sai Sachinkumar Mane')).toBe('Sai Mane')
  })

  it('matches through a name variant', () => {
    const resolve = makeNameResolver({ roster: ROSTER })
    expect(resolve('Pratik S Mane')).toBe('Pratik Mane')
  })

  it('refuses when two students qualify rather than picking one', () => {
    const roster = [...ROSTER, { canonical: 'Sai Patil', names: ['Sai Patil'] }]
    const resolve = makeNameResolver({ roster })
    expect(resolve('Sai Mane Patil')).toBeNull()
  })

  // A one-word stored name would match any sheet name containing that word.
  it('never matches on a single word', () => {
    const resolve = makeNameResolver({ roster: ROSTER })
    expect(resolve('Neel')).toBeNull()
  })

  it('returns null for a name nobody in the class carries', () => {
    const resolve = makeNameResolver({ roster: ROSTER })
    expect(resolve('Anvita Kiran Kharat')).toBeNull()
  })

  it('an alias wins over the roster, and may name someone outside it', () => {
    const resolve = makeNameResolver({
      roster: ROSTER,
      aliases: { 'Neel': 'Neel Wardhamane', 'Manas Mangesh Bakde': 'Manas Bakde' },
    })
    expect(resolve('Neel')).toBe('Neel Wardhamane')
    expect(resolve('Manas Mangesh Bakde')).toBe('Manas Bakde')
  })
})
