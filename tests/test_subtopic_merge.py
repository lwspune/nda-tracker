"""Tests for merge_subtopics.py — subtopic rename logic.

Run: pytest tests/test_subtopic_merge.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from merge_subtopics import SUBTOPIC_RENAMES, apply_renames


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
