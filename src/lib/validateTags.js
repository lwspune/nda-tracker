import { NDA_FREQ_BY_SUBJECT } from './ndaFreq'

// Returns the valid chapter list for a given subject.
// Returns [] for subjects with no freq data — callers treat this as "skip validation".
export function getValidChapters(subject) {
  return (NDA_FREQ_BY_SUBJECT[subject] || []).map(r => r.chapter)
}

// Backward-compat export — Maths chapter list, used in legacy call sites
export const VALID_CHAPTERS = getValidChapters('Maths')

// Validate tags array against chapter lists.
// Each tag is validated against its own tag.subject when present,
// falling back to the passed defaultSubject.
// When a subject has no chapter list configured (empty []), that tag is accepted —
// the teacher tags freely and can configure freq later.
// Returns { valid: bool, issues: [{q, chapter, suggestion, type}] }
export function validateTags(tags, defaultSubject = 'Maths') {
  const issues = []

  tags.forEach(tag => {
    // Per-tag subject takes priority; fall back to the exam-level default
    const subject = tag.subject || defaultSubject
    const validChapters = getValidChapters(subject)

    // No freq data for this subject — skip validation for this tag
    if (validChapters.length === 0) return

    if (!tag.chapter || tag.chapter.trim() === '') {
      issues.push({ q: tag.q, chapter: tag.chapter, suggestion: null, type: 'empty' })
      return
    }
    const exact = validChapters.find(
      c => c.toLowerCase() === tag.chapter.toLowerCase()
    )
    if (!exact) {
      issues.push({
        q: tag.q,
        chapter: tag.chapter,
        suggestion: findClosest(tag.chapter, validChapters),
        type: 'unrecognised',
      })
    }
  })
  return { valid: issues.length === 0, issues }
}

// Find closest chapter name using character overlap scoring
export function findClosest(input, list) {
  if (!list.length) return null
  const inp = input.toLowerCase().trim()
  let best = null
  let bestScore = 0

  list.forEach(candidate => {
    const cand = candidate.toLowerCase()
    const score = similarity(inp, cand)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  })

  if (inp.length < 4) return null // too short to fuzzy match reliably
  return bestScore > 0.45 ? best : null
}

// Simple similarity: Jaccard on bigrams
export function similarity(a, b) {
  const bigramsA = bigrams(a)
  const bigramsB = bigrams(b)
  if (!bigramsA.size || !bigramsB.size) return 0
  let intersection = 0
  bigramsA.forEach(bg => { if (bigramsB.has(bg)) intersection++ })
  return intersection / (bigramsA.size + bigramsB.size - intersection)
}

function bigrams(str) {
  const set = new Set()
  for (let i = 0; i < str.length - 1; i++) {
    set.add(str.slice(i, i + 2))
  }
  return set
}

// Normalise a chapter name to exact case from the subject's chapter list
export function normaliseChapter(name, subject = 'Maths') {
  const validChapters = getValidChapters(subject)
  return validChapters.find(c => c.toLowerCase() === name?.toLowerCase()) || name
}

// For GAT (combined) exams: every tag must have a non-empty subject value.
// Returns { valid: bool, missingQs: number[] }
export function validateGatSubjects(tags) {
  const missingQs = tags.filter(t => !t.subject?.trim()).map(t => t.q)
  return { valid: missingQs.length === 0, missingQs }
}
