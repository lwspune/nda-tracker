// Import the APJ "First Term" exam marks (12–21 Oct 2026) as offline exams.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_term_1.js --file <path> [--dry-run]
//
// --file <path>  The school's "Exam Test  Results 2026" Google Sheet, exported
//                as .xlsx (Drive id 1VBgmm5kMdBNYXFJOqafR-srdELoRHIKSqVqKOxjP0mQ).
//                Required: the sheet is still being filled in, so always import
//                a fresh export rather than a stale local copy.
// --dry-run      Plan and print, write nothing.
//
// Same workbook layout as Unit Test 1, so the same importer: one exam per paper,
// totals only (`questions: []` + explicit `max_marks`). Max marks come from the
// sheet's own Max Marks row (80 or 40 in 9th/10th, 50 in 11th/12th). Dates come
// from the First Term timetable, one paper per day.
//
// Papers whose column is still empty are named in `noExamColumns` and build no
// exam. When the school fills one in, the run refuses until it is moved into
// `papers`; a re-run then adds it and replaces the rest unchanged.
//
// The read, plan, report and write live in `scripts/schoolExamImport.js`
// (writes exams + results only, never sends; idempotent).

import { runSchoolExamImport } from './scripts/schoolExamImport.js'

const fileFlag = process.argv.indexOf('--file')
const WORKBOOK = fileFlag !== -1 ? process.argv[fileFlag + 1] : null
if (!WORKBOOK) {
  console.error('Error: --file <path to the exported .xlsx> is required.')
  process.exit(1)
}

const BRANCH = 'APJ'
const TERM = { examKey: 'term1', examLabel: 'Term 1' }

const CLASSES = [
  {
    ...TERM,
    cls: '9th',
    sheet: '9th Term I',
    batch: 'APJ_NDA_9th_(26-27)',
    branch: BRANCH,
    maxMarks: 80,
    papers: [
      { column: 'English',           subject: 'English',   date: '2026-10-12' },
      { column: 'Marathi',           subject: 'Marathi',   date: '2026-10-13' },
      { column: 'Hindi',             subject: 'Hindi',     date: '2026-10-14' },
      { column: 'History & Pol Sci', subject: 'History',   date: '2026-10-15' },
      { column: 'Geography',         subject: 'Geography', date: '2026-10-16' },
      { column: 'Maths - I',         subject: 'Maths',     date: '2026-10-17' },
      { column: 'Maths - II',        subject: 'Maths',     date: '2026-10-19' },
    ],
    noExamColumns: { Science: 'marks not entered yet (paper on 20 Oct)' },
  },
  {
    ...TERM,
    cls: '10th',
    sheet: '10 Term I',
    batch: 'APJ_NDA_10th_(26-27)',
    branch: BRANCH,
    maxMarks: 80,
    papers: [
      { column: 'English',    subject: 'English',   date: '2026-10-12' },
      { column: 'Marathi',    subject: 'Marathi',   date: '2026-10-13' },
      { column: 'Hindi',      subject: 'Hindi',     date: '2026-10-14' },
      { column: 'History',    subject: 'History',   date: '2026-10-15' },
      { column: 'Geography',  subject: 'Geography', date: '2026-10-16' },
      { column: 'Maths - I',  subject: 'Maths',     date: '2026-10-17' },
      { column: 'Maths - II', subject: 'Maths',     date: '2026-10-19' },
    ],
    noExamColumns: {
      'Science I':  'marks not entered yet (paper on 20 Oct)',
      'Science II': 'marks not entered yet (paper on 21 Oct)',
    },
  },
  {
    ...TERM,
    cls: '11th',
    sheet: '11th Term I',
    // One combined sheet for both sections, matching the Unit Test 1 exams.
    batch: 'APJ_NDA_11th_(26-27)_A, APJ_NDA_11th_(26-27)_B',
    branch: BRANCH,
    // Biology's max cell is blank on the sheet; 50 like every 11th paper.
    maxMarks: 50,
    papers: [
      { column: 'English',   subject: 'English',   date: '2026-10-12' },
      { column: 'Physics',   subject: 'Physics',   date: '2026-10-13' },
      { column: 'Chemistry', subject: 'Chemistry', date: '2026-10-14' },
      { column: 'Maths',     subject: 'Maths',     date: '2026-10-15' },
      { column: 'Geography', subject: 'Geography', date: '2026-10-16' },
      { column: 'IT',        subject: 'IT',        date: '2026-10-17' },
      // Not on the printed timetable, so the date is IT's. Only two students
      // take Biology (both also sat IT). Faculty: record it for those two.
      { column: 'Biology',   subject: 'Biology',   date: '2026-10-17' },
    ],
  },
  {
    ...TERM,
    cls: '12th',
    sheet: '12th Term I',
    batch: 'APJ_NDA_12th_(26-27)',
    branch: BRANCH,
    maxMarks: 50,
    // English holds 54 (Vedant Todarmal) and 55 (Sanket Bhichewar) on a
    // 50-mark paper. Faculty: leave both out until the school gives the real
    // marks — the importer omits an over-max cell and reports it.
    papers: [
      { column: 'English',   subject: 'English',   date: '2026-10-12' },
      { column: 'Physics',   subject: 'Physics',   date: '2026-10-13' },
      { column: 'Chemistry', subject: 'Chemistry', date: '2026-10-14' },
    ],
    noExamColumns: {
      Maths:     'marks not entered yet (paper on 15 Oct)',
      Geography: 'not a 12th paper (struck off the timetable)',
      IT:        'not a 12th paper (struck off the timetable)',
      Biology:   'not a 12th paper',
    },
  },
]

// Faculty-confirmed spellings (2026-10-29) the class-scoped matcher cannot
// reach. Kept here rather than written into `students.name_variants` — a marks
// import should not quietly reshape identity records.
const NAME_ALIASES = {
  'Anvita Kiran Kharat':  'Anavita kharat',
  'Prabadh Dhurandhar':   'Prabuddha Dhurandhar',
  'Sanket Bhichewar':     'Sanket Bichewar',
  // The sheet gives no surname. Neel Ugale, the other 11th Neel, is blocked.
  'Neel':                 'Neel Wardhamane',
  // Sat APJ 11th Term 1 (English + Geography only) but have since moved to
  // LWS Pune, so they are outside the 11th batches the matcher searches.
  'Atharva Satish Ingle':    'Atharva Satish Ingle',
  'Manas Mangesh Bakde':     'Manas Bakde',
  'Namita Yogesh Vedpathak': 'Namita Vedpathak',
  'Ritesh Ramesh Dhanve':    'Ritesh Dhanve',
  'Shreyash Ramdas Gaikwad': 'Shreyash Gaikwad',
}

runSchoolExamImport({ workbook: WORKBOOK, classes: CLASSES, aliases: NAME_ALIASES })
  .catch(e => { console.error(e); process.exit(1) })
