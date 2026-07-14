// NDA subject list — single source of truth for the app
// GAT is included for exam tagging (combined mocks), but is NOT independently
// configurable in the freq table — its total marks are always derived.
export const SUBJECTS = [
  'Maths',
  'English',
  'Physics',
  'Chemistry',
  'Biology',
  'Geography',
  'History',
  'Polity',
  'Economics',
  'GAT',
  'Others',
]

// ── Per-subject default chapter frequency tables ─────────────────────────────
// Maths: PYQ Vault weightage — 2,160 questions across 2017–2026 papers
// (pyqvault.com/guide/nda-maths). Other subjects: empty by default — faculty
// can configure via the freq editor. pct = % share of the paper; NDA Maths
// marks = pct × 3. Shares are normalised to sum to exactly 100 (0.2% shaved
// off the top row vs the source's rounded 100.2%).

export const NDA_FREQ_BY_SUBJECT = {
  // Chapter NAMES are the canonical NDA Maths taxonomy from PYQ Vault (the
  // content master) — kept in sync so an auto-generated tagged sheet validates
  // cleanly. `getValidChapters` reads this list for validation; the freq CHART
  // reads each user's persisted `ndaFreqBySubject`, so these pct values only
  // seed new installs.
  Maths: [
    { chapter: 'Logarithms',                  pct: 1.3 },
    { chapter: 'Linear Inequalities',         pct: 0.2 },
    { chapter: 'Functions',                   pct: 5.0 },
    { chapter: 'Binary Numbers',              pct: 0.6 },
    { chapter: 'Matrices & Determinants',     pct: 7.7 },
    { chapter: 'Complex Numbers',             pct: 3.3 },
    { chapter: 'Quadratic Equations',         pct: 2.9 },
    { chapter: 'Sequence & Series',           pct: 4.1 },
    { chapter: 'Permutation & Combination',   pct: 3.6 },
    { chapter: 'Binomial Theorem',            pct: 2.5 },
    { chapter: 'Sets & Relations',            pct: 3.2 },
    { chapter: 'Trigonometric Identities',    pct: 6.4 },
    { chapter: 'Trigonometric Equations',     pct: 1.5 },
    { chapter: 'Height & Distance',           pct: 1.1 },
    { chapter: 'Inverse Trigonometry',        pct: 1.6 },
    { chapter: 'Properties of Triangle',      pct: 2.3 },
    { chapter: 'Differentiation',             pct: 3.9 },
    { chapter: 'Application of Derivatives',  pct: 3.4 },
    { chapter: 'Indefinite Integration',      pct: 1.9 },
    { chapter: 'Definite Integration',        pct: 3.1 },
    { chapter: 'Applications of Integration', pct: 1.2 },
    { chapter: 'Limits & Continuity',         pct: 3.8 },
    { chapter: 'Differential Equations',      pct: 2.9 },
    { chapter: 'Lines',                       pct: 4.5 },
    { chapter: 'Circles',                     pct: 1.3 },
    { chapter: 'Conics',                      pct: 1.8 },
    { chapter: 'Vectors',                     pct: 4.5 },
    { chapter: '3D Geometry',                 pct: 4.1 },
    { chapter: 'Statistics',                  pct: 7.4 },
    { chapter: 'Probability',                 pct: 7.5 },
    { chapter: 'Binomial Distribution',       pct: 1.4 },
  ],
  English:   [],
  Physics:   [],
  Chemistry: [],
  Biology:   [],
  Geography: [],
  History:   [],
  Polity:    [],
  Economics: [],
  GAT:       [],
  Others:    [],
}

// ── Per-subject NDA total marks ──────────────────────────────────────────────
// These are the official NDA paper marks for each subject.
// GAT is derived (sum of the 9 component subjects) and must never be set here.
export const NDA_TOTAL_MARKS_BY_SUBJECT = {
  Maths:     300,
  English:   200,
  Physics:   100,
  Chemistry:  60,
  Biology:    40,
  Geography:  80,
  History:    50,
  Polity:     30,
  Economics:  10,
  Others:     30,
  // GAT intentionally absent — always computed as sum of above non-Maths subjects
}

// Subjects whose marks are independently configurable (excludes GAT)
export const CONFIGURABLE_SUBJECTS = SUBJECTS.filter(s => s !== 'GAT')

// GAT total = sum of all non-Maths, non-GAT subject marks
export function computeGatTotal(marksBySubject) {
  return CONFIGURABLE_SUBJECTS
    .filter(s => s !== 'Maths')
    .reduce((sum, s) => sum + (marksBySubject[s] ?? NDA_TOTAL_MARKS_BY_SUBJECT[s] ?? 0), 0)
}

// Build default ndaMarksBySubject state (fresh copy)
export function buildDefaultMarksBySubject() {
  return { ...NDA_TOTAL_MARKS_BY_SUBJECT }
}

// Backward-compat alias — used by legacy code before Phase 3 migration
export const NDA_FREQ_DEFAULT = NDA_FREQ_BY_SUBJECT.Maths

// Build default ndaFreqBySubject state (fresh copy, no shared references)
export function buildDefaultFreqBySubject() {
  return Object.fromEntries(
    SUBJECTS.map(s => [s, [...(NDA_FREQ_BY_SUBJECT[s] || [])]])
  )
}

// Get a freq lookup map: { 'trigonometric identities': { pct, marks }, ... }
export function getFreqMap(rows) {
  const list = rows?.length ? rows : NDA_FREQ_BY_SUBJECT.Maths
  const map = {}
  list.forEach(r => {
    map[r.chapter.toLowerCase()] = {
      chapter: r.chapter,
      pct: parseFloat(r.pct) || 0,
      marks: (parseFloat(r.pct) || 0) * 3,
    }
  })
  return map
}

// Resolve the freq rows for a given subject from the by-subject store field
// Falls back to Maths if subject is unknown or has no rows configured
export function getFreqForSubject(ndaFreqBySubject, subject) {
  const rows = ndaFreqBySubject?.[subject]
  return rows?.length ? rows : (ndaFreqBySubject?.Maths || NDA_FREQ_BY_SUBJECT.Maths)
}

// Sync saved freq rows with chapters currently in uploaded exams for a subject.
// Keeps existing pct values, adds missing chapters (pct=0), removes stale ones.
// Collects from both direct subject exams AND GAT-routed per-question subjects.
// Returns { rows: [...], added: [...], removed: [...] }
export function syncFreqChapters(savedFreq, exams, subject) {
  const currentChapters = new Set()
  exams.forEach(e => {
    const examSubject = e.subject || 'Maths'
    ;(e.questions || []).forEach(q => {
      if (examSubject !== subject && q.subject !== subject) return
      if (q.chapter && q.chapter !== 'Unknown') currentChapters.add(q.chapter)
    })
  })

  const savedMap = new Map(savedFreq.map(r => [r.chapter, r.pct]))
  const added   = [...currentChapters].filter(c => !savedMap.has(c)).sort()
  const removed = savedFreq.filter(r => !currentChapters.has(r.chapter)).map(r => r.chapter)
  const sorted  = [...currentChapters].sort()
  const base    = parseFloat((100 / sorted.length).toFixed(1))
  const rows    = sorted.map((chapter, i) => ({
    chapter,
    pct: i === sorted.length - 1
      ? parseFloat((100 - base * (sorted.length - 1)).toFixed(1))
      : base,
  }))

  return { rows, added, removed }
}

// Derive a chapter frequency list from uploaded exams for a given subject.
// Collects all unique chapter names, assigns equal weights summing to 100%.
// Returns null when no exams/chapters are found for that subject.
export function deriveFreqFromExams(exams, subject) {
  const chapters = new Set()
  exams.forEach(e => {
    if ((e.subject || 'Maths') !== subject) return
    ;(e.questions || []).forEach(q => {
      if (q.chapter && q.chapter !== 'Unknown') chapters.add(q.chapter)
    })
  })
  if (!chapters.size) return null

  const sorted = [...chapters].sort()
  const base   = parseFloat((100 / sorted.length).toFixed(1))
  // Assign equal weights; absorb rounding error into the last row
  return sorted.map((chapter, i) => ({
    chapter,
    pct: i === sorted.length - 1
      ? parseFloat((100 - base * (sorted.length - 1)).toFixed(1))
      : base,
  }))
}
