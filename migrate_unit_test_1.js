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
// Writes `exams` + `exam_results` ONLY. No absence sync, no sends — recording
// marks must never reach a parent, and exam absences drive a WhatsApp flow.
//
// Idempotent: exam ids are derived from class + column, and each exam's results
// are deleted before insert (mirroring `upsertExam`), so a re-run replaces
// rather than duplicates.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { buildUnitTestExams } from './src/lib/unitTest1Import.js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')

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

if (!SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  process.exit(1)
}
if (!fs.existsSync(WORKBOOK)) {
  console.error(`Error: workbook not found: ${WORKBOOK}`)
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// The ESM build of xlsx has no filesystem bound — without this `readFile`
// reports the file as inaccessible even when it is right there.
XLSX.set_fs(fs)

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')

async function main() {
  const wb = XLSX.readFile(WORKBOOK)
  console.log(`Workbook: ${WORKBOOK}`)
  console.log(`Sheets:   ${wb.SheetNames.join(', ')}\n`)

  // ── 1. Roster → normalised name → canonical ───────────────────────────────
  const { data: students, error: stErr } = await db
    .from('students')
    .select('lws_id, canonical_name, name_variants, branch, student_batches(batch_name)')
    .eq('branch', BRANCH)
  if (stErr) throw stErr

  // Batch-scoped so a sheet name cannot resolve to a same-named student in
  // another class — an out-of-class match would be reported as matched.
  const profiles = new Map()   // canonical name → { batches, branch }
  const byBatch = new Map()    // batch name → Map(normalised → canonical)
  for (const s of students) {
    const batches = (s.student_batches ?? []).map(b => b.batch_name)
    profiles.set(s.canonical_name, { batches, branch: s.branch })
    for (const b of batches) {
      if (!byBatch.has(b)) byBatch.set(b, new Map())
      const m = byBatch.get(b)
      for (const v of [...(s.name_variants ?? []), s.canonical_name]) {
        m.set(norm(v), s.canonical_name)
      }
    }
  }

  // ── 2. Build ──────────────────────────────────────────────────────────────
  const allExams = []
  const allReports = []

  for (const config of CLASSES) {
    const ws = wb.Sheets[config.sheet]
    if (!ws) { console.error(`Error: sheet "${config.sheet}" not in workbook.`); process.exit(1) }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    const scope = new Map()
    for (const b of config.batch.split(',').map(x => x.trim())) {
      for (const [k, v] of (byBatch.get(b) ?? new Map())) scope.set(k, v)
    }
    const resolveName = name => NAME_ALIASES[name] ?? scope.get(norm(name)) ?? null

    const { exams, report } = buildUnitTestExams({ rows, config, resolveName })
    allExams.push(...exams)
    allReports.push({ cls: config.cls, report })
  }

  // ── 3. Print the plan ─────────────────────────────────────────────────────
  console.log('Exams to write:')
  let cls = null
  for (const e of allExams) {
    const c = e.id.split('_')[2]
    if (c !== cls) { cls = c; console.log(`\n  ── ${cls} ── ${e.batch}`) }
    console.log(`  ${e.date}  ${e.name.padEnd(38)} ${String(e.subject).padEnd(10)} /${String(e.maxMarks).padEnd(3)} ${String(e.students.length).padStart(4)} results`)
  }
  const totalRows = allExams.reduce((n, e) => n + e.students.length, 0)
  console.log(`\n  ${allExams.length} exams, ${totalRows} result rows.`)

  let blocking = 0
  for (const { cls: c, report } of allReports) {
    const lines = []
    for (const r of report.unmatched)       { lines.push(`✗ UNMATCHED name, row dropped: "${r.name}"`); blocking++ }
    for (const r of report.unmappedColumns) { lines.push(`✗ sheet column with no configured paper: "${r.column}"`); blocking++ }
    for (const r of report.missingColumns)  { lines.push(`✗ configured paper with no sheet column: "${r.column}"`); blocking++ }
    for (const r of report.overMax)         lines.push(`· over max, cell omitted: ${r.name} ${r.column} = ${r.value} (max ${r.max})`)
    for (const r of report.nonNumeric)      lines.push(`· non-numeric, absent: ${r.name} ${r.column} = "${r.value}"`)
    for (const r of report.skippedAll)      lines.push(`· absent from all ${r.papers} papers: ${r.name}`)
    for (const r of report.skippedZeros)    lines.push(`· zeros treated as absent (${r.papers} papers): ${r.name}`)
    for (const r of report.skippedPapers)   lines.push(`· absent from ${r.column}: ${r.name}`)
    if (lines.length) {
      console.log(`\n  ── ${c} notes ──`)
      for (const l of lines) console.log(`  ${l}`)
    }
  }

  if (blocking) {
    console.log(`\n✗ ${blocking} blocking issue(s) above. Nothing written — fix the config or the sheet first.`)
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  // ── 4. Write ──────────────────────────────────────────────────────────────
  // Same order as `upsertExam`: exam row, clear stale results, insert.
  for (const e of allExams) {
    const { error: exErr } = await db.from('exams').upsert({
      id: e.id, name: e.name, date: e.date, subject: e.subject,
      batch: e.batch, branch: e.branch, marking: e.marking,
      questions: e.questions, max_marks: e.maxMarks,
      created_by: null, source: 'admin',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    if (exErr) throw new Error(`${e.id} exams upsert failed: ${exErr.message}`)

    const { error: delErr } = await db.from('exam_results').delete().eq('exam_id', e.id)
    if (delErr) throw new Error(`${e.id} exam_results delete failed: ${delErr.message}`)

    if (e.students.length) {
      const rows = e.students.map(s => {
        const p = profiles.get(s.name)
        return {
          exam_id: e.id,
          student_name: s.name,
          roll_no: '', total_marks: s.totalMarks,
          correct: 0, incorrect: 0, not_attempted: 0,
          responses: {}, choices: {},
          batch_at_exam:  p ? ((p.batches ?? []).join(', ') || null) : null,
          branch_at_exam: p ? (p.branch || null) : null,
        }
      })
      const { error: insErr } = await db.from('exam_results').insert(rows)
      if (insErr) throw new Error(`${e.id} exam_results insert failed: ${insErr.message}`)
    }
    console.log(`  ✓ ${e.id.padEnd(30)} ${String(e.students.length).padStart(4)} results`)
  }

  console.log(`\n✓ Wrote ${allExams.length} exams, ${totalRows} result rows.`)
  console.log('Every open admin tab must RELOAD to see them.')
}

main().catch(e => { console.error(e); process.exit(1) })
