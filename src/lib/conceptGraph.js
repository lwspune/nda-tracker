// ── Concept prerequisite graph (NDA Maths) ───────────────────────────────────
// A chapter-level DAG linking each chapter to the chapters it depends on.
// Powers *root-cause* advice ("you're weak in Definite Integration, but the real
// gap is Indefinite Integration") and *sequencing* advice ("ready to learn next").
//
// NODES are the canonical NDA Maths taxonomy (src/lib/ndaFreq.js →
// NDA_FREQ_BY_SUBJECT.Maths). Keeping node names identical to that list is
// load-bearing: getRootCauseChain / getReadyToLearn consume the per-chapter
// accuracy emitted by getPriorityChapters / computeProjectedScore, which key on
// exactly these names. A node typo silently drops that chapter from the analysis.
// The `conceptGraph.test.js` "data shape" suite fails if any node is off-canonical
// or the graph ever grows a cycle.
//
// EDGES are faculty-curated expert knowledge, not derived from data. This is a
// STARTER set based on the standard NDA Maths dependency order — red-pen it.
// `X: [...]` reads "X depends on these prerequisites". Chapters absent here (or
// with `[]`) are treated as foundational (no prerequisites).
export const CHAPTER_PREREQS = {
  // Algebra spine
  Functions:                  ['Sets & Relations'],
  'Binomial Theorem':         ['Permutation & Combination'],

  // Trigonometry
  'Trigonometric Equations':  ['Trigonometric Identities'],
  'Inverse Trigonometry':     ['Trigonometric Identities'],
  'Height & Distance':        ['Trigonometric Identities'],
  'Properties of Triangle':   ['Trigonometric Identities'],

  // Calculus chain
  'Limits & Continuity':      ['Functions'],
  Differentiation:            ['Limits & Continuity'],
  'Application of Derivatives': ['Differentiation'],
  'Indefinite Integration':   ['Differentiation'],
  'Definite Integration':     ['Indefinite Integration'],
  'Applications of Integration': ['Definite Integration'],
  'Differential Equations':   ['Indefinite Integration'],

  // Coordinate & vector geometry
  Circles:                    ['Lines'],
  Conics:                     ['Circles'],
  '3D Geometry':              ['Vectors', 'Lines'],

  // Probability & statistics
  Probability:                ['Permutation & Combination', 'Sets & Relations'],
  'Binomial Distribution':    ['Probability', 'Binomial Theorem'],

  // Foundational (no prerequisites): Logarithms, Linear Inequalities,
  // Binary Numbers, Matrices & Determinants, Quadratic Equations,
  // Complex Numbers, Sequence & Series, Permutation & Combination,
  // Sets & Relations, Trigonometric Identities, Vectors, Lines, Statistics.
}

// Direct prerequisites of a chapter (always an array).
export function getPrerequisites(chapter, graph = CHAPTER_PREREQS) {
  return graph[chapter] || []
}

// Validate the graph: every node canonical, and acyclic.
// Returns { unknownNodes: string[], cycles: string[][] }.
export function validateConceptGraph(graph = CHAPTER_PREREQS, canonicalChapters) {
  const canonical = canonicalChapters ? new Set(canonicalChapters) : null

  // Unknown nodes — any key or prerequisite not in the canonical set.
  const unknown = new Set()
  if (canonical) {
    Object.entries(graph).forEach(([node, prereqs]) => {
      if (!canonical.has(node)) unknown.add(node)
      ;(prereqs || []).forEach(p => { if (!canonical.has(p)) unknown.add(p) })
    })
  }

  // Cycle detection via DFS colouring (white/grey/black).
  const cycles = []
  const state = {} // node -> 'grey' | 'black'
  const stack = []

  const visit = node => {
    state[node] = 'grey'
    stack.push(node)
    for (const dep of graph[node] || []) {
      if (state[dep] === 'grey') {
        // Back-edge — capture the cycle from `dep` down the current stack.
        const from = stack.indexOf(dep)
        cycles.push(stack.slice(from).concat(dep))
      } else if (state[dep] !== 'black') {
        visit(dep)
      }
    }
    stack.pop()
    state[node] = 'black'
  }

  Object.keys(graph).forEach(node => { if (!state[node]) visit(node) })

  return { unknownNodes: [...unknown], cycles }
}

// Normalise an accuracy map to case-insensitive lookup.
// Values are 0..1 or null/undefined (untested).
function normAccuracy(accuracyByChapter) {
  const m = {}
  Object.entries(accuracyByChapter || {}).forEach(([k, v]) => {
    m[k.toLowerCase()] = v
  })
  return m
}

const isWeak = (acc, threshold) =>
  acc !== null && acc !== undefined && acc < threshold

// getRootCauseChain — for every weak chapter, find the deepest weak prerequisite
// reachable through the graph. That deepest weak chapter is the *root cause*:
// the place to start remediation. A weak chapter with no weak prerequisites is
// its own root (isRoot=true). Untested chapters are "unknown", never weak.
//
// accuracyByChapter: { <chapter name>: number|null }  (case-insensitive)
// returns: [{ chapter, accuracy, root, rootAccuracy, isRoot }]  (one per weak chapter)
export function getRootCauseChain(accuracyByChapter, { threshold = 0.5, graph = CHAPTER_PREREQS } = {}) {
  const acc = normAccuracy(accuracyByChapter)
  const accOf = ch => acc[ch.toLowerCase()]

  // Deepest weak ancestor of `chapter`, following only weak prerequisites.
  const findRoot = (chapter, seen = new Set()) => {
    if (seen.has(chapter)) return chapter // cycle guard
    seen.add(chapter)
    const weakPrereqs = getPrerequisites(chapter, graph).filter(p => isWeak(accOf(p), threshold))
    if (!weakPrereqs.length) return chapter
    // Prefer the prerequisite whose own root is weakest (lowest accuracy).
    let best = null
    for (const p of weakPrereqs) {
      const r = findRoot(p, seen)
      if (best === null || (accOf(r) ?? 1) < (accOf(best) ?? 1)) best = r
    }
    return best
  }

  // Every chapter that appears anywhere in the graph or the accuracy map.
  const chapters = new Set([
    ...Object.keys(graph),
    ...Object.values(graph).flat(),
    ...Object.keys(accuracyByChapter || {}),
  ])

  const out = []
  chapters.forEach(chapter => {
    const a = accOf(chapter)
    if (!isWeak(a, threshold)) return
    const root = findRoot(chapter)
    out.push({
      chapter,
      accuracy: a,
      root,
      rootAccuracy: accOf(root) ?? null,
      isRoot: root === chapter,
    })
  })

  // Weakest root cause first — the highest-leverage place to start.
  return out.sort((x, y) => (x.rootAccuracy ?? 1) - (y.rootAccuracy ?? 1))
}

// rootCauseMap — adapt getPriorityChapters / computeProjectedScore rows into a
// compact { weakChapter: rootCause } map for UI annotation. Keyed only where the
// root cause is a *different* (deeper, weak) chapter — self-roots are omitted so
// the caller can render "↳ root cause: X" without a redundant self-reference.
// Rows carry { chapter, accuracy } (accuracy null = untested).
export function rootCauseMap(rows, { threshold = 0.5, graph = CHAPTER_PREREQS } = {}) {
  const accByChapter = {}
  ;(rows || []).forEach(r => { accByChapter[r.chapter] = r.accuracy ?? null })
  const map = {}
  getRootCauseChain(accByChapter, { threshold, graph }).forEach(({ chapter, root, isRoot }) => {
    if (!isRoot) map[chapter] = root
  })
  return map
}

// getReadyToLearn — the unlockable frontier: chapters not yet mastered whose
// every prerequisite IS mastered. Serves "what should I study next" and the
// from-zero sequencing use-case. A chapter is mastered when tested and its
// accuracy >= masteredThreshold; untested prerequisites are NOT satisfied.
//
// returns: [{ chapter, accuracy }]
export function getReadyToLearn(accuracyByChapter, { masteredThreshold = 0.7, graph = CHAPTER_PREREQS } = {}) {
  const acc = normAccuracy(accuracyByChapter)
  const accOf = ch => acc[ch.toLowerCase()]
  const isMastered = ch => {
    const a = accOf(ch)
    return a !== null && a !== undefined && a >= masteredThreshold
  }

  const chapters = new Set([
    ...Object.keys(graph),
    ...Object.values(graph).flat(),
    ...Object.keys(accuracyByChapter || {}),
  ])

  const out = []
  chapters.forEach(chapter => {
    if (isMastered(chapter)) return
    const prereqs = getPrerequisites(chapter, graph)
    if (prereqs.every(isMastered)) out.push({ chapter, accuracy: accOf(chapter) ?? null })
  })

  return out
}
