import { NDA_FREQ_DEFAULT } from './ndaFreq'

// Master chapter list — single source of truth
export const VALID_CHAPTERS = NDA_FREQ_DEFAULT.map(r => r.chapter)

// Validate tags array against master chapter list
// Returns { valid: bool, issues: [{q, chapter, suggestion}] }
export function validateTags(tags) {
  const issues = []
  tags.forEach(tag => {
    if (!tag.chapter || tag.chapter.trim() === '') {
      issues.push({ q: tag.q, chapter: tag.chapter, suggestion: null, type: 'empty' })
      return
    }
    const exact = VALID_CHAPTERS.find(
      c => c.toLowerCase() === tag.chapter.toLowerCase()
    )
    if (!exact) {
      issues.push({
        q: tag.q,
        chapter: tag.chapter,
        suggestion: findClosest(tag.chapter, VALID_CHAPTERS),
        type: 'unrecognised',
      })
    }
  })
  return { valid: issues.length === 0, issues }
}

// Find closest chapter name using character overlap scoring
export function findClosest(input, list) {
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

  // Only suggest if similarity is above threshold — avoid terrible suggestions
  return bestScore > 0.25 ? best : null
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

// Normalise a chapter name to exact case from master list
export function normaliseChapter(name) {
  return VALID_CHAPTERS.find(c => c.toLowerCase() === name?.toLowerCase()) || name
}
