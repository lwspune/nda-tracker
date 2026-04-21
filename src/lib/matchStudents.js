import { similarity } from './validateTags'

const MATCH_THRESHOLD = 0.55 // minimum similarity to consider a match

// ── Match a single name against all profiles ─────────────────
// Returns { profile, confidence: 'exact'|'variant'|'fuzzy'|null }
export function matchName(name, studentProfiles) {
  if (!name || !studentProfiles) return { profile: null, confidence: null }
  const lower = name.toLowerCase().trim()

  // 1. Exact canonical match
  const exact = Object.values(studentProfiles).find(
    p => p.name?.toLowerCase().trim() === lower
  )
  if (exact) return { profile: exact, confidence: 'exact' }

  // 2. Name variants match
  const variant = Object.values(studentProfiles).find(p =>
    (p.nameVariants || []).some(v => v?.toLowerCase().trim() === lower)
  )
  if (variant) return { profile: variant, confidence: 'variant' }

  // 3. Fuzzy bigram match — find best scoring profile
  let best = null
  let bestScore = 0

  // Deduplicate profiles by lwsId to avoid scoring same student twice
  const seen = new Set()
  Object.values(studentProfiles).forEach(p => {
    const key = p.lwsId || p.name
    if (seen.has(key)) return
    seen.add(key)

    const score = similarity(lower, p.name?.toLowerCase().trim() || '')
    if (score > bestScore) {
      bestScore = score
      best = p
    }
    // Also check variants
    ;(p.nameVariants || []).forEach(v => {
      const vs = similarity(lower, v?.toLowerCase().trim() || '')
      if (vs > bestScore) {
        bestScore = vs
        best = p
      }
    })
  })

  if (bestScore >= MATCH_THRESHOLD) {
    return { profile: best, confidence: 'fuzzy', score: bestScore }
  }

  return { profile: null, confidence: null }
}

// ── Match all students in an exam against profiles ────────────
// Returns array of { name, profile, confidence }
export function matchExamStudents(students, studentProfiles) {
  if (!studentProfiles || !Object.keys(studentProfiles).length) return []
  return students.map(s => ({
    name: s.name,
    ...matchName(s.name, studentProfiles),
  }))
}

// ── Detect batch from matched students ───────────────────────
// Returns { batch, confidence, matchedCount, totalCount, batchCounts }
export function detectBatch(students, studentProfiles) {
  if (!studentProfiles || !Object.keys(studentProfiles).length) {
    return { batch: null, confidence: null, matchedCount: 0, totalCount: students.length }
  }

  const matches = matchExamStudents(students, studentProfiles)
  const batchCounts = {}

  matches.forEach(({ profile, confidence }) => {
    if (!profile || !confidence) return
    const batches = profile.batches || []
    batches.forEach(b => {
      if (!b) return
      batchCounts[b] = (batchCounts[b] || 0) + 1
    })
  })

  if (!Object.keys(batchCounts).length) {
    return {
      batch: null, confidence: null,
      matchedCount: matches.filter(m => m.profile).length,
      totalCount: students.length,
      batchCounts,
    }
  }

  // Pick batch with highest count
  const sorted = Object.entries(batchCounts).sort((a, b) => b[1] - a[1])
  const [topBatch, topCount] = sorted[0]
  const matchedCount = matches.filter(m => m.profile).length
  const confidence = matchedCount > 0 ? topCount / matchedCount : 0

  return {
    batch: topBatch,
    confidence,         // 0–1, proportion of students matched to this batch
    matchedCount,
    totalCount: students.length,
    batchCounts,        // all batches found with counts
  }
}

// ── Get all unique batches across all profiles ────────────────
export function getAllBatches(studentProfiles) {
  const batches = new Set()
  Object.values(studentProfiles || {}).forEach(p => {
    (p.batches || []).forEach(b => { if (b) batches.add(b) })
  })
  return [...batches].sort()
}
