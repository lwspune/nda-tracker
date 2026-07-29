import { NDA_FREQ_BY_SUBJECT } from './ndaFreq'

// Returns the valid chapter list for a given subject.
// Returns [] for subjects with no freq data — callers treat this as "skip validation".
//
// `ndaFreqBySubject` is the faculty-configured table (store field, persisted to
// faculty_state). It WINS over the hardcoded seed, which is empty for every
// subject except Maths — so without it, validation silently skipped every GAT
// subject even after faculty filled its weightage in. Pass it wherever it's
// available; omitting it degrades to the old seed-only behaviour.
//
// Deliberately does NOT fall back to Maths the way getFreqForSubject does.
// That fallback is right for SCORING (a projected score needs some weightage)
// and wrong here — it would validate Physics tags against Maths chapters and
// flag every single one.
export function getValidChapters(subject, ndaFreqBySubject) {
  const configured = ndaFreqBySubject?.[subject]
  const rows = configured?.length ? configured : (NDA_FREQ_BY_SUBJECT[subject] || [])
  return rows.map(r => r.chapter).filter(Boolean)
}

// Backward-compat export — Maths chapter list, used in legacy call sites
export const VALID_CHAPTERS = getValidChapters('Maths')

// Validate tags array against chapter lists.
// Each tag is validated against its own tag.subject when present,
// falling back to the passed defaultSubject.
// When a subject has no chapter list configured (empty []), that tag is accepted —
// the teacher tags freely and can configure freq later.
// Returns { valid: bool, issues: [{q, chapter, suggestion, type}] }
export function validateTags(tags, defaultSubject = 'Maths', ndaFreqBySubject) {
  const issues = []

  tags.forEach(tag => {
    // Per-tag subject takes priority; fall back to the exam-level default
    const subject = tag.subject || defaultSubject
    const validChapters = getValidChapters(subject, ndaFreqBySubject)

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
export function normaliseChapter(name, subject = 'Maths', ndaFreqBySubject) {
  const validChapters = getValidChapters(subject, ndaFreqBySubject)
  return validChapters.find(c => c.toLowerCase() === name?.toLowerCase()) || name
}

// For GAT (combined) exams: every tag must have a non-empty subject value.
// Returns { valid: bool, missingQs: number[] }
export function validateGatSubjects(tags) {
  const missingQs = tags.filter(t => !t.subject?.trim()).map(t => t.q)
  return { valid: missingQs.length === 0, missingQs }
}
