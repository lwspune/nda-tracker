// Apply subtopic renames to the Supabase exams.questions JSONB column.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_subtopics_supabase.js [--dry-run]
//
// --dry-run  Fetch + analyse but write nothing.
//
// Run AFTER merge_subtopics.py has updated data/faculty-data.json (local).
// This script targets Supabase directly so prod data stays in sync.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')

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
      'Differentiation of Exponential and Logarithmic Functions',
  'Differentiation of Inverse Trig — Simplification':   'Differentiation of Inverse Trig Functions',
  'Differentiation of Inverse Trig — Rational Forms':   'Differentiation of Inverse Trig Functions',
  'Differentiation of Inverse Trig — Sum of Terms':     'Differentiation of Inverse Trig Functions',
  'Differentiation of Inverse Trig — Half-Angle Forms': 'Differentiation of Inverse Trig Functions',
  'Differentiation of Inverse Trig — Composite':        'Differentiation of Inverse Trig Functions',
  'Standard Inverse Trig Derivatives':                  'Standard Derivatives',
  'Standard Log-Trig Derivatives':                      'Standard Derivatives',

  // Maths / Functions
  'Algebra of Functions — Domain':    'Algebra of Functions',
  'Algebra of Functions — Addition':  'Algebra of Functions',
  'Algebra of Functions — Division':  'Algebra of Functions',
  'Decomposition of Functions':       'Composition of Functions',

  // Maths / Quadratic Equations
  'BODMAS – Area Calculation':                           'BODMAS — Applications',
  'BODMAS – Volume Calculation':                         'BODMAS — Applications',
  'Quadratic – Nature of Roots (Discriminant Check)':   'Quadratic – Nature of Roots (Discriminant)',
  'Complex Roots – Form Equation from Given Roots':     'Complex Roots – Form Equation from Roots',

  // Maths / Sets & Relations
  'Equivalence Relation on N×N':  'Equivalence Relation',

  // Maths / Trigonometric Identities
  'Cosecant and Cotangent Identities': 'Reciprocal and Quotient Identities',
  'Secant and Tangent Identities':     'Reciprocal and Quotient Identities',

  // ── Maths subject-wide cleanup (2026-06-16) ────────────────────────────
  // Circles
  'Radius of circle':                       'Radius of Circle',
  'Tangent to a Circle':                    'Tangents to a Circle',
  // Complex Numbers
  'Argument of Complex Number':             'Argument of a Complex Number',
  // Differentiation
  'Derivative of Absolute Value Functions': 'Derivatives of Absolute Value Functions',
  'Increasing/Decreasing Functions':        'Increasing and Decreasing Functions',
  'Inverse Trigonometric Derivatives':      'Inverse Trigonometric Differentiation',
  // Lines
  'Diagonal of parallelogram':              'Diagonal of Parallelogram',
  'Area of square — parallel side lines':   'Area of Square from Parallel Sides',
  'Area of square from parallel sides':     'Area of Square from Parallel Sides',
  'Collinearity condition':                 'Collinearity Condition',
  'Collinearity of points':                 'Collinearity of Points',
  'Distance between parallel lines':        'Distance Between Parallel Lines',
  'Perpendicular line through point':       'Perpendicular Line Through a Point',
  // Matrices & Determinants
  'Adjoint of 2×2 matrix':                  'Adjoint of a Matrix',
  'Determinant with cube roots of unity':   'Determinant with Cube Roots of Unity',
  'Inverse of Matrix':                      'Inverse of a Matrix',
  'Sum of two determinants':                'Sum of Determinants',
  'Trigonometric determinant':              'Trigonometric Determinants',
  // Probability
  'Conditional probability':                'Conditional Probability',
  // Quadratic Equations
  'Common Root of Two Equations':           'Common Roots of Two Quadratics',
  'Common roots of two quadratics':         'Common Roots of Two Quadratics',
  'Complex Roots of Quadratic':             'Complex Roots of Quadratic Equations',
  'Complex roots of quadratic equations':   'Complex Roots of Quadratic Equations',
  'Ratio of roots':                         'Ratio of Roots',
  // Sequence & Series
  'Sum of infinite GP':                     'Sum of Infinite GP',
  // Trigonometric Identities
  'Double Angle Formula':                   'Double Angle Formulas',

  // ── Maths cleanup (2026-07-14) ─────────────────────────────────────────
  // Vectors
  'Position Vectors and Section':           'Position Vectors and Section Formula',
  // Applications of Integration
  'Area Bounded by a Curve, Lines, and Axes': 'Area Bounded by Curves, Lines, and Axes',
  'Area Bounded by Curves, Axes, and Lines':  'Area Bounded by Curves, Lines, and Axes',
  // Lines
  'Acute angle between two specific lines':  'Acute angle between two lines',
  // Complex Numbers — cube-roots-of-unity same-concept fold
  'Cube roots of unity — powers':           'Cube Roots of Unity',
  'Cube roots of unity — product':          'Cube Roots of Unity',
  'Cube roots — multiple of 3 exponent':    'Cube Roots of Unity',
  'High powers via cube roots periodicity': 'Cube Roots of Unity',
  'Sum of powers of cube roots':            'Cube Roots of Unity',
  'Sum of products of cube roots':          'Cube Roots of Unity',
}

// ── Chapter rename map (must stay in sync with merge_subtopics.py) ──────────
const CHAPTER_RENAMES = {
  // Maths — two spellings of the same chapter (2026-06-16)
  'Height & Distance': 'Heights and Distances',
}

function applyRenames(questions) {
  let changed = 0
  for (const q of questions) {
    const st = q.subtopic
    if (st && SUBTOPIC_RENAMES[st]) {
      q.subtopic = SUBTOPIC_RENAMES[st]
      changed++
    }
    const ch = q.chapter
    if (ch && CHAPTER_RENAMES[ch]) {
      q.chapter = CHAPTER_RENAMES[ch]
      changed++
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

  console.log('Fetching exams from Supabase…')
  const exams = await fetchAllExams(supabase)
  console.log(`  ${exams.length} exams fetched`)

  const toUpdate = []
  let totalChanged = 0

  for (const exam of exams) {
    const questions = JSON.parse(JSON.stringify(exam.questions ?? []))
    const changed = applyRenames(questions)
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
