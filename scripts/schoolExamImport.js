// Shared runner for importing an APJ school exam (Unit Test 1, Term 1, …) from
// the school's wide marks workbook as offline exams.
//
// Each migrate_* script supplies only its config — workbook, classes, papers
// with timetable dates, name aliases — and calls `runSchoolExamImport`. The
// transpose itself is the pure `buildUnitTestExams`; name matching is the pure
// `makeNameResolver`.
//
// Writes `exams` + `exam_results` ONLY. No absence sync, no sends — recording
// marks must never reach a parent, and exam absences drive a WhatsApp flow.
//
// Idempotent: exam ids are derived from exam key + class + column, and each
// exam's results are deleted before insert (mirroring `upsertExam`), so a
// re-run replaces rather than duplicates.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { buildUnitTestExams, makeNameResolver } from '../src/lib/unitTest1Import.js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'

// The ESM build of xlsx has no filesystem bound — without this `readFile`
// reports the file as inaccessible even when it is right there.
XLSX.set_fs(fs)

// workbook  path to the .xlsx
// classes   per-class config for `buildUnitTestExams`, plus `sheet` (tab name)
// aliases   { sheetName: canonical } — faculty-confirmed spellings
export async function runSchoolExamImport({ workbook, classes, aliases = {} }) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dryRun = process.argv.includes('--dry-run')

  if (!serviceKey) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
    process.exit(1)
  }
  if (!fs.existsSync(workbook)) {
    console.error(`Error: workbook not found: ${workbook}`)
    process.exit(1)
  }

  const db = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

  const wb = XLSX.readFile(workbook)
  console.log(`Workbook: ${workbook}`)
  console.log(`Sheets:   ${wb.SheetNames.join(', ')}\n`)

  // ── 1. Roster ─────────────────────────────────────────────────────────────
  // Every branch, not just the class's: an alias may name a student who has
  // since moved branch but still sat this paper. Name matching itself stays
  // scoped to the class's batches.
  const { data: students, error: stErr } = await db
    .from('students')
    .select('lws_id, canonical_name, name_variants, branch, student_batches(batch_name)')
  if (stErr) throw stErr

  const profiles = new Map()   // canonical name → { batches, branch }
  const byBatch = new Map()    // batch name → [{ canonical, names }]
  const knownNames = new Set() // every spelling a student record carries
  for (const s of students) {
    const batches = (s.student_batches ?? []).map(b => b.batch_name)
    profiles.set(s.canonical_name, { batches, branch: s.branch })
    for (const n of [s.canonical_name, ...(s.name_variants ?? [])]) knownNames.add(n)
    for (const b of batches) {
      if (!byBatch.has(b)) byBatch.set(b, [])
      byBatch.get(b).push({ canonical: s.canonical_name, names: s.name_variants ?? [] })
    }
  }

  // An alias may target a variant (a record renamed after the alias was
  // written); one that no record carries at all would file marks under nobody.
  let blocking = 0
  for (const [from, to] of Object.entries(aliases)) {
    if (!knownNames.has(to)) {
      console.log(`✗ alias target is not a student: "${from}" → "${to}"`)
      blocking++
    }
  }

  // ── 2. Build ──────────────────────────────────────────────────────────────
  const allExams = []
  const allReports = []

  for (const config of classes) {
    const ws = wb.Sheets[config.sheet]
    if (!ws) { console.error(`Error: sheet "${config.sheet}" not in workbook.`); process.exit(1) }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    const roster = config.batch.split(',').flatMap(b => byBatch.get(b.trim()) ?? [])
    const resolveName = makeNameResolver({ roster, aliases })

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

  for (const { cls: c, report } of allReports) {
    const lines = []
    for (const r of report.unmatched)       { lines.push(`✗ UNMATCHED name, row dropped: "${r.name}"`); blocking++ }
    for (const r of report.unmappedColumns) { lines.push(`✗ sheet column with no configured paper: "${r.column}"`); blocking++ }
    for (const r of report.missingColumns)  { lines.push(`✗ configured paper with no sheet column: "${r.column}"`); blocking++ }
    for (const r of report.noExam) {
      if (r.marks) { lines.push(`✗ "${r.column}" is set to build no exam (${r.reason}) but holds ${r.marks} marks`); blocking++ }
      else lines.push(`· no exam for "${r.column}": ${r.reason}`)
    }
    for (const r of report.corrected)       lines.push(`~ corrected: ${r.name} ${r.column} = ${r.from} → ${r.to}`)
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

  if (dryRun) {
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
