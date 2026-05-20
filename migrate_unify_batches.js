// One-off migration: unify syllabus + timetable batch names.
//
// Renames timetable batchNames to syllabus-style cohort names, splits the
// LWS / APJ 2-year cohorts into _A/_B sections (copying progress + timelines
// to both), pre-creates _B sections that don't have a timetable yet, and
// adds a fresh APJ_9th_Std syllabus entry (previously bundled with 10th).
//
// Targets the faculty_state JSONB row on Supabase (id=1). Cascades:
//   syllabusBatches[], batchProgramAssignments, batchSyllabusProgress,
//   syllabusBatchBranches, batchChapterTimelines, timetables[].batchName,
//   examSchedules[].batchName.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_unify_batches.js [--dry-run]
//   node migrate_unify_batches.js --local [--dry-run]
//
// --local    Operate on data/faculty-data.json instead of Supabase.
// --dry-run  Compute + print the diff but write nothing.
//
// Idempotent: if the unified names already exist, the script reports
// "already in sync" and exits.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')
const LOCAL        = process.argv.includes('--local')

if (!LOCAL && !SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required (omit --local to target Supabase).')
  process.exit(1)
}

// ── Rename map ───────────────────────────────────────────────────────────────
// Single map applied across both syllabus and timetable namespaces. After
// running, both lists converge on these names.
//
// 2-year cohorts: their old syllabus key (no suffix) maps to _A; a fresh _B
// entry is created. Existing progress/timelines copy to both _A and _B.
const RENAMES = {
  // APJ
  'APJ_12th NDA (2026-27)':  'APJ_12th_NDA_(2026-27)',
  'APJ_NDA_2Y_ (26-28)':     'APJ_NDA_2Y_(26-28)_A',  // strip stray space + becomes _A
  '12th Std':                'APJ_12th_NDA_(2026-27)',
  '11th Std':                'APJ_NDA_2Y_(26-28)_A',
  '9th & 10th Std':          'APJ_10th_Std',
  // LWS Pune
  'LWS_NDA_2Y_(25-27)':      'LWS_NDA_2Y_(25-27)_A',  // becomes _A
  'LWS_NDA_2Y_ (26-28)':     'LWS_NDA_2Y_(26-28)_A',  // strip stray space + becomes _A
  '2Y NDA 25_27_Batch_A':    'LWS_NDA_2Y_(25-27)_A',
  '2Y_NDA_25_27_Batch_B':    'LWS_NDA_2Y_(25-27)_B',
  '2Y_NDA_26_28_Batch_A':    'LWS_NDA_2Y_(26-28)_A',
}

// Pairs of (sourceName, newCloneName) — clone source's progress/timelines/
// assignments/branch onto the new clone. The source name should be the
// POST-RENAME name (i.e. after RENAMES is applied) so cloning sees a stable
// reference.
const CLONE_FOR_B_SECTIONS = [
  // LWS 25-27: clone _A's state onto _B (then _B's actual timetable, which
  // already points to a different batch, will keep its existing state once
  // its key is renamed to _B by RENAMES. The clone is for the SYLLABUS-side
  // _B that wouldn't otherwise have progress data.)
  // Note: 2Y_NDA_25_27_Batch_B already gets its own _B name via RENAMES on the
  // TIMETABLE side, but syllabus side had only one entry (LWS_NDA_2Y_(25-27))
  // — so we clone _A → _B in syllabus only.
  { source: 'LWS_NDA_2Y_(25-27)_A', clone: 'LWS_NDA_2Y_(25-27)_B' },
  { source: 'LWS_NDA_2Y_(26-28)_A', clone: 'LWS_NDA_2Y_(26-28)_B' },
  { source: 'APJ_NDA_2Y_(26-28)_A', clone: 'APJ_NDA_2Y_(26-28)_B' },
]

// Plain new syllabus entries with a branch but no copied progress.
const NEW_SYLLABUS = [
  { name: 'APJ_9th_Std', branch: 'APJ' },
]

// ── Transformation ───────────────────────────────────────────────────────────

function renameKey(obj, oldKey, newKey) {
  if (!obj || !(oldKey in obj) || oldKey === newKey) return obj
  const { [oldKey]: val, ...rest } = obj
  return { ...rest, [newKey]: val }
}

function transform(data) {
  const log = []
  const next = JSON.parse(JSON.stringify(data ?? {}))

  // 1. Rename syllabusBatches[] entries
  if (Array.isArray(next.syllabusBatches)) {
    const before = [...next.syllabusBatches]
    next.syllabusBatches = next.syllabusBatches.map(b => RENAMES[b] ?? b)
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== next.syllabusBatches[i]) {
        log.push(`syllabusBatches[]: '${before[i]}' → '${next.syllabusBatches[i]}'`)
      }
    }
  }

  // 2. Rename keys in 4 batch-keyed maps
  for (const field of [
    'batchProgramAssignments',
    'batchSyllabusProgress',
    'syllabusBatchBranches',
    'batchChapterTimelines',
  ]) {
    if (!next[field] || typeof next[field] !== 'object') continue
    let obj = next[field]
    for (const [oldKey, newKey] of Object.entries(RENAMES)) {
      if (oldKey in obj) {
        obj = renameKey(obj, oldKey, newKey)
        log.push(`${field}: key '${oldKey}' → '${newKey}'`)
      }
    }
    next[field] = obj
  }

  // 3. Rename timetables[].batchName
  if (Array.isArray(next.timetables)) {
    for (const tt of next.timetables) {
      if (tt.batchName && RENAMES[tt.batchName]) {
        log.push(`timetables[${tt.id}]: '${tt.batchName}' → '${RENAMES[tt.batchName]}'`)
        tt.batchName = RENAMES[tt.batchName]
      }
    }
  }

  // 4. Rename examSchedules[].batchName
  if (Array.isArray(next.examSchedules)) {
    for (const e of next.examSchedules) {
      if (e.batchName && RENAMES[e.batchName]) {
        log.push(`examSchedules[${e.id}]: '${e.batchName}' → '${RENAMES[e.batchName]}'`)
        e.batchName = RENAMES[e.batchName]
      }
    }
  }

  // 5. Clone _A → _B for split cohorts (syllabus side)
  next.syllabusBatches ??= []
  next.batchProgramAssignments ??= {}
  next.batchSyllabusProgress ??= {}
  next.syllabusBatchBranches ??= {}
  next.batchChapterTimelines ??= {}

  for (const { source, clone } of CLONE_FOR_B_SECTIONS) {
    if (!next.syllabusBatches.includes(source)) {
      log.push(`SKIP clone: source '${source}' not found in syllabusBatches`)
      continue
    }
    if (next.syllabusBatches.includes(clone)) {
      log.push(`SKIP clone: '${clone}' already exists (idempotent)`)
      continue
    }
    next.syllabusBatches.push(clone)
    if (next.batchProgramAssignments[source]) {
      next.batchProgramAssignments[clone] = JSON.parse(JSON.stringify(next.batchProgramAssignments[source]))
    }
    if (next.batchSyllabusProgress[source]) {
      next.batchSyllabusProgress[clone] = JSON.parse(JSON.stringify(next.batchSyllabusProgress[source]))
    }
    if (next.syllabusBatchBranches[source]) {
      next.syllabusBatchBranches[clone] = next.syllabusBatchBranches[source]
    }
    if (next.batchChapterTimelines[source]) {
      next.batchChapterTimelines[clone] = JSON.parse(JSON.stringify(next.batchChapterTimelines[source]))
    }
    log.push(`CLONE: '${source}' → '${clone}' (progress, assignments, branch, timelines)`)
  }

  // 6. Add fresh empty syllabus entries
  for (const { name, branch } of NEW_SYLLABUS) {
    if (next.syllabusBatches.includes(name)) {
      log.push(`SKIP new: '${name}' already exists (idempotent)`)
      continue
    }
    next.syllabusBatches.push(name)
    if (branch) next.syllabusBatchBranches[name] = branch
    log.push(`NEW: '${name}' (branch=${branch ?? 'none'})`)
  }

  return { next, log }
}

// ── Driver ───────────────────────────────────────────────────────────────────

async function loadFromSupabase() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data, error } = await supabase.from('faculty_state').select('data').eq('id', 1).single()
  if (error) throw new Error(`fetch faculty_state failed: ${error.message}`)
  return { supabase, data: data.data }
}

async function saveToSupabase(supabase, nextData) {
  const { error } = await supabase
    .from('faculty_state')
    .update({ data: nextData, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw new Error(`update faculty_state failed: ${error.message}`)
}

function loadFromLocal() {
  const path = join(__dirname, 'data', 'faculty-data.json')
  const raw = readFileSync(path, 'utf8')
  return { path, data: JSON.parse(raw) }
}

function saveToLocal(path, nextData) {
  writeFileSync(path, JSON.stringify(nextData, null, 2), 'utf8')
}

async function main() {
  let data, supabase, localPath
  if (LOCAL) {
    const loaded = loadFromLocal()
    data      = loaded.data
    localPath = loaded.path
    console.log(`Loaded ${localPath}`)
  } else {
    const loaded = await loadFromSupabase()
    data     = loaded.data
    supabase = loaded.supabase
    console.log('Loaded faculty_state from Supabase')
  }

  console.log(`  syllabusBatches: ${(data.syllabusBatches ?? []).length}`)
  console.log(`  timetables:      ${(data.timetables ?? []).length}`)
  console.log(`  examSchedules:   ${(data.examSchedules ?? []).length}`)

  const { next, log } = transform(data)

  console.log('\n── Plan ────────────────────────────────────────────────')
  if (log.length === 0) {
    console.log('  (nothing to do — already in sync)')
  } else {
    for (const line of log) console.log(`  ${line}`)
  }

  console.log('\n── After ───────────────────────────────────────────────')
  console.log(`  syllabusBatches: ${JSON.stringify(next.syllabusBatches, null, 2)}`)
  console.log(`  timetables[].batchName: ${JSON.stringify(next.timetables?.map(t => t.batchName) ?? [], null, 2)}`)

  if (DRY_RUN) {
    console.log('\n[dry-run] No changes written.')
    return
  }

  if (log.length === 0) return

  if (LOCAL) {
    saveToLocal(localPath, next)
    console.log(`\n✓ Wrote ${localPath}`)
  } else {
    await saveToSupabase(supabase, next)
    console.log('\n✓ Wrote faculty_state on Supabase')
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
