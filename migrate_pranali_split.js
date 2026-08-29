// Split "Pranali Sarpale" out of LWS-493 into her own student profile.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_pranali_split.js [--dry-run]
//
// WHY: LWS-493 `Droupadi Sarpale` carries `Pranali Sarpale` + `Pranali Sarapale`
// as name variants, so results filed under either spelling all resolve to her.
// The Unit Test 1 sheet (Aug 2026) lists BOTH names as separate students with
// different marks, and faculty confirmed they are two different people. Until
// the variants are stripped, the marks migration cannot file Pranali's row
// anywhere — it would land on Droupadi.
//
// CONSEQUENCE, deliberately: the 7 historical results filed as `Pranali
// Sarapale` (2026-05-23 → 2026-07-18) stop counting toward Droupadi and become
// Pranali's. `exam_results.student_name` is a name string, so no result row is
// touched — the attribution follows the variant list. Droupadi keeps the 3 rows
// filed under her own spelling (2026-07-23 → 2026-08-01).
//
// Mobile is deliberately NOT copied. `7276559894` is on LWS-493 and only one of
// them owns it; a duplicated mobile is a uniquely-identifying key in the student
// import's tiered match (`mergeStudents` step 2) and would make every future
// merge ambiguous. Pranali cannot use the student portal until a number is added.
//
// Idempotent: re-running finds the profile already present and the variants
// already stripped, and reports "nothing to do".

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')

const SOURCE_ID = 'LWS-493'
const NEW_ID    = 'LWS-560'
const MOVED_VARIANTS = ['Pranali Sarpale', 'Pranali Sarapale']

const NEW_STUDENT = {
  lws_id:            NEW_ID,
  canonical_name:    'Pranali Sarpale',
  name_variants:     MOVED_VARIANTS,
  branch:            'APJ',
  account_status:    'Active',
  coming_status:     'Coming',
  // Must not post-date her earliest result (2026-05-23 Chemistry: Mole concept)
  // — `valid exam = exam.date >= regDate`, so a later date silently drops it.
  registration_date: '2026-05-23',
  residential:       true,
  gender:            'Female',
  mobile:            '',
  parent_mobiles:    [],
  eis_reg_no:        '',
  evalbee_roll_nos:  [],
  match_signatures:  [],
}

const NEW_BATCH = 'APJ_NDA_11th_(26-27)_A'   // her May/June results were tagged A-only

if (!SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  // ── 1. Read current state ───────────────────────────────────────────────
  const { data: source, error: srcErr } = await db
    .from('students')
    .select('lws_id, canonical_name, name_variants')
    .eq('lws_id', SOURCE_ID)
    .single()
  if (srcErr) throw srcErr

  const { data: existing, error: exErr } = await db
    .from('students')
    .select('lws_id, canonical_name')
    .eq('lws_id', NEW_ID)
    .maybeSingle()
  if (exErr) throw exErr

  console.log(`Source  ${source.lws_id}  ${source.canonical_name}`)
  console.log(`  variants: ${JSON.stringify(source.name_variants)}`)

  const keptVariants = (source.name_variants ?? [])
    .filter(v => !MOVED_VARIANTS.includes(v))
  const variantsNeedStripping = keptVariants.length !== (source.name_variants ?? []).length

  if (existing) {
    console.log(`\n${NEW_ID} already exists (${existing.canonical_name}).`)
  }
  if (!variantsNeedStripping && existing) {
    console.log('Nothing to do — already split.')
    return
  }

  // ── 2. What moves ───────────────────────────────────────────────────────
  const { data: moving, error: movErr } = await db
    .from('exam_results')
    .select('student_name, exam_id, total_marks')
    .in('student_name', MOVED_VARIANTS)
  if (movErr) throw movErr

  console.log(`\nPlan:`)
  if (!existing) {
    console.log(`  + insert ${NEW_ID} "${NEW_STUDENT.canonical_name}"`)
    console.log(`      variants   ${JSON.stringify(NEW_STUDENT.name_variants)}`)
    console.log(`      branch     ${NEW_STUDENT.branch}`)
    console.log(`      regDate    ${NEW_STUDENT.registration_date}`)
    console.log(`      mobile     (blank — not copied from ${SOURCE_ID})`)
    console.log(`  + batch  ${NEW_BATCH}`)
  }
  if (variantsNeedStripping) {
    console.log(`  ~ ${SOURCE_ID} variants ${JSON.stringify(source.name_variants)} → ${JSON.stringify(keptVariants)}`)
  }
  console.log(`  → ${moving.length} existing result row(s) re-attribute to ${NEW_ID}:`)
  for (const r of moving) console.log(`      ${r.student_name}  ${r.exam_id}  = ${r.total_marks}`)

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  // ── 3. Write ────────────────────────────────────────────────────────────
  // Insert FIRST, strip second: between the two writes the variant is claimed
  // by both profiles (harmless — the map keys to one) rather than by neither,
  // which would orphan the 7 result rows if the run died halfway.
  if (!existing) {
    const { error } = await db.from('students').insert(NEW_STUDENT)
    if (error) throw new Error(`students insert failed: ${error.message}`)
    console.log(`\n✓ inserted ${NEW_ID}`)

    const { error: bErr } = await db
      .from('student_batches')
      .upsert({ lws_id: NEW_ID, batch_name: NEW_BATCH }, { onConflict: 'lws_id,batch_name' })
    if (bErr) throw new Error(`student_batches upsert failed: ${bErr.message}`)
    console.log(`✓ added to ${NEW_BATCH}`)
  }

  if (variantsNeedStripping) {
    const { error } = await db
      .from('students')
      .update({ name_variants: keptVariants })
      .eq('lws_id', SOURCE_ID)
    if (error) throw new Error(`students update failed: ${error.message}`)
    console.log(`✓ stripped ${MOVED_VARIANTS.length} variant(s) from ${SOURCE_ID}`)
  }

  console.log('\nDone. Every open admin tab must RELOAD to see the split.')
}

main().catch(e => { console.error(e); process.exit(1) })
