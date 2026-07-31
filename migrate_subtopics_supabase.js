// Apply subtopic renames to the Supabase exams.questions JSONB column.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_subtopics_supabase.js [flags]
//
// --dry-run         Fetch + analyse but write nothing.
// --chapters-only   Apply CHAPTER_RENAMES only, ignore SUBTOPIC_RENAMES.
// --subtopics-only  Apply SUBTOPIC_RENAMES only, ignore CHAPTER_RENAMES.
//
// Run AFTER merge_subtopics.py has updated data/faculty-data.json (local).
// This script targets Supabase directly so prod data stays in sync.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')
const SCOPE        = {
  chaptersOnly:  process.argv.includes('--chapters-only'),
  subtopicsOnly: process.argv.includes('--subtopics-only'),
}
if (SCOPE.chaptersOnly && SCOPE.subtopicsOnly) {
  console.error('Error: --chapters-only and --subtopics-only are mutually exclusive.')
  process.exit(1)
}

if (!SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
  process.exit(1)
}

// ── Rename map (must stay in sync with merge_subtopics.py) ─────────────────
const SUBTOPIC_RENAMES = {
  // Chemistry / Matter in Our Surrounding
  'Kinetic Energy and States':          'Kinetic Energy and States of Matter',
  'Kinetic Energy and Temperature':     'Kinetic Energy and States of Matter',
  'Kinetic Energy in States':           'Kinetic Energy and States of Matter',
  'Properties of Matter':               'Properties of States of Matter',
  'Properties of Gases':                'Properties of States of Matter',
  'Properties of States':               'Properties of States of Matter',

  // Chemistry / Solutions
  "Raoult's Law - Vapour Pressure of Pure Component": "Raoult's Law — Vapour Pressure",
  "Raoult's Law - Vapour Pressure of Pure Liquid":    "Raoult's Law — Vapour Pressure",

  // Maths / Complex Numbers
  'Multiplication and Division of Complex Numbers':   'Multiplication of Complex Numbers',

  // Maths / Differentiation
  'Implicit Differentiation of Exponential-Logarithmic Equations':
      'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Inverse Trig — Simplification':   'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Inverse Trig — Rational Forms':   'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Inverse Trig — Sum of Terms':     'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Inverse Trig — Half-Angle Forms': 'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Inverse Trig — Composite':        'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Standard Inverse Trig Derivatives':                  'Standard Derivatives',
  'Standard Log-Trig Derivatives':                      'Standard Derivatives',

  // Maths / Functions
  'Algebra of Functions — Domain':    'Algebra of Functions',
  'Algebra of Functions — Addition':  'Algebra of Functions',
  'Algebra of Functions — Division':  'Algebra of Functions',
  'Decomposition of Functions':       'Composition and Inverse of Functions',

  // Maths / Quadratic Equations
  'BODMAS – Area Calculation':                           'BODMAS — Applications',
  'BODMAS – Volume Calculation':                         'BODMAS — Applications',
  'Quadratic – Nature of Roots (Discriminant Check)':   'Quadratic – Nature of Roots (Discriminant)',
  'Complex Roots – Form Equation from Given Roots':     'Complex Roots – Form Equation from Roots',

  // Maths / Sets & Relations
  'Equivalence Relation on N×N':  'Relations — Properties, Cartesian Product, and Counting',

  // Maths / Trigonometric Identities
  'Cosecant and Cotangent Identities': 'Reciprocal and Quotient Identities',
  'Secant and Tangent Identities':     'Reciprocal and Quotient Identities',

  // ── Maths subject-wide cleanup (2026-06-16) ────────────────────────────
  // Circles
  'Radius of circle':                       'Radius of Circle',
  'Tangent to a Circle':                    'Inscribed Geometry, Tangents, and Segments',
  // Complex Numbers
  'Argument of Complex Number':             'Modulus, Argument, and Conjugate',
  // Differentiation
  'Derivative of Absolute Value Functions': 'Differentiability of Absolute Value, Piecewise, and Greatest Integer Functions',
  'Increasing/Decreasing Functions':        'Monotonicity, Extrema, and Critical Points',
  'Inverse Trigonometric Derivatives':      'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  // Lines
  'Diagonal of parallelogram':              'Diagonal of Parallelogram',
  'Area of square — parallel side lines':   'Area of Square from Parallel Sides',
  'Area of square from parallel sides':     'Area of Square from Parallel Sides',
  'Collinearity condition':                 'Collinearity Condition',
  'Collinearity of points':                 'Collinearity of Points',
  'Distance between parallel lines':        'Distance, Section, and Locus',
  'Perpendicular line through point':       'Perpendicular Line Through a Point',
  // Matrices & Determinants
  'Adjoint of 2×2 matrix':                  'Cofactors, Adjoint, and Inverse',
  'Determinant with cube roots of unity':   'Determinant with Cube Roots of Unity',
  'Inverse of Matrix':                      'Cofactors, Adjoint, and Inverse',
  'Sum of two determinants':                'Sum of Determinants',
  'Trigonometric determinant':              'Trigonometric Determinants',
  // Probability
  'Conditional probability':                "Conditional Probability, Total Probability, and Bayes' Theorem",
  // Quadratic Equations
  'Common Root of Two Equations':           'Common Roots of Two Quadratics',
  'Common roots of two quadratics':         'Common Roots of Two Quadratics',
  'Complex Roots of Quadratic':             'Complex Roots of Quadratic Equations',
  'Complex roots of quadratic equations':   'Complex Roots of Quadratic Equations',
  'Ratio of roots':                         'Ratio of Roots',
  // Sequence & Series
  'Sum of infinite GP':                     'Sum of Infinite GP',
  // Trigonometric Identities
  'Double Angle Formula':                   'Multiple and Half-Angle Formulas',

  // ── Maths cleanup (2026-07-14) ─────────────────────────────────────────
  // Vectors
  // Applications of Integration
  'Area Bounded by Curves, Axes, and Lines':  'Area Bounded by a Curve, Lines, and Axes',
  // Lines
  'Acute angle between two specific lines':  'Acute angle between two lines',
  // Complex Numbers — cube-roots-of-unity same-concept fold
  'Cube roots of unity — powers':           'Cube Roots of Unity',
  'Cube roots of unity — product':          'Cube Roots of Unity',
  'Cube roots — multiple of 3 exponent':    'Cube Roots of Unity',
  'High powers via cube roots periodicity': 'Cube Roots of Unity',
  'Sum of powers of cube roots':            'Cube Roots of Unity',
  'Sum of products of cube roots':          'Cube Roots of Unity',

  // ── Cleanup Tier 1 (2026-07-29) ────────────────────────────────────────
  // Mechanical only: casing, `&`-vs-`and`, plural/suffix, exact synonym.
  // Concept merges (Tier 2) and judgment calls (Tier 3) are NOT here.
  // English
  'Sentence Rearrangement':                  'Sentence Rearrangement (PQRS)',
  'Factual Detail Recall':                   'Factual Detail Retrieval',
  'Mixed Error Detection':                   'Error Detection',
  'Yes/No Question Reporting':               'Question Reporting',
  'Determiners & Pronouns':                  'Determiners and Pronouns',
  'Articles and Determiners':                'Grammar - Articles and Determiners',
  'Change & Transition Idioms':              'Change & Transformation Idioms',
  // Maths
  'Binary to decimal conversion':            'Binary to Decimal Conversion',
  'Roots of Unity':                          'Cube Roots of Unity',
  'Logarithmic Differentiation of Products': 'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Properties of Determinants with AP':      'Determinant Properties, Operations, and Sums',
  'Arrangements with restricted repetitions': 'Arrangements with Restrictions',
  'Conditional probability with dice':       "Conditional Probability, Total Probability, and Bayes' Theorem",
  'Sum of GP':                               'Geometric Progressions',
  'nth term of GP':                          'Geometric Progressions',
  'Arithmetic mean of AP':                   'Arithmetic Mean',
  'Period of trigonometric functions':       'Periodicity of Trigonometric Functions',
  // Chemistry
  'Isotopes and average atomic mass':        'Isotopes and Average Atomic Mass',
  'Electronic configuration and shells':     'Electronic Configuration',
  "Rutherford's nuclear model":              "Rutherford's Nuclear Model",
  "Rutherford's nuclear model limitations":  "Rutherford's Nuclear Model",
  'Physical vs chemical changes':            'Physical vs Chemical Changes',
  'Physical vs chemical processes':          'Physical vs Chemical Changes',
  'Oxidation and reduction':                 'Oxidation and Reduction',
  'Oxidation and reduction concepts':        'Oxidation and Reduction',
  'Oxidation reactions':                     'Oxidation and Reduction',
  'Empirical Formula Mass':                  'Empirical Formula',
  'Formula Mass Calculation':                'Molar Mass Calculations',
  'Noble gases':                             'Noble Gases',
  'Separation of liquid mixtures':           'Separation of Mixtures',
  'Separation of mixtures':                  'Separation of Mixtures',
  // Physics
  'Electrostatic Potential':                 'Electric Potential',
  'Distance and Displacement':               'Distance vs Displacement',
  'Torque from Change in Angular Momentum – Ring':
      'Torque from Change in Angular Momentum',
  // Geography
  'Seismic Waves & Earth Structure':         "Seismic Waves & Earth's Interior",
  "Seismic Waves & Earth's Core":            "Seismic Waves & Earth's Interior",

  // ── Cleanup Tier 2 (2026-07-29) ────────────────────────────────────────
  // Applied to prod 2026-07-29 (69 questions / 10 exams, --subtopics-only).
  // Concept merges: buckets split by prop / scenario / keyword rather than by
  // concept. Same-chapter only — a subtopic appearing in two chapters with two
  // different correct targets is NOT here (see the Tier 2 test).
  // English / Grammar — Question Tags tense + polarity families.
  "Question Tags – Be Verb (Simple Present)":      'Question Tags – Simple Present',
  'Question Tags – Simple Present (3rd Person)':   'Question Tags – Simple Present',
  'Question Tags – Simple Present (Action Verb)':  'Question Tags – Simple Present',
  'Question Tags – Simple Present (Does)':         'Question Tags – Simple Present',
  'Question Tags – Simple Present (Habitual)':     'Question Tags – Simple Present',
  'Question Tags – Simple Present (Likes/Habits)': 'Question Tags – Simple Present',
  'Question Tags – Could/Past Simple':             'Question Tags – Past Simple',
  'Question Tags – Past Simple (Be Verb)':         'Question Tags – Past Simple',
  'Question Tags – Simple Past':                   'Question Tags – Past Simple',
  'Question Tags – Modal Must':                    'Question Tags – Modal Verbs',
  'Question Tags – Modal Should + Plural Subject': 'Question Tags – Modal Verbs',
  'Question Tags – Can (Ability/Possibility)':     'Question Tags – Can',
  'Question Tags – Can (Affirmative)':             'Question Tags – Can',
  'Question Tags – Negative + Does':               'Question Tags – Negative Clause',
  "Question Tags – Negative + Won't":              'Question Tags – Negative Clause',
  'Question Tags – Negative Main Clause':          'Question Tags – Negative Clause',
  // English / Phrasal Verbs
  "Phrasal Verbs with 'Call'":               'Phrasal Verbs',
  "Phrasal Verbs with 'Carry'":              'Phrasal Verbs',
  "Phrasal Verbs with 'Come'":               'Phrasal Verbs',
  "Phrasal Verbs with 'Keep'":               'Phrasal Verbs',
  "Phrasal Verbs with 'Put'":                'Phrasal Verbs',
  "Phrasal Verbs with 'Run'":                'Phrasal Verbs',
  // Maths / Probability
  'Classical Probability — Cards':           'Probability via Counting',
  'Classical Probability — Coins':           'Probability via Counting',
  'Classical Probability — Dice':            'Probability via Counting',
  'Classical probability with repeated letters': 'Probability via Counting',
  // Physics / Rotational Dynamics
  'Conservation of Angular Momentum – Collision on Disc':
      'Conservation of Angular Momentum',
  'Conservation of Angular Momentum – Condition':   'Conservation of Angular Momentum',
  'Conservation of Angular Momentum – Earth':       'Conservation of Angular Momentum',
  'Conservation of Angular Momentum – Gymnast':     'Conservation of Angular Momentum',
  'Conservation of Angular Momentum – Human Body':  'Conservation of Angular Momentum',
  // Physics / Optics
  'Total Internal Reflection – Colour Filtering':   'Total Internal Reflection',
  'Total Internal Reflection – Conditions':         'Total Internal Reflection',
  'Total Internal Reflection – Critical Angle':     'Total Internal Reflection',
  'Total Internal Reflection – Critical Angle from Wavelength':
      'Total Internal Reflection',
  'Total Internal Reflection – Prism Ray Path':     'Total Internal Reflection',
  'Total Internal Reflection – Speed Relation':     'Total Internal Reflection',
  // Chemistry / Inorganic Chemistry
  'Common Chemicals — Baking Soda':          'Common Chemicals',
  'Common Chemicals — Bleaching Powder':     'Common Chemicals',
  'Common Chemicals — Limestone':            'Common Chemicals',
  'Common Chemicals — Soda Lime':            'Common Chemicals',
  // Chemistry / Mole Concept
  "Avogadro's Number and Atoms":             "Avogadro's Number",
  "Avogadro's Number and Molecules":         "Avogadro's Number",
  "Avogadro's Number and Neutrons":          "Avogadro's Number",
  // Geography / Atmosphere — the `<X> Cloud Characteristics` family only.
  'Cirrus Cloud Characteristics':            'Cloud Types and Characteristics',
  'Cumulonimbus Cloud Characteristics':      'Cloud Types and Characteristics',
  'Cumulus Cloud Characteristics':           'Cloud Types and Characteristics',
  'Nimbostratus Cloud Characteristics':      'Cloud Types and Characteristics',
  'Nimbus Cloud Characteristics':            'Cloud Types and Characteristics',
  'Stratus Cloud Characteristics':           'Cloud Types and Characteristics',
  'Cloud Types':                             'Cloud Types and Characteristics',

  // ── Maths subtopic conformance to the PYQ Vault taxonomy (2026-07-31) ──
  // Mirrors merge_subtopics.py; test_js_subtopic_map_matches_python guards drift.
  'Position Vectors and Section Formula':                          'Position Vectors and Section',
  'Area Bounded by Curves, Lines, and Axes':                       'Area Bounded by a Curve, Lines, and Axes',
  'Integration by Substitution':                                   'Integration by Substitution — Algebraic, Trigonometric, and Composite Forms',
  'Dot Product and Angle Between Vectors':                         'Dot Product and Angle',
  'Limit Evaluation Techniques':                                   "Limit Evaluation Techniques — L'Hôpital, Rationalization, Standard Forms",
  'Angle of Elevation':                                            'Heights and Distances from Angles of Elevation',
  'Regression':                                                    'Regression and Correlation',
  'Composition of Functions':                                      'Composition and Inverse of Functions',
  'Properties of Determinants':                                    'Determinant Properties, Operations, and Sums',
  'Product-to-Sum Formulas':                                       'Product-to-Sum and Sum-to-Product Identities',
  'Sum-to-Product Formulas':                                       'Product-to-Sum and Sum-to-Product Identities',
  'Classical Probability':                                         'Probability via Counting',
  'Combinatorial Probability':                                     'Probability via Counting',
  'Conditional Probability':                                       "Conditional Probability, Total Probability, and Bayes' Theorem",
  "Bayes' Theorem":                                                "Conditional Probability, Total Probability, and Bayes' Theorem",
  'Addition Theorem':                                              'Event Algebra — Inclusion-Exclusion, Mutually Exclusive, Exhaustive',
  'Scalar Triple Product':                                         'Cross Product and Triple Product',
  'Cross Product and Area':                                        'Cross Product and Triple Product',
  'Magnitude and Unit Vectors':                                    'Magnitude, Components, Projection, and Direction Cosines',
  'Projection and Vector Components':                              'Magnitude, Components, Projection, and Direction Cosines',
  'Parallel and Perpendicular Conditions':                         'Dot Product and Angle',
  'P(X = k)':                                                      'Computing Binomial Probabilities — Exact, At-Least, and Complementary Events',
  'At least / At most':                                            'Computing Binomial Probabilities — Exact, At-Least, and Complementary Events',
  'Continuity at a Point — Finding Parameters':                    'Continuity and Differentiability — Piecewise, Modulus, Composed, Oscillatory',
  'Differentiability and Continuity':                              'Continuity and Differentiability — Piecewise, Modulus, Composed, Oscillatory',
  'Derivatives of Absolute Value Functions':                       'Differentiability of Absolute Value, Piecewise, and Greatest Integer Functions',
  'Implicit Differentiation':                                      'Parametric, Implicit, and Higher-Order Derivatives',
  'Parametric Differentiation':                                    'Parametric, Implicit, and Higher-Order Derivatives',
  'Derivative of One Function with Respect to Another':            'Parametric, Implicit, and Higher-Order Derivatives',
  'Logarithmic Differentiation':                                   'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Inverse Trig Functions':                     'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Exponential and Logarithmic Functions':      'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Polynomial Functions':                       'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Differentiation of Trigonometric Functions':                    'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Inverse Trigonometric Differentiation':                         'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions',
  'Maxima and Minima':                                             'Monotonicity, Extrema, and Critical Points',
  'Increasing and Decreasing Functions':                           'Monotonicity, Extrema, and Critical Points',
  'Tangents and Normals':                                          'Tangents and Slopes',
  'Selection and Arrangement with Constraints':                    'Arrangements with Restrictions',
  'Counting and Geometric Applications':                           'Geometric Counting',
  'Median':                                                        'Measures of Central Tendency — Mean, Median, Mode',
  'Cartesian Product':                                             'Set Operations, Identities, and Cartesian Products of Sets',
  'Union and Intersection of Sets':                                'Set Operations, Identities, and Cartesian Products of Sets',
  'Complement of a Set':                                           'Set Operations, Identities, and Cartesian Products of Sets',
  'Inclusion-Exclusion Principle':                                 'Counting Sets, Subsets, and Inclusion-Exclusion',
  'Power Set':                                                     'Counting Sets, Subsets, and Inclusion-Exclusion',
  'Properties of Relations':                                       'Relations — Properties, Cartesian Product, and Counting',
  'Equivalence Relation':                                          'Relations — Properties, Cartesian Product, and Counting',
  'Domain of a Function':                                          'Domain, Range, and Function Properties',
  'Range of Functions':                                            'Domain, Range, and Function Properties',
  'Inverse Functions':                                             'Composition and Inverse of Functions',
  'Types of Functions':                                            'Function Definition and Classification — Injectivity, Surjectivity, Bijectivity',
  'Solving Function Equations':                                    'Functional Equations',
  'Sum of Geometric Progression':                                  'Geometric Progressions',
  'Geometric Progression - nth Term':                              'Geometric Progressions',
  'Geometric Progression - Common Ratio':                          'Geometric Progressions',
  'Geometric Progression - Sum of Terms':                          'Geometric Progressions',
  'AM-GM-HM Relationship':                                         'Interrelating AP, GP and HP',
  'Summation of Series':                                           'Special Series and Special Sums',
  'Powers of i':                                                   'Powers and Roots',
  'Modulus of a Complex Number':                                   'Modulus, Argument, and Conjugate',
  'Conjugate of a Complex Number':                                 'Modulus, Argument, and Conjugate',
  'Argument of a Complex Number':                                  'Modulus, Argument, and Conjugate',
  'Inverse of a Matrix':                                           'Cofactors, Adjoint, and Inverse',
  'Adjoint of a Matrix':                                           'Cofactors, Adjoint, and Inverse',
  'System of Linear Equations':                                    "Linear Systems — Consistency, Cramer's Rule, Solution Space",
  'Equal Roots Condition':                                         'Nature of Roots and Boundary Conditions',
  'Sum and Product of Roots':                                      "Vieta's Relations and Root-Coefficient Identities",
  'Logarithmic Equations':                                         'Solving Logarithmic Equations and Applications',
  'Equation of a Line':                                            'Equation, Slope, and Family of Lines',
  'Slope and Inclination':                                         'Equation, Slope, and Family of Lines',
  'Angle Between Lines':                                           'Angle Between Lines, Parallelism, and Perpendicularity',
  'Locus of Points':                                               'Distance, Section, and Locus',
  'Distance Between Parallel Lines':                               'Distance, Section, and Locus',
  'Double Angle Formulas':                                         'Multiple and Half-Angle Formulas',
  'Standard Trigonometric Values':                                 'Specific Values and Quadrants',
  'Pythagorean Identities':                                        'Identities, Properties, and Sum-Difference Formulas',
  'Evaluating Logarithms':                                         'Logarithm Identities, Change of Base, and Sums',
  'Integration of Trigonometric Functions':                        'Standard Forms — Exponential, Logarithmic, and Paired Trigonometric Integrals',
  'Tangents to a Circle':                                          'Inscribed Geometry, Tangents, and Segments',

}

// ── Chapter rename map (must stay in sync with merge_subtopics.py) ──────────
const CHAPTER_RENAMES = {
  // Maths — two spellings of the same chapter. Direction REVERSED 2026-07-29:
  // `Height & Distance` is the canonical name in NDA_FREQ_BY_SUBJECT, and
  // computeProjectedScore joins question chapters to that table by exact
  // string match — a miss scores 0. The original 2026-06-16 entry pointed at
  // `Heights and Distances`, which is off the table; it was never run until
  // the Tier 1 sweep, which then moved 2 questions out of scoring range.
  'Heights and Distances': 'Height & Distance',

  // ── Maths chapter conformance (2026-07-29) ─────────────────────────────
  // Chapters tagged under a name the NDA weightage table doesn't carry, so
  // every question under them scored 0 in computeProjectedScore.
  'Limits':           'Limits & Continuity',
  'Straight Line':    'Lines',
  'Area Under Curve': 'Applications of Integration',
  // `Integration` is Indefinite by default; the definite ones are exceptions
  // in CHAPTER_SUBTOPIC_RENAMES below.
  'Integration':      'Indefinite Integration',
  // English — `and` vs `&`; the configured table carries `Idioms & Phrases`.
  'Idioms and Phrases': 'Idioms & Phrases',
}

// ── Chapter renames scoped by subtopic (sync with merge_subtopics.py) ──────
// {chapter: {subtopic: newChapter}}. Takes precedence over CHAPTER_RENAMES.
//
// One chapter name can need more than one target. `Integration` (25 Q) is
// Indefinite Integration for 22 of them and Definite Integration for 3 — a
// chapter-keyed map cannot say that, and picking either target alone would
// misfile the rest into a chapter carrying real NDA weightage.
const CHAPTER_SUBTOPIC_RENAMES = {
  'Integration': {
    'Definite integral of log over symmetric interval':                    'Definite Integration',
    'Definite integral with greatest integer function':                    'Definite Integration',
    'Definite integral with greatest integer function — second constant':  'Definite Integration',
  },
}

// Chapter and subtopic cleanup are separate workstreams that land at different
// times, so the map can legitimately hold prepared-but-unapproved subtopic
// entries while a chapter fix needs to ship. Scope the run rather than
// hand-editing the map before applying.
function applyRenames(questions, { chaptersOnly = false, subtopicsOnly = false } = {}) {
  let changed = 0
  for (const q of questions) {
    // Capture the subtopic BEFORE any subtopic rename — the chapter-scoped map
    // is keyed on the names currently in the data. Reading q.subtopic after the
    // rename below would silently miss any pair whose subtopic also moves.
    const st0 = q.subtopic

    if (!chaptersOnly && st0 && SUBTOPIC_RENAMES[st0]) {
      q.subtopic = SUBTOPIC_RENAMES[st0]
      changed++
    }

    const ch = q.chapter
    if (!subtopicsOnly && ch) {
      const scoped = st0 ? CHAPTER_SUBTOPIC_RENAMES[ch]?.[st0] : undefined
      const next = scoped || CHAPTER_RENAMES[ch]
      if (next && next !== ch) {
        q.chapter = next
        changed++
      }
    }
  }
  return changed
}

async function fetchAllExams(supabase) {
  const PAGE = 1000
  let from = 0
  const all = []
  while (true) {
    const { data, error } = await supabase
      .from('exams')
      .select('id, name, questions')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`fetch exams failed: ${error.message}`)
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const scopeLabel = SCOPE.chaptersOnly ? 'chapters only'
    : SCOPE.subtopicsOnly ? 'subtopics only' : 'chapters + subtopics'
  console.log(`Scope: ${scopeLabel}`)
  console.log('Fetching exams from Supabase…')
  const exams = await fetchAllExams(supabase)
  console.log(`  ${exams.length} exams fetched`)

  const toUpdate = []
  let totalChanged = 0

  for (const exam of exams) {
    const questions = JSON.parse(JSON.stringify(exam.questions ?? []))
    const changed = applyRenames(questions, SCOPE)
    if (changed > 0) {
      totalChanged += changed
      toUpdate.push({ id: exam.id, name: exam.name, questions, changed })
    }
  }

  console.log(`\n${totalChanged} question(s) across ${toUpdate.length} exam(s) need updating:`)
  for (const e of toUpdate) {
    console.log(`  [${e.changed}] ${e.name}`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No changes written.')
    return
  }

  if (toUpdate.length === 0) {
    console.log('Nothing to update — Supabase already in sync.')
    return
  }

  console.log('\nWriting updates…')
  for (const e of toUpdate) {
    const { error } = await supabase
      .from('exams')
      .update({ questions: e.questions, updated_at: new Date().toISOString() })
      .eq('id', e.id)
    if (error) throw new Error(`update failed for ${e.name}: ${error.message}`)
    process.stdout.write(`  ✓ ${e.name}\n`)
  }

  console.log(`\nDone. ${totalChanged} subtopic(s) renamed across ${toUpdate.length} exam(s).`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
