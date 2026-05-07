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
        print(f'[dry-run] Would rename {changed} question subtopic(s). No file written.')
        return

    changed = apply_renames(exams, SUBTOPIC_RENAMES)

    if changed == 0:
        print('No subtopics matched the rename map — file unchanged.')
        return

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f'Renamed {changed} question subtopic(s). Written to {DATA_FILE}.')
    print('Next: node migrate_subtopics_supabase.js  (needs SUPABASE_SERVICE_ROLE_KEY)')


if __name__ == '__main__':
    main()
