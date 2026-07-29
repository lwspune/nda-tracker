"""Merge near-duplicate subtopic names in data/faculty-data.json.

Usage:
  python -X utf8 merge_subtopics.py [--dry-run]

--dry-run  Print what would change without writing the file.

After running, sync to Supabase:
  node migrate_subtopics_supabase.js
  (requires SUPABASE_SERVICE_ROLE_KEY in environment)
"""

import json
import sys

DATA_FILE = 'data/faculty-data.json'

# ── Rename map ─────────────────────────────────────────────────────────────
# Keys   = old subtopic strings found in exam questions
# Values = canonical replacement strings
# Invariant: no canonical appears as a key (no rename chains).

SUBTOPIC_RENAMES = {
    # Chemistry / Matter in Our Surrounding — kinetic energy variants
    'Kinetic Energy and States':                                 'Kinetic Energy and States of Matter',
    'Kinetic Energy and Temperature':                            'Kinetic Energy and States of Matter',
    'Kinetic Energy in States':                                  'Kinetic Energy and States of Matter',

    # Chemistry / Matter in Our Surrounding — properties variants
    'Properties of Matter':                                      'Properties of States of Matter',
    'Properties of Gases':                                       'Properties of States of Matter',
    'Properties of States':                                      'Properties of States of Matter',

    # Chemistry / Solutions — Raoult's Law wording variants
    "Raoult's Law - Vapour Pressure of Pure Component":          "Raoult's Law — Vapour Pressure",
    "Raoult's Law - Vapour Pressure of Pure Liquid":             "Raoult's Law — Vapour Pressure",

    # Maths / Complex Numbers — combined operation label
    'Multiplication and Division of Complex Numbers':            'Multiplication of Complex Numbers',

    # Maths / Differentiation — implicit exp-log
    'Implicit Differentiation of Exponential-Logarithmic Equations':
        'Differentiation of Exponential and Logarithmic Functions',

    # Maths / Differentiation — inverse trig sub-technique variants (Groups 3+4)
    'Differentiation of Inverse Trig — Simplification':    'Differentiation of Inverse Trig Functions',
    'Differentiation of Inverse Trig — Rational Forms':    'Differentiation of Inverse Trig Functions',
    'Differentiation of Inverse Trig — Sum of Terms':      'Differentiation of Inverse Trig Functions',
    'Differentiation of Inverse Trig — Half-Angle Forms':  'Differentiation of Inverse Trig Functions',
    'Differentiation of Inverse Trig — Composite':         'Differentiation of Inverse Trig Functions',

    # Maths / Differentiation — standard derivative singleton variants
    'Standard Inverse Trig Derivatives':                         'Standard Derivatives',
    'Standard Log-Trig Derivatives':                             'Standard Derivatives',

    # Maths / Functions — algebra of functions sub-topic variants
    'Algebra of Functions — Domain':                       'Algebra of Functions',
    'Algebra of Functions — Addition':                     'Algebra of Functions',
    'Algebra of Functions — Division':                     'Algebra of Functions',

    # Maths / Functions — decomposition is inverse of composition
    'Decomposition of Functions':                                'Composition of Functions',

    # Maths / Quadratic Equations — BODMAS application label
    'BODMAS – Area Calculation':                            'BODMAS — Applications',
    'BODMAS – Volume Calculation':                          'BODMAS — Applications',

    # Maths / Quadratic Equations — discriminant wording
    'Quadratic – Nature of Roots (Discriminant Check)':    'Quadratic – Nature of Roots (Discriminant)',

    # Maths / Quadratic Equations — complex roots wording
    'Complex Roots – Form Equation from Given Roots':      'Complex Roots – Form Equation from Roots',

    # Maths / Sets & Relations — specific set qualifier
    'Equivalence Relation on N×N':                         'Equivalence Relation',

    # Maths / Trigonometric Identities — reciprocal/quotient identity pairs
    'Cosecant and Cotangent Identities':                         'Reciprocal and Quotient Identities',
    'Secant and Tangent Identities':                             'Reciprocal and Quotient Identities',

    # ── Maths subject-wide cleanup (2026-06-16) ───────────────────────────
    # Circles
    'Radius of circle':                        'Radius of Circle',
    'Tangent to a Circle':                     'Tangents to a Circle',
    # Complex Numbers
    'Argument of Complex Number':              'Argument of a Complex Number',
    # Differentiation
    'Derivative of Absolute Value Functions':  'Derivatives of Absolute Value Functions',
    'Increasing/Decreasing Functions':         'Increasing and Decreasing Functions',
    'Inverse Trigonometric Derivatives':       'Inverse Trigonometric Differentiation',
    # Lines
    'Diagonal of parallelogram':               'Diagonal of Parallelogram',
    'Area of square — parallel side lines':    'Area of Square from Parallel Sides',
    'Area of square from parallel sides':      'Area of Square from Parallel Sides',
    'Collinearity condition':                  'Collinearity Condition',
    'Collinearity of points':                  'Collinearity of Points',
    'Distance between parallel lines':         'Distance Between Parallel Lines',
    'Perpendicular line through point':        'Perpendicular Line Through a Point',
    # Matrices & Determinants
    'Adjoint of 2×2 matrix':                   'Adjoint of a Matrix',
    'Determinant with cube roots of unity':    'Determinant with Cube Roots of Unity',
    'Inverse of Matrix':                       'Inverse of a Matrix',
    'Sum of two determinants':                 'Sum of Determinants',
    'Trigonometric determinant':               'Trigonometric Determinants',
    # Probability
    'Conditional probability':                 'Conditional Probability',
    # Quadratic Equations
    'Common Root of Two Equations':            'Common Roots of Two Quadratics',
    'Common roots of two quadratics':          'Common Roots of Two Quadratics',
    'Complex Roots of Quadratic':              'Complex Roots of Quadratic Equations',
    'Complex roots of quadratic equations':    'Complex Roots of Quadratic Equations',
    'Ratio of roots':                          'Ratio of Roots',
    # Sequence & Series
    'Sum of infinite GP':                      'Sum of Infinite GP',
    # Trigonometric Identities
    'Double Angle Formula':                    'Double Angle Formulas',

    # ── Maths cleanup (2026-07-14) ────────────────────────────────────────
    # Vectors
    'Position Vectors and Section':            'Position Vectors and Section Formula',
    # Applications of Integration
    'Area Bounded by a Curve, Lines, and Axes': 'Area Bounded by Curves, Lines, and Axes',
    'Area Bounded by Curves, Axes, and Lines':  'Area Bounded by Curves, Lines, and Axes',
    # Lines
    'Acute angle between two specific lines':   'Acute angle between two lines',
    # Complex Numbers — cube-roots-of-unity same-concept fold
    'Cube roots of unity — powers':            'Cube Roots of Unity',
    'Cube roots of unity — product':           'Cube Roots of Unity',
    'Cube roots — multiple of 3 exponent':     'Cube Roots of Unity',
    'High powers via cube roots periodicity':  'Cube Roots of Unity',
    'Sum of powers of cube roots':             'Cube Roots of Unity',
    'Sum of products of cube roots':           'Cube Roots of Unity',

    # ── Cleanup Tier 1 (2026-07-29) ───────────────────────────────────────
    # Mechanical only: casing, `&`-vs-`and`, plural/suffix, exact synonym.
    # Concept merges (Tier 2) and judgment calls (Tier 3) are NOT here.
    # English
    'Sentence Rearrangement':                  'Sentence Rearrangement (PQRS)',
    'Factual Detail Recall':                   'Factual Detail Retrieval',
    'Mixed Error Detection':                   'Error Detection',
    'Yes/No Question Reporting':               'Question Reporting',
    'Determiners & Pronouns':                  'Determiners and Pronouns',
    'Articles and Determiners':                'Grammar - Articles and Determiners',
    'Change & Transition Idioms':              'Change & Transformation Idioms',
    # Maths
    'Binary to decimal conversion':            'Binary to Decimal Conversion',
    'Roots of Unity':                          'Cube Roots of Unity',
    'Logarithmic Differentiation of Products': 'Logarithmic Differentiation',
    'Properties of Determinants with AP':      'Properties of Determinants',
    'Arrangements with restricted repetitions': 'Arrangements with Restrictions',
    'Conditional probability with dice':       'Conditional Probability',
    'Sum of GP':                               'Sum of Geometric Progression',
    'nth term of GP':                          'Geometric Progression - nth Term',
    'Arithmetic mean of AP':                   'Arithmetic Mean',
    'Period of trigonometric functions':       'Periodicity of Trigonometric Functions',
    # Chemistry
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
    # Physics
    'Electrostatic Potential':                 'Electric Potential',
    'Distance and Displacement':               'Distance vs Displacement',
    'Torque from Change in Angular Momentum – Ring':
        'Torque from Change in Angular Momentum',
    # Geography
    'Seismic Waves & Earth Structure':         "Seismic Waves & Earth's Interior",
    "Seismic Waves & Earth's Core":            "Seismic Waves & Earth's Interior",

    # ── Cleanup Tier 2 (2026-07-29) ───────────────────────────────────────
    # !! PREPARED, NOT YET APPLIED TO PROD as of 2026-07-29. See SUGGESTIONS.md.
    # An unapplied entry sitting in this map is what caused the Height & Distance
    # bug — the 2026-06-16 batch looked done and wasn't. Apply or delete; don't
    # leave it here indefinitely. Run with --subtopics-only to apply just these.
    # Concept merges: buckets split by prop / scenario / keyword rather than
    # by concept. Same-chapter only — a subtopic appearing in two chapters
    # with two different correct targets is NOT here (see the Tier 2 test).
    # English / Grammar — Question Tags tense + polarity families.
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
    # English / Phrasal Verbs
    "Phrasal Verbs with 'Call'":               'Phrasal Verbs',
    "Phrasal Verbs with 'Carry'":              'Phrasal Verbs',
    "Phrasal Verbs with 'Come'":               'Phrasal Verbs',
    "Phrasal Verbs with 'Keep'":               'Phrasal Verbs',
    "Phrasal Verbs with 'Put'":                'Phrasal Verbs',
    "Phrasal Verbs with 'Run'":                'Phrasal Verbs',
    # Maths / Probability
    'Classical Probability — Cards':           'Classical Probability',
    'Classical Probability — Coins':           'Classical Probability',
    'Classical Probability — Dice':            'Classical Probability',
    'Classical probability with repeated letters': 'Classical Probability',
    # Physics / Rotational Dynamics
    'Conservation of Angular Momentum – Collision on Disc':
        'Conservation of Angular Momentum',
    'Conservation of Angular Momentum – Condition':   'Conservation of Angular Momentum',
    'Conservation of Angular Momentum – Earth':       'Conservation of Angular Momentum',
    'Conservation of Angular Momentum – Gymnast':     'Conservation of Angular Momentum',
    'Conservation of Angular Momentum – Human Body':  'Conservation of Angular Momentum',
    # Physics / Optics
    'Total Internal Reflection – Colour Filtering':   'Total Internal Reflection',
    'Total Internal Reflection – Conditions':         'Total Internal Reflection',
    'Total Internal Reflection – Critical Angle':     'Total Internal Reflection',
    'Total Internal Reflection – Critical Angle from Wavelength':
        'Total Internal Reflection',
    'Total Internal Reflection – Prism Ray Path':     'Total Internal Reflection',
    'Total Internal Reflection – Speed Relation':     'Total Internal Reflection',
    # Chemistry / Inorganic Chemistry
    'Common Chemicals — Baking Soda':          'Common Chemicals',
    'Common Chemicals — Bleaching Powder':     'Common Chemicals',
    'Common Chemicals — Limestone':            'Common Chemicals',
    'Common Chemicals — Soda Lime':            'Common Chemicals',
    # Chemistry / Mole Concept
    "Avogadro's Number and Atoms":             "Avogadro's Number",
    "Avogadro's Number and Molecules":         "Avogadro's Number",
    "Avogadro's Number and Neutrons":          "Avogadro's Number",
    # Geography / Atmosphere — the `<X> Cloud Characteristics` family only.
    'Cirrus Cloud Characteristics':            'Cloud Types and Characteristics',
    'Cumulonimbus Cloud Characteristics':      'Cloud Types and Characteristics',
    'Cumulus Cloud Characteristics':           'Cloud Types and Characteristics',
    'Nimbostratus Cloud Characteristics':      'Cloud Types and Characteristics',
    'Nimbus Cloud Characteristics':            'Cloud Types and Characteristics',
    'Stratus Cloud Characteristics':           'Cloud Types and Characteristics',
    'Cloud Types':                             'Cloud Types and Characteristics',
}


# ── Chapter rename map ─────────────────────────────────────────────────────
# Same invariant: no canonical appears as a key.

CHAPTER_RENAMES = {
    # Maths — two spellings of the same chapter. Direction REVERSED 2026-07-29:
    # `Height & Distance` is the canonical name in NDA_FREQ_BY_SUBJECT, and
    # computeProjectedScore joins question chapters to that table by exact
    # string match — a miss scores 0. The original 2026-06-16 entry pointed at
    # `Heights and Distances`, which is off the table; it was never run until
    # the Tier 1 sweep, which then moved 2 questions out of scoring range.
    'Heights and Distances':                   'Height & Distance',
}


# ── Core logic (importable by tests) ──────────────────────────────────────

def apply_renames(exams: list, rename_map: dict) -> int:
    """Rename subtopics in-place. Returns count of questions changed."""
    changed = 0
    for exam in exams:
        for q in exam.get('questions', []):
            st = q.get('subtopic') or ''
            if st and st in rename_map:
                q['subtopic'] = rename_map[st]
                changed += 1
    return changed


def apply_chapter_renames(exams: list, rename_map: dict) -> int:
    """Rename chapters in-place. Returns count of questions changed."""
    changed = 0
    for exam in exams:
        for q in exam.get('questions', []):
            ch = q.get('chapter') or ''
            if ch and ch in rename_map:
                q['chapter'] = rename_map[ch]
                changed += 1
    return changed


# ── CLI ───────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv

    with open(DATA_FILE, encoding='utf-8') as f:
        data = json.load(f)

    exams = data.get('exams', [])
    print(f'Loaded {len(exams)} exams from {DATA_FILE}')

    if dry_run:
        import copy
        exams_copy = copy.deepcopy(exams)
        changed = apply_renames(exams_copy, SUBTOPIC_RENAMES)
        ch_changed = apply_chapter_renames(exams_copy, CHAPTER_RENAMES)
        print(f'[dry-run] Would rename {changed} question subtopic(s) '
              f'and {ch_changed} question chapter(s). No file written.')
        return

    changed = apply_renames(exams, SUBTOPIC_RENAMES)
    ch_changed = apply_chapter_renames(exams, CHAPTER_RENAMES)

    if changed == 0 and ch_changed == 0:
        print('No subtopics or chapters matched the rename maps — file unchanged.')
        return

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f'Renamed {changed} question subtopic(s) and {ch_changed} question chapter(s). '
          f'Written to {DATA_FILE}.')
    print('Next: node migrate_subtopics_supabase.js  (needs SUPABASE_SERVICE_ROLE_KEY)')


if __name__ == '__main__':
    main()
