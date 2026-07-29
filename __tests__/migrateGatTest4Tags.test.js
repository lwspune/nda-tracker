import { describe, it, expect } from 'vitest'
import { TAG_FIXES, EXAM_ID, applyTagFixes } from '../migrate_gat_test4_tags.js'

// Subtopic labels that already existed in each target chapter before this fix.
// Pinning them is the point: `Idioms & Phrases` already carries 60+ subtopics
// holding two questions each, and the fix must not add an eleventh flavour of
// "an idiom question". Every label below was read off prod on 2026-07-29.
const EXISTING_LABELS = new Set([
  'Idiom Meaning',
  'Factual Detail Retrieval',
  'Vocabulary in Context',
  'Critical Reasoning - NOT True',
  'Inferential Comprehension',
  'Verb Patterns',
  'Verb Usage',
  'Adverb Placement',
  'Noun Number',
  'Word Choice, Prepositions and Punctuation',
  'Indirect Speech Word Order',
  'No Error (Correct Sentence)',
  'Subject-Verb Agreement',
  'Tense and Verb Form',
  'Conjunction Lest',
  'Preposition Usage',
])

const TARGET_CHAPTERS = new Set([
  'Idioms & Phrases',
  'Reading Comprehension',
  'Sentence Improvement',
  'Spotting Errors',
  'Fill in the Blanks',
])

const q = (n, chapter = 'English', subtopic = 'General') => ({
  q: n, chapter, subtopic, subject: 'English',
})

describe('TAG_FIXES', () => {
  it('covers exactly questions 1..50', () => {
    const keys = Object.keys(TAG_FIXES).map(Number).sort((a, b) => a - b)
    expect(keys).toHaveLength(50)
    expect(keys[0]).toBe(1)
    expect(keys[49]).toBe(50)
  })

  it('assigns only chapters that exist in the configured English weightage table', () => {
    for (const [n, fix] of Object.entries(TAG_FIXES)) {
      expect(TARGET_CHAPTERS.has(fix.chapter), `q${n}: ${fix.chapter}`).toBe(true)
    }
  })

  it('mints no new subtopic labels', () => {
    for (const [n, fix] of Object.entries(TAG_FIXES)) {
      expect(EXISTING_LABELS.has(fix.subtopic), `q${n}: ${fix.subtopic}`).toBe(true)
    }
  })

  it('leaves no question on the General placeholder', () => {
    for (const fix of Object.values(TAG_FIXES)) {
      expect(fix.subtopic).not.toBe('General')
    }
  })

  it('keeps the five section blocks contiguous', () => {
    const chapterOf = n => TAG_FIXES[n].chapter
    for (let n = 1; n <= 10; n++) expect(chapterOf(n)).toBe('Idioms & Phrases')
    for (let n = 11; n <= 20; n++) expect(chapterOf(n)).toBe('Reading Comprehension')
    for (let n = 21; n <= 30; n++) expect(chapterOf(n)).toBe('Sentence Improvement')
    for (let n = 31; n <= 40; n++) expect(chapterOf(n)).toBe('Spotting Errors')
    for (let n = 41; n <= 50; n++) expect(chapterOf(n)).toBe('Fill in the Blanks')
  })
})

describe('applyTagFixes', () => {
  it('rewrites chapter and subtopic for a placeholder question', () => {
    const questions = [q(37)]
    const changed = applyTagFixes(questions)
    expect(changed).toBe(1)
    expect(questions[0].chapter).toBe('Spotting Errors')
    expect(questions[0].subtopic).toBe('Subject-Verb Agreement')
  })

  it('only touches questions still on the English placeholder chapter', () => {
    // This exam has 150 questions; the other 100 are Maths/GK and must not move
    // just because their q number collides with the English section's 1..50.
    const questions = [q(5, 'Physics', 'Optics'), q(5, 'English')]
    const changed = applyTagFixes(questions)
    expect(changed).toBe(1)
    expect(questions[0]).toMatchObject({ chapter: 'Physics', subtopic: 'Optics' })
    expect(questions[1].chapter).toBe('Idioms & Phrases')
  })

  it('ignores a question whose number is not in the map', () => {
    const questions = [q(51)]
    expect(applyTagFixes(questions)).toBe(0)
    expect(questions[0].chapter).toBe('English')
  })

  it('is idempotent — a second run changes nothing', () => {
    const questions = [q(41)]
    expect(applyTagFixes(questions)).toBe(1)
    expect(applyTagFixes(questions)).toBe(0)
    expect(questions[0].subtopic).toBe('Preposition Usage')
  })

  it('handles a missing or non-numeric q field without throwing', () => {
    const questions = [{ chapter: 'English' }, { q: 'x', chapter: 'English' }]
    expect(applyTagFixes(questions)).toBe(0)
  })

  it('targets a single known exam', () => {
    expect(EXAM_ID).toBe('exam_1781529960467')
  })
})
