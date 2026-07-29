// One-off: re-tag the English section of "NDA GAT : Test 4" (2026-06-13).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_gat_test4_tags.js [--dry-run]
//
// All 50 English questions were uploaded with chapter 'English' and subtopic
// 'General'. 'English' is not a chapter in the configured weightage table, so
// computeProjectedScore joined nothing and every one of them scored 0; and
// 'General' carries no analytic signal even once the chapter is right.
//
// The 50 are five sections of ten, identifiable from the question text
// (`Idiom/Phrase:`, `COMPREHENSION-I`, `SENTENCE IMPROVEMENT:`, `SPOTTING
// ERRORS:`, `FILL IN THE BLANKS:`), so the mapping below is read off the paper
// rather than inferred. Subtopics reuse labels those chapters already carry —
// deliberately no new ones. `Idioms & Phrases` already holds 60+ subtopics with
// two questions each; ten more themed buckets would make that worse, so all ten
// idioms take the chapter's dominant label `Idiom Meaning`.
//
// This cannot be expressed by CHAPTER_RENAMES or CHAPTER_SUBTOPIC_RENAMES in
// migrate_subtopics_supabase.js: all 50 share one (chapter, subtopic) pair and
// need five different targets. Hence a per-question one-off.

import { createClient } from '@supabase/supabase-js'

export const EXAM_ID = 'exam_1781529960467'

// Only questions still sitting on this chapter are touched, so re-running is
// safe and the exam's other 100 (Maths/GK) questions are never in scope.
const PLACEHOLDER_CHAPTER = 'English'

const idiom       = { chapter: 'Idioms & Phrases',      subtopic: 'Idiom Meaning' }
const rcFactual   = { chapter: 'Reading Comprehension', subtopic: 'Factual Detail Retrieval' }
const rcInfer     = { chapter: 'Reading Comprehension', subtopic: 'Inferential Comprehension' }
const siVerbUsage = { chapter: 'Sentence Improvement',  subtopic: 'Verb Usage' }
const siNounNum   = { chapter: 'Sentence Improvement',  subtopic: 'Noun Number' }
const seNoError   = { chapter: 'Spotting Errors',       subtopic: 'No Error (Correct Sentence)' }
const seSVA       = { chapter: 'Spotting Errors',       subtopic: 'Subject-Verb Agreement' }
const fitbPrep    = { chapter: 'Fill in the Blanks',    subtopic: 'Preposition Usage' }

export const TAG_FIXES = {
  // 1-10 — "Idiom/Phrase: '…' means:"
  1: idiom, 2: idiom, 3: idiom, 4: idiom, 5: idiom,
  6: idiom, 7: idiom, 8: idiom, 9: idiom, 10: idiom,

  // 11-20 — two passages: Kangaroo Mother Care, then e-pharmacies
  11: rcFactual,
  12: rcFactual,
  13: rcFactual,
  14: { chapter: 'Reading Comprehension', subtopic: 'Vocabulary in Context' },      // fills a blank IN the passage
  15: rcFactual,
  16: { chapter: 'Reading Comprehension', subtopic: 'Critical Reasoning - NOT True' }, // "which is not true"
  17: rcInfer, 18: rcInfer, 19: rcInfer, 20: rcInfer,

  // 21-30 — "SENTENCE IMPROVEMENT:"
  21: { chapter: 'Sentence Improvement', subtopic: 'Verb Patterns' },     // intend + to-infinitive
  22: siVerbUsage,                                                        // "cut up to be" -> "cut out"
  23: siVerbUsage,                                                        // "craved for" -> "sought after"
  24: { chapter: 'Sentence Improvement', subtopic: 'Word Choice, Prepositions and Punctuation' }, // "word by word" -> "word for word"
  25: siVerbUsage,                                                        // redundant negative after "denied"
  26: { chapter: 'Sentence Improvement', subtopic: 'Adverb Placement' },  // "enough rich" -> "rich enough"
  27: siNounNum,                                                          // "all the guest" -> "guests"
  28: siNounNum,                                                          // "a scissor" -> "a pair of scissors"
  29: siVerbUsage,                                                        // "put out" -> "put away"
  30: { chapter: 'Sentence Improvement', subtopic: 'Indirect Speech Word Order' },  // embedded question order

  // 31-40 — "SPOTTING ERRORS:"
  31: { chapter: 'Spotting Errors', subtopic: 'Word Choice, Prepositions and Punctuation' }, // "weird spread" -> "widespread"
  32: seNoError,
  33: { chapter: 'Spotting Errors', subtopic: 'Tense and Verb Form' },    // "as we do when we were 30"
  34: { chapter: 'Spotting Errors', subtopic: 'Conjunction Lest' },       // "lest ... not"
  35: { chapter: 'Spotting Errors', subtopic: 'Preposition Usage' },      // "home of" -> "home to"
  36: seNoError,
  37: seSVA,                                                              // "Every one ... have"
  38: seNoError,
  39: seSVA,                                                              // "A time out ... are allowed"
  40: seSVA,                                                              // "either of the brothers were"

  // 41-50 — "FILL IN THE BLANKS:", every one a preposition
  // NOTE q48's stored question text is truncated ("John yesterday, and it was a
  // pleasant surprise") — the blank and its verb are missing. Options and key
  // imply "I ran ____ John yesterday". Tagged with the block; the broken text
  // is a separate content bug, logged in SUGGESTIONS.md.
  41: fitbPrep, 42: fitbPrep, 43: fitbPrep, 44: fitbPrep, 45: fitbPrep,
  46: fitbPrep, 47: fitbPrep, 48: fitbPrep, 49: fitbPrep, 50: fitbPrep,
}

// Mutates in place; returns the number of questions changed.
export function applyTagFixes(questions) {
  let changed = 0
  for (const q of questions) {
    if (q?.chapter !== PLACEHOLDER_CHAPTER) continue
    const n = typeof q.q === 'number' ? q.q : Number.parseInt(q.q, 10)
    if (!Number.isInteger(n)) continue
    const fix = TAG_FIXES[n]
    if (!fix) continue
    q.chapter = fix.chapter
    q.subtopic = fix.subtopic
    changed++
  }
  return changed
}

async function main() {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const DRY_RUN = process.argv.includes('--dry-run')
  if (!SERVICE_KEY) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
    process.exit(1)
  }

  const supabase = createClient('https://exjnzrrlzcrsoxfoojcq.supabase.co', SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const { data, error } = await supabase
    .from('exams').select('id, name, questions').eq('id', EXAM_ID).single()
  if (error) throw new Error(`fetch failed: ${error.message}`)

  const questions = JSON.parse(JSON.stringify(data.questions ?? []))
  const changed = applyTagFixes(questions)

  console.log(`${data.name}: ${questions.length} questions, ${changed} to re-tag`)
  const byChapter = {}
  for (const q of questions) {
    if (TAG_FIXES[q.q] && q.chapter === TAG_FIXES[q.q].chapter) {
      byChapter[q.chapter] = (byChapter[q.chapter] || 0) + 1
    }
  }
  for (const [ch, n] of Object.entries(byChapter)) console.log(`  ${n.toString().padStart(3)}  ${ch}`)

  if (DRY_RUN) return console.log('\n[dry-run] No changes written.')
  if (changed === 0) return console.log('\nNothing to update — already applied.')

  const { error: upErr } = await supabase
    .from('exams')
    .update({ questions, updated_at: new Date().toISOString() })
    .eq('id', EXAM_ID)
  if (upErr) throw new Error(`update failed: ${upErr.message}`)
  console.log(`\nDone. ${changed} question(s) re-tagged.`)
}

// Only run when invoked directly, so the test can import the pure parts.
if (process.argv[1]?.endsWith('migrate_gat_test4_tags.js')) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
