"""Tests for merge_subtopics.py — subtopic rename logic.

Run: pytest tests/test_subtopic_merge.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from merge_subtopics import (
    SUBTOPIC_RENAMES,
    CHAPTER_RENAMES,
    apply_renames,
    apply_chapter_renames,
)


# ── Helpers ────────────────────────────────────────────────────────────────

def make_exam(questions):
    return {"id": "e1", "name": "Test Exam", "questions": questions}

def make_q(subtopic, chapter="Any Chapter", subject="Maths"):
    return {"q": 1, "chapter": chapter, "subject": subject, "subtopic": subtopic}


# ── Guard cases ────────────────────────────────────────────────────────────

def test_empty_exams_list():
    assert apply_renames([], SUBTOPIC_RENAMES) == 0

def test_exam_with_no_questions():
    assert apply_renames([{"id": "e1", "questions": []}], SUBTOPIC_RENAMES) == 0

def test_question_without_subtopic_key():
    exams = [make_exam([{"q": 1, "chapter": "X"}])]
    assert apply_renames(exams, SUBTOPIC_RENAMES) == 0

def test_question_with_none_subtopic():
    exams = [make_exam([make_q(None)])]
    assert apply_renames(exams, SUBTOPIC_RENAMES) == 0

def test_question_with_empty_subtopic():
    exams = [make_exam([make_q("")])]
    assert apply_renames(exams, SUBTOPIC_RENAMES) == 0

def test_unmatched_subtopic_is_unchanged():
    q = make_q("Something Completely Different")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Something Completely Different"

def test_return_value_counts_changed_questions():
    exams = [make_exam([
        make_q("Kinetic Energy and Temperature"),
        make_q("Kinetic Energy in States"),
        make_q("Something Else"),           # no rename
    ])]
    assert apply_renames(exams, SUBTOPIC_RENAMES) == 2

def test_canonical_name_is_not_double_renamed():
    """Applying renames twice must be idempotent."""
    q = make_q("Kinetic Energy and Temperature")
    exams = [make_exam([q])]
    apply_renames(exams, SUBTOPIC_RENAMES)
    apply_renames(exams, SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Kinetic Energy and States of Matter"

def test_multiple_exams_are_both_processed():
    q1 = make_q("Kinetic Energy and Temperature")
    q2 = make_q("Multiplication and Division of Complex Numbers")
    changed = apply_renames(
        [make_exam([q1]), make_exam([q2])],
        SUBTOPIC_RENAMES,
    )
    assert changed == 2
    assert q1["subtopic"] == "Kinetic Energy and States of Matter"
    assert q2["subtopic"] == "Multiplication of Complex Numbers"


# ── Chemistry / Matter in Our Surrounding ──────────────────────────────────

@pytest.mark.parametrize("old", [
    "Kinetic Energy and States",
    "Kinetic Energy and Temperature",
    "Kinetic Energy in States",
])
def test_kinetic_energy_variants(old):
    q = make_q(old, chapter="Matter in Our Surrounding", subject="Chemistry")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Kinetic Energy and States of Matter"

@pytest.mark.parametrize("old", [
    "Properties of Matter",
    "Properties of Gases",
    "Properties of States",
])
def test_properties_variants(old):
    q = make_q(old, chapter="Matter in Our Surrounding", subject="Chemistry")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Properties of States of Matter"


# ── Chemistry / Solutions ──────────────────────────────────────────────────

@pytest.mark.parametrize("old", [
    "Raoult's Law - Vapour Pressure of Pure Component",
    "Raoult's Law - Vapour Pressure of Pure Liquid",
])
def test_raoults_law_variants(old):
    q = make_q(old, chapter="Solutions", subject="Chemistry")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Raoult's Law — Vapour Pressure"


# ── Maths / Complex Numbers ────────────────────────────────────────────────

def test_multiplication_and_division_complex():
    q = make_q("Multiplication and Division of Complex Numbers", chapter="Complex Numbers")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Multiplication of Complex Numbers"


# ── Maths / Differentiation ────────────────────────────────────────────────

def test_implicit_diff_exp_log():
    q = make_q("Implicit Differentiation of Exponential-Logarithmic Equations",
               chapter="Differentiation")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Differentiation of Exponential and Logarithmic Functions"

@pytest.mark.parametrize("old", [
    "Differentiation of Inverse Trig — Simplification",
    "Differentiation of Inverse Trig — Rational Forms",
    "Differentiation of Inverse Trig — Sum of Terms",
    "Differentiation of Inverse Trig — Half-Angle Forms",
    "Differentiation of Inverse Trig — Composite",
])
def test_inverse_trig_diff_variants(old):
    q = make_q(old, chapter="Differentiation")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Differentiation of Inverse Trig Functions"

@pytest.mark.parametrize("old", [
    "Standard Inverse Trig Derivatives",
    "Standard Log-Trig Derivatives",
])
def test_standard_derivatives_variants(old):
    q = make_q(old, chapter="Differentiation")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Standard Derivatives"


# ── Maths / Functions ──────────────────────────────────────────────────────

@pytest.mark.parametrize("old", [
    "Algebra of Functions — Domain",
    "Algebra of Functions — Addition",
    "Algebra of Functions — Division",
])
def test_algebra_of_functions_variants(old):
    q = make_q(old, chapter="Functions")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Algebra of Functions"

def test_decomposition_of_functions():
    q = make_q("Decomposition of Functions", chapter="Functions")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Composition of Functions"


# ── Maths / Quadratic Equations ────────────────────────────────────────────

@pytest.mark.parametrize("old", [
    "BODMAS – Area Calculation",
    "BODMAS – Volume Calculation",
])
def test_bodmas_application_variants(old):
    q = make_q(old, chapter="Quadratic Equations")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "BODMAS — Applications"

def test_discriminant_check_variant():
    q = make_q("Quadratic – Nature of Roots (Discriminant Check)", chapter="Quadratic Equations")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Quadratic – Nature of Roots (Discriminant)"

def test_complex_roots_given_variant():
    q = make_q("Complex Roots – Form Equation from Given Roots", chapter="Quadratic Equations")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Complex Roots – Form Equation from Roots"


# ── Maths / Sets & Relations ───────────────────────────────────────────────

def test_equivalence_relation_nxn():
    q = make_q("Equivalence Relation on N×N", chapter="Sets & Relations")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Equivalence Relation"


# ── Maths / Trigonometric Identities ──────────────────────────────────────

@pytest.mark.parametrize("old", [
    "Cosecant and Cotangent Identities",
    "Secant and Tangent Identities",
])
def test_trig_identity_variants(old):
    q = make_q(old, chapter="Trigonometric Identities")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Reciprocal and Quotient Identities"


# ── Maths subject-wide cleanup (2026-06-16) ────────────────────────────────

@pytest.mark.parametrize("old,new", [
    # Circles
    ("Radius of circle",                       "Radius of Circle"),
    ("Tangent to a Circle",                    "Tangents to a Circle"),
    # Complex Numbers
    ("Argument of Complex Number",             "Argument of a Complex Number"),
    # Differentiation
    ("Derivative of Absolute Value Functions", "Derivatives of Absolute Value Functions"),
    ("Increasing/Decreasing Functions",        "Increasing and Decreasing Functions"),
    ("Inverse Trigonometric Derivatives",      "Inverse Trigonometric Differentiation"),
    # Lines
    ("Diagonal of parallelogram",              "Diagonal of Parallelogram"),
    ("Area of square — parallel side lines",   "Area of Square from Parallel Sides"),
    ("Area of square from parallel sides",     "Area of Square from Parallel Sides"),
    ("Collinearity condition",                 "Collinearity Condition"),
    ("Collinearity of points",                 "Collinearity of Points"),
    ("Distance between parallel lines",        "Distance Between Parallel Lines"),
    ("Perpendicular line through point",       "Perpendicular Line Through a Point"),
    # Matrices & Determinants
    ("Adjoint of 2×2 matrix",                  "Adjoint of a Matrix"),
    ("Determinant with cube roots of unity",   "Determinant with Cube Roots of Unity"),
    ("Inverse of Matrix",                      "Inverse of a Matrix"),
    ("Sum of two determinants",                "Sum of Determinants"),
    ("Trigonometric determinant",              "Trigonometric Determinants"),
    # Probability
    ("Conditional probability",                "Conditional Probability"),
    # Quadratic Equations
    ("Common Root of Two Equations",           "Common Roots of Two Quadratics"),
    ("Common roots of two quadratics",         "Common Roots of Two Quadratics"),
    ("Complex Roots of Quadratic",             "Complex Roots of Quadratic Equations"),
    ("Complex roots of quadratic equations",   "Complex Roots of Quadratic Equations"),
    ("Ratio of roots",                         "Ratio of Roots"),
    # Sequence & Series
    ("Sum of infinite GP",                     "Sum of Infinite GP"),
    # Trigonometric Identities
    ("Double Angle Formula",                   "Double Angle Formulas"),
])
def test_maths_cleanup_subtopic_variants(old, new):
    q = make_q(old)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == new

@pytest.mark.parametrize("kept", [
    "Derivative of Nested Absolute Value Functions",
    "Area of square from diagonal vertices",
    "Sum of determinants — telescoping",
    "Perpendicular line through trig-point",
])
def test_maths_cleanup_distinct_subtopics_preserved(kept):
    """Near-name distinct concepts must NOT be merged away."""
    q = make_q(kept)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == kept


# ── Maths cleanup (2026-07-14) ─────────────────────────────────────────────

@pytest.mark.parametrize("old,new", [
    # Vectors
    ("Position Vectors and Section",             "Position Vectors and Section Formula"),
    # Applications of Integration
    ("Area Bounded by a Curve, Lines, and Axes", "Area Bounded by Curves, Lines, and Axes"),
    ("Area Bounded by Curves, Axes, and Lines",  "Area Bounded by Curves, Lines, and Axes"),
    # Lines
    ("Acute angle between two specific lines",   "Acute angle between two lines"),
    # Complex Numbers — cube-roots-of-unity same-concept fold
    ("Cube roots of unity — powers",             "Cube Roots of Unity"),
    ("Cube roots of unity — product",            "Cube Roots of Unity"),
    ("Cube roots — multiple of 3 exponent",      "Cube Roots of Unity"),
    ("High powers via cube roots periodicity",   "Cube Roots of Unity"),
    ("Sum of powers of cube roots",              "Cube Roots of Unity"),
    ("Sum of products of cube roots",            "Cube Roots of Unity"),
])
def test_maths_cleanup_2026_07_14(old, new):
    q = make_q(old)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == new

@pytest.mark.parametrize("kept", [
    "Modulus of expression with cube roots",
    "Geometric interpretation of cube roots of unity",
    "Root of determinant equation with cube roots",
])
def test_maths_cleanup_2026_07_14_distinct_preserved(kept):
    """Distinct cube-root concepts must NOT be folded into Cube Roots of Unity."""
    q = make_q(kept)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == kept


# ── Chapter renames ────────────────────────────────────────────────────────

def test_chapter_rename_height_and_distance():
    q = {"q": 1, "chapter": "Height & Distance", "subject": "Maths"}
    changed = apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert changed == 1
    assert q["chapter"] == "Heights and Distances"

def test_chapter_rename_canonical_unchanged():
    q = {"q": 1, "chapter": "Heights and Distances", "subject": "Maths"}
    changed = apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert changed == 0
    assert q["chapter"] == "Heights and Distances"

def test_chapter_rename_unmatched_unchanged():
    q = {"q": 1, "chapter": "Differentiation", "subject": "Maths"}
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert q["chapter"] == "Differentiation"

def test_chapter_rename_is_idempotent():
    q = {"q": 1, "chapter": "Height & Distance", "subject": "Maths"}
    exams = [make_exam([q])]
    apply_chapter_renames(exams, CHAPTER_RENAMES)
    apply_chapter_renames(exams, CHAPTER_RENAMES)
    assert q["chapter"] == "Heights and Distances"

def test_chapter_rename_empty_and_missing():
    assert apply_chapter_renames([], CHAPTER_RENAMES) == 0
    assert apply_chapter_renames([make_exam([{"q": 1}])], CHAPTER_RENAMES) == 0


# ── Rename map completeness ────────────────────────────────────────────────

def test_rename_map_has_no_self_references():
    """No old name maps to itself (that would be a no-op entry)."""
    for old, new in SUBTOPIC_RENAMES.items():
        assert old != new, f"Self-reference in rename map: {old!r}"

def test_rename_map_canonical_names_not_in_keys():
    """No canonical target is also an old key (would cause double-rename risk)."""
    canonicals = set(SUBTOPIC_RENAMES.values())
    for old in SUBTOPIC_RENAMES:
        assert old not in canonicals, \
            f"{old!r} is both a source and a target — rename chain detected"

def test_chapter_rename_map_has_no_self_references():
    for old, new in CHAPTER_RENAMES.items():
        assert old != new, f"Self-reference in chapter rename map: {old!r}"

def test_chapter_rename_map_canonical_names_not_in_keys():
    canonicals = set(CHAPTER_RENAMES.values())
    for old in CHAPTER_RENAMES:
        assert old not in canonicals, \
            f"{old!r} is both a source and a target — chapter rename chain detected"
