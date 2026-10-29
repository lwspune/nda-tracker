// Import the APJ "Unit Test 1" marks (10–14 Aug 2026) as offline exams.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_unit_test_1.js [flags]
//
// --dry-run          Plan and print, write nothing.
// --file <path>      Results workbook. Default: the Downloads copy.
//
// The school reports a whole class in one wide sheet (one column per subject);
// the app stores one exam per paper. `buildUnitTestExams` does the transpose —
// this script only supplies the config, resolves names against Supabase, and
// writes. Dates come from the Unit Test 1 timetable PDF, one paper per slot.
//
// Every exam is OFFLINE (`questions: []` + explicit `max_marks`): the sheet has
// totals only, so per-question analytics are intentionally empty.
//
// The read, plan, report and write live in `scripts/schoolExamImport.js`,
// shared with the other school exams (writes exams + results only, never
// sends; idempotent).

import { runSchoolExamImport } from './scripts/schoolExamImport.js'

const fileFlag = process.argv.indexOf('--file')
const WORKBOOK = fileFlag !== -1
  ? process.argv[fileFlag + 1]
  : 'C:/Users/vilas/Downloads/First Unit Test  Results.xlsx'

const BRANCH = 'APJ'

// ── Per-class config ────────────────────────────────────────────────────────
// `column` joins to the sheet header; `date` is that paper's timetable slot.
// `subject` is the app-level subject — free text, as the teacher Written Quiz
// flow already files Hindi and Marathi, and the Dashboard derives its subject
// filter from the exams themselves.
const CLASSES = [
  {
    cls: '9th',
    sheet: '9th',
    batch: 'APJ_NDA_9th_(26-27)',
    branch: BRANCH,
    maxMarks: 20,
    papers: [
      { column: 'English',            subject: 'English',   date: '2026-08-10' },
      { column: 'Maths - I',          subject: 'Maths',     date: '2026-08-10' },
      { column: 'Hindi',              subject: 'Hindi',     date: '2026-08-11' },
      { column: 'Science',            subject: 'Science',   date: '2026-08-11' },
      { column: 'Marathi',            subject: 'Marathi',   date: '2026-08-12' },
      { column: 'Geography',          subject: 'Geography', date: '2026-08-12' },
      { column: 'History & Pol Sci',  subject: 'History',   date: '2026-08-13' },
      { column: 'Maths - II',         subject: 'Maths',     date: '2026-08-13' },
    ],
  },
  {
    cls: '10th',
    sheet: '10th',
    batch: 'APJ_NDA_10th_(26-27)',
    branch: BRANCH,
    maxMarks: 20,
    papers: [
      { column: 'Hindi',      subject: 'Hindi',     date: '2026-08-10' },
      { column: 'Science I',  subject: 'Science',   date: '2026-08-10' },
      { column: 'Marathi',    subject: 'Marathi',   date: '2026-08-11' },
      { column: 'History',    subject: 'History',   date: '2026-08-11' },
      { column: 'English',    subject: 'English',   date: '2026-08-12' },
      { column: 'Maths - I',  subject: 'Maths',     date: '2026-08-12' },
      { column: 'Geography',  subject: 'Geography', date: '2026-08-13' },
      { column: 'Science II', subject: 'Science',   date: '2026-08-13' },
      { column: 'Maths - II', subject: 'Maths',     date: '2026-08-14' },
    ],
  },
  {
    cls: '11th',
    sheet: '11th',
    // One combined sheet for both sections, matching how the existing 11th
    // exams are tagged.
    batch: 'APJ_NDA_11th_(26-27)_A, APJ_NDA_11th_(26-27)_B',
    branch: BRANCH,
    maxMarks: 25,
    papers: [
      { column: 'Physics',   subject: 'Physics',   date: '2026-08-10' },
      { column: 'English',   subject: 'English',   date: '2026-08-10' },
      { column: 'Chemistry', subject: 'Chemistry', date: '2026-08-11' },
      { column: 'Geography', subject: 'Geography', date: '2026-08-11' },
      { column: 'Maths',     subject: 'Maths',     date: '2026-08-12' },
      { column: 'IT',        subject: 'IT',        date: '2026-08-12' },
      { column: 'Biology',   subject: 'Biology',   date: '2026-08-13' },
    ],
    // Zero in all six papers. Himanish roy / Kartik shinde / Ganesh mane are
    // Blocked with quit dates 6–7 weeks before the test; the other three show
    // the same six-subject pattern. Faculty call: absent, not scores of 0.
    skipAll: [
      'Priyansh Bisht', 'Atharva shamnani', 'Manas bakde',
      'Himanish roy', 'Kartik shinde', 'Ganesh mane',
    ],
    // Zero in five papers, 8 in Maths — appeared for one paper only. Only his
    // 0 cells are dropped; the 8 lands.
    skipZeros: ['Saif samalewale'],
    // The sheet records 31 on a 25-mark paper. Faculty confirmed 21 (2026-08-29).
    // It belongs here rather than as a direct database edit: this import deletes
    // and re-inserts each exam's results, so a correction living only in the DB
    // would be erased by the next re-run.
    markOverrides: { 'Aditya Suryawanshi': { Maths: 21 } },
  },
]

// Sheet spellings that no student's canonical name or variant matches after
// normalisation. Each was confirmed against batch membership. Kept here rather
// than written into `students.name_variants` — a marks import should not
// quietly reshape identity records.
const NAME_ALIASES = {
  'Avishkar Sonwane':     'Avishkar Sonawane',
  'Beesham Pratap singh': 'Bheeshm Pratap  Amit Singh',   // double space is in the record
  'Jishan shaikh':        'Shaikh Siraj',
  'tapsavi Naugan':       'Tapasvi Naugan',
  'Veer Repale':          'Veer Jaysingh Repale',
  'dropadi sarpale':      'Droupadi Sarpale',
}

runSchoolExamImport({ workbook: WORKBOOK, classes: CLASSES, aliases: NAME_ALIASES })
  .catch(e => { console.error(e); process.exit(1) })
