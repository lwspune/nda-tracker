// NDA Maths chapter frequency defaults
// Derived from PYQ analysis 2018–2024 (16 papers, 120 Qs, 300 marks each)
// These are the MASTER chapter names — used everywhere in the app
// pct = percentage of paper. NDA marks = pct * 3

export const NDA_FREQ_DEFAULT = [
  { chapter: 'Logarithms',                  pct: 2.5 },
  { chapter: 'Linear Inequalities',         pct: 1.7 },
  { chapter: 'Functions',                   pct: 2.5 },
  { chapter: 'Binary Numbers',              pct: 1.7 },
  { chapter: 'Matrices & Determinants',     pct: 8.3 },
  { chapter: 'Complex Numbers',             pct: 4.2 },
  { chapter: 'Quadratic Equations',         pct: 3.3 },
  { chapter: 'Sequence & Series',           pct: 3.3 },
  { chapter: 'Permutation & Combination',   pct: 3.3 },
  { chapter: 'Binomial Theorem',            pct: 2.5 },
  { chapter: 'Sets & Relations',            pct: 2.5 },
  { chapter: 'Trigonometric Identities',    pct: 4.2 },
  { chapter: 'Trigonometric Equations',     pct: 2.5 },
  { chapter: 'Height & Distance',           pct: 2.5 },
  { chapter: 'Inverse Trigonometry',        pct: 2.5 },
  { chapter: 'Properties of Triangle',      pct: 2.5 },
  { chapter: 'Differentiation',             pct: 8.3 },
  { chapter: 'Integration',                 pct: 8.3 },
  { chapter: 'Area Under Curve',            pct: 2.5 },
  { chapter: 'Limits & Continuity',         pct: 3.3 },
  { chapter: 'Differential Equations',      pct: 2.5 },
  { chapter: 'Lines',                       pct: 3.3 },
  { chapter: 'Circles',                     pct: 2.5 },
  { chapter: 'Conics',                      pct: 2.5 },
  { chapter: 'Vectors',                     pct: 4.2 },
  { chapter: '3D Geometry',                 pct: 4.2 },
  { chapter: 'Statistics',                  pct: 5.8 },
  { chapter: 'Probability',                 pct: 5.0 },
]

// Get a freq lookup map: { 'trigonometric identities': { pct, marks }, ... }
export function getFreqMap(ndaFreq) {
  const rows = ndaFreq?.length ? ndaFreq : NDA_FREQ_DEFAULT
  const map = {}
  rows.forEach(r => {
    map[r.chapter.toLowerCase()] = {
      chapter: r.chapter,
      pct: parseFloat(r.pct) || 0,
      marks: (parseFloat(r.pct) || 0) * 3,
    }
  })
  return map
}
