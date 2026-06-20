// ── Exam integrity (copying detection) ────────────────────────
// Pure pairwise answer-similarity analysis over one exam's captured chosen
// options (exam_results.choices, captured since 2026-06-10). The fingerprint of
// copying is SHARED WRONG answers — the same incorrect option on the same
// question — plus near-identical attempt/skip patterns. Shared CORRECT answers
// are not evidence (everyone converges on those).
//
// Two detection regimes, because copying shows up differently when rare vs endemic:
//   Tier A — near-identical papers: very few differences alongside many shared
//            wrong answers. Catches whole copying clusters even in a small, hard
//            exam where z-scores are saturated and useless.
//   Tier B — outlier dyad: shared-wrong count far above the whole-exam background
//            (z-score), GATED by Harpp-Hogan ratio ≥ 1 (shared-wrong ≥ differences)
//            so a weak-but-honest student who hits popular distractors with many
//            peers (a "hub" of high-difference pairs) is NOT flagged.
//
// Output is investigative leads, never proof — the UI states this plainly.

export const DEFAULT_INTEGRITY_OPTS = {
  zFlag: 4,                   // Tier B: z-score of shared-wrong vs exam background
  identicalDiffMax: 5,        // Tier A: at most this many differing answers
  identicalSharedWrongMin: 8, // Tier A: at least this many shared wrong answers
  minBothAnswered: 10,        // ignore pairs with too little common ground
  minSharedWrongList: 6,      // noise floor — never even consider pairs below this
  rollAdjacencyMax: 2,        // |rollA − rollB| ≤ this → "adjacent seats"
}

function hasChoices(s) {
  const c = s && s.choices
  if (!c) return false
  for (const k in c) if (c[k] != null) return true
  return false
}

function rollInt(r) {
  if (r == null) return null
  const digits = String(r).replace(/\D/g, '')
  return digits === '' ? null : parseInt(digits, 10)
}

export function buildExamIntegrityReport(exam, opts = {}) {
  const o = { ...DEFAULT_INTEGRITY_OPTS, ...opts }
  const examId = exam && exam.id
  const examName = exam && exam.name
  const empty = (available, reason, nStudents = 0) => ({
    available, reason, examId, examName, nStudents,
    background: { meanSharedWrong: 0, sdSharedWrong: 0 }, pairs: [], clusters: [],
  })

  if (!exam || !exam.questions || !exam.questions.length) {
    return empty(false, 'This is an offline exam — there are no per-question answers to analyse.')
  }

  const students = (exam.students || []).filter(hasChoices)
  if (students.length === 0) {
    return empty(false, 'No chosen options were captured for this exam (uploaded before answer-capture began on 2026-06-10). Re-upload the Evalbee results to enable integrity analysis.')
  }

  // ── Pairwise comparison over commonly-answered questions ──
  const raw = []
  for (let i = 0; i < students.length; i++) {
    for (let j = i + 1; j < students.length; j++) {
      const a = students[i], b = students[j]
      let sameWrong = 0, sameCorrect = 0, diff = 0, both = 0
      const sharedWrongQ = []
      for (const q in a.choices) {
        const ca = a.choices[q]
        if (ca == null) continue
        const cb = b.choices[q]
        if (cb == null) continue
        both++
        if (ca === cb) {
          const verdict = a.responses ? a.responses[q] : undefined
          if (verdict === -1) { sameWrong++; sharedWrongQ.push({ q, choice: ca }) }
          else if (verdict === 1) sameCorrect++
          // verdict 0/undefined (no answer key) → ignored, not counted as wrong
        } else {
          diff++
        }
      }
      sharedWrongQ.sort((x, y) => Number(x.q) - Number(y.q))
      raw.push({ a, b, sameWrong, sameCorrect, diff, both, sharedWrongQ })
    }
  }

  // ── Background distribution of shared-wrong over comparable pairs ──
  const eligible = raw.filter(p => p.both >= o.minBothAnswered)
  const swVals = eligible.map(p => p.sameWrong)
  const n = swVals.length
  const mean = n ? swVals.reduce((s, v) => s + v, 0) / n : 0
  const variance = n ? swVals.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0
  const sd = Math.sqrt(variance)

  // ── Classify ──
  const pairs = []
  for (const p of eligible) {
    if (p.sameWrong < o.minSharedWrongList) continue
    const hh = p.diff > 0 ? p.sameWrong / p.diff : Infinity
    const z = sd > 0 ? (p.sameWrong - mean) / sd : null
    const agreeRate = p.both > 0 ? (p.sameWrong + p.sameCorrect) / p.both : 0

    let tier = null
    if (p.diff <= o.identicalDiffMax && p.sameWrong >= o.identicalSharedWrongMin) {
      tier = 'A'
    } else if (z != null && z >= o.zFlag && hh >= 1) {
      tier = 'B'
    }
    if (!tier) continue

    const ra = rollInt(p.a.rollNo), rb = rollInt(p.b.rollNo)
    const rollAdjacent = ra != null && rb != null && ra !== rb && Math.abs(ra - rb) <= o.rollAdjacencyMax

    pairs.push({
      a: { name: p.a.name, rollNo: p.a.rollNo || '', score: p.a.totalMarks },
      b: { name: p.b.name, rollNo: p.b.rollNo || '', score: p.b.totalMarks },
      sameWrong: p.sameWrong, sameCorrect: p.sameCorrect, diff: p.diff, bothAnswered: p.both,
      hh: p.diff > 0 ? Math.round(hh * 100) / 100 : null,
      agreeRate: Math.round(agreeRate * 100) / 100,
      z: z == null ? null : Math.round(z * 10) / 10,
      rollAdjacent, tier, sharedWrongQ: p.sharedWrongQ,
    })
  }

  // Severity sort: Tier A before B; then most-identical first (sameWrong − diff), then z.
  pairs.sort((x, y) => {
    if (x.tier !== y.tier) return x.tier === 'A' ? -1 : 1
    const sx = x.sameWrong - x.diff, sy = y.sameWrong - y.diff
    if (sy !== sx) return sy - sx
    return (y.z ?? 0) - (x.z ?? 0)
  })

  return {
    available: true, examId, examName, nStudents: students.length,
    background: { meanSharedWrong: Math.round(mean * 100) / 100, sdSharedWrong: Math.round(sd * 100) / 100 },
    pairs, clusters: buildClusters(pairs),
  }
}

// Union-find over flagged pairs that share a member → copying clusters/rings.
function buildClusters(pairs) {
  const parent = new Map()
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) }
    return x
  }
  const union = (a, b) => { parent.set(find(a), find(b)) }
  for (const p of pairs) {
    if (!parent.has(p.a.name)) parent.set(p.a.name, p.a.name)
    if (!parent.has(p.b.name)) parent.set(p.b.name, p.b.name)
    union(p.a.name, p.b.name)
  }
  const groups = new Map()
  for (const p of pairs) {
    const root = find(p.a.name)
    if (!groups.has(root)) groups.set(root, { members: new Set(), pairCount: 0, maxSameWrong: 0 })
    const g = groups.get(root)
    g.members.add(p.a.name); g.members.add(p.b.name)
    g.pairCount++
    g.maxSameWrong = Math.max(g.maxSameWrong, p.sameWrong)
  }
  return [...groups.values()]
    .map(g => ({ members: [...g.members].sort(), pairCount: g.pairCount, maxSameWrong: g.maxSameWrong }))
    .sort((a, b) => b.members.length - a.members.length || b.maxSameWrong - a.maxSameWrong)
}
