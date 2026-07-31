"""Tests for merge_subtopics.py — subtopic rename logic.

Run: pytest tests/test_subtopic_merge.py -v
"""

import sys
import os
import re
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from merge_subtopics import (
    SUBTOPIC_RENAMES,
    CHAPTER_RENAMES,
    CHAPTER_SUBTOPIC_RENAMES,
    apply_renames,
    apply_chapter_renames,
)

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
JS_SCRIPT = os.path.join(REPO_ROOT, 'migrate_subtopics_supabase.js')
NDA_FREQ_JS = os.path.join(REPO_ROOT, 'src', 'lib', 'ndaFreq.js')


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
    # Retargeted 2026-07-31 — see test_decomposition_of_functions.
    assert q["subtopic"] == "Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions"

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
    # Retargeted 2026-07-31 — see test_decomposition_of_functions.
    assert q["subtopic"] == "Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions"

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
    # Retargeted 2026-07-31: was `Composition of Functions`, itself off the PYQ
    # Vault taxonomy. apply_renames is single-pass, so it must reach canonical.
    q = make_q("Decomposition of Functions", chapter="Functions")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Composition and Inverse of Functions"


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
    # Retargeted 2026-07-31 — see test_decomposition_of_functions.
    q = make_q("Equivalence Relation on N×N", chapter="Sets & Relations")
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == "Relations — Properties, Cartesian Product, and Counting"


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
    ("Tangent to a Circle",                    "Inscribed Geometry, Tangents, and Segments"),
    # Complex Numbers
    ("Argument of Complex Number",             "Modulus, Argument, and Conjugate"),
    # Differentiation
    ("Derivative of Absolute Value Functions", "Differentiability of Absolute Value, Piecewise, and Greatest Integer Functions"),
    ("Increasing/Decreasing Functions",        "Monotonicity, Extrema, and Critical Points"),
    ("Inverse Trigonometric Derivatives",      "Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions"),
    # Lines
    ("Diagonal of parallelogram",              "Diagonal of Parallelogram"),
    ("Area of square — parallel side lines",   "Area of Square from Parallel Sides"),
    ("Area of square from parallel sides",     "Area of Square from Parallel Sides"),
    ("Collinearity condition",                 "Collinearity Condition"),
    ("Collinearity of points",                 "Collinearity of Points"),
    ("Distance between parallel lines",        "Distance, Section, and Locus"),
    ("Perpendicular line through point",       "Perpendicular Line Through a Point"),
    # Matrices & Determinants
    ("Adjoint of 2×2 matrix",                  "Cofactors, Adjoint, and Inverse"),
    ("Determinant with cube roots of unity",   "Determinant with Cube Roots of Unity"),
    ("Inverse of Matrix",                      "Cofactors, Adjoint, and Inverse"),
    ("Sum of two determinants",                "Sum of Determinants"),
    ("Trigonometric determinant",              "Trigonometric Determinants"),
    # Probability
    ("Conditional probability",                "Conditional Probability, Total Probability, and Bayes' Theorem"),
    # Quadratic Equations
    ("Common Root of Two Equations",           "Common Roots of Two Quadratics"),
    ("Common roots of two quadratics",         "Common Roots of Two Quadratics"),
    ("Complex Roots of Quadratic",             "Complex Roots of Quadratic Equations"),
    ("Complex roots of quadratic equations",   "Complex Roots of Quadratic Equations"),
    ("Ratio of roots",                         "Ratio of Roots"),
    # Sequence & Series
    ("Sum of infinite GP",                     "Sum of Infinite GP"),
    # Trigonometric Identities
    ("Double Angle Formula",                   "Multiple and Half-Angle Formulas"),
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
    # Applications of Integration
    ("Area Bounded by Curves, Axes, and Lines",  "Area Bounded by a Curve, Lines, and Axes"),
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


# ── Subtopic cleanup Tier 1 (2026-07-29) ──────────────────────────────────
# Mechanical merges only: casing, `&`-vs-`and`, plural/suffix, exact synonym.
# No concept boundary is crossed — see DECISIONS.md.

@pytest.mark.parametrize("old,new", [
    # English
    ("Sentence Rearrangement",                  "Sentence Rearrangement (PQRS)"),
    ("Factual Detail Recall",                   "Factual Detail Retrieval"),
    ("Mixed Error Detection",                   "Error Detection"),
    ("Yes/No Question Reporting",               "Question Reporting"),
    ("Determiners & Pronouns",                  "Determiners and Pronouns"),
    ("Articles and Determiners",                "Grammar - Articles and Determiners"),
    ("Change & Transition Idioms",              "Change & Transformation Idioms"),
    # Maths
    ("Binary to decimal conversion",            "Binary to Decimal Conversion"),
    ("Roots of Unity",                          "Cube Roots of Unity"),
    ("Logarithmic Differentiation of Products", "Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions"),
    ("Properties of Determinants with AP",      "Determinant Properties, Operations, and Sums"),
    ("Arrangements with restricted repetitions", "Arrangements with Restrictions"),
    ("Conditional probability with dice",       "Conditional Probability, Total Probability, and Bayes' Theorem"),
    ("Sum of GP",                               "Geometric Progressions"),
    ("nth term of GP",                          "Geometric Progressions"),
    ("Arithmetic mean of AP",                   "Arithmetic Mean"),
    ("Period of trigonometric functions",       "Periodicity of Trigonometric Functions"),
    # Chemistry
    ("Isotopes and average atomic mass",        "Isotopes and Average Atomic Mass"),
    ("Electronic configuration and shells",     "Electronic Configuration"),
    ("Rutherford's nuclear model",              "Rutherford's Nuclear Model"),
    ("Rutherford's nuclear model limitations",  "Rutherford's Nuclear Model"),
    ("Physical vs chemical changes",            "Physical vs Chemical Changes"),
    ("Physical vs chemical processes",          "Physical vs Chemical Changes"),
    ("Oxidation and reduction",                 "Oxidation and Reduction"),
    ("Oxidation and reduction concepts",        "Oxidation and Reduction"),
    ("Oxidation reactions",                     "Oxidation and Reduction"),
    ("Empirical Formula Mass",                  "Empirical Formula"),
    ("Formula Mass Calculation",                "Molar Mass Calculations"),
    ("Noble gases",                             "Noble Gases"),
    ("Separation of liquid mixtures",           "Separation of Mixtures"),
    ("Separation of mixtures",                  "Separation of Mixtures"),
    # Physics
    ("Electrostatic Potential",                 "Electric Potential"),
    ("Distance and Displacement",               "Distance vs Displacement"),
    ("Torque from Change in Angular Momentum – Ring",
     "Torque from Change in Angular Momentum"),
    # Geography
    ("Seismic Waves & Earth Structure",         "Seismic Waves & Earth's Interior"),
    ("Seismic Waves & Earth's Core",            "Seismic Waves & Earth's Interior"),
])
def test_cleanup_tier1_2026_07_29(old, new):
    q = make_q(old)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == new


@pytest.mark.parametrize("kept", [
    # Prior deliberate KEEP decisions — a similarity heuristic must not undo them.
    "Derivative of Nested Absolute Value Functions",
    "Perpendicular line through trig-point",
    # Distinct concepts the ≥0.82 heuristic flags as near-duplicates.
    "Molarity",
    "Molality",
    "Electric Potential Energy",
    "Inferential Comprehension",
    "Literal Comprehension",
    "Basic Concepts of Latitude",
    "Basic Concepts of Longitude",
    # Deferred: needs re-tagging, not renaming (32-Q catch-all bucket).
    "Geometric Progressions",
])
def test_cleanup_tier1_distinct_subtopics_preserved(kept):
    q = make_q(kept)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == kept


# ── Subtopic cleanup Tier 2 (2026-07-29) ──────────────────────────
# Concept merges: buckets split by prop/scenario/keyword rather than by
# concept. Each collapses 1–3 question buckets that cannot aggregate.
# Scoped to same-chapter merges only — see the chapter-scope gap below.

@pytest.mark.parametrize("old,new", [
    # English / Grammar — Question Tags over-granularity.
    # Only the tense/polarity families merge; distinct grammar rules
    # (Let's, Needn't, Ought To, Seldom, Indefinite Pronouns) stay split.
    ("Question Tags – Be Verb (Simple Present)",     "Question Tags – Simple Present"),
    ("Question Tags – Simple Present (3rd Person)",  "Question Tags – Simple Present"),
    ("Question Tags – Simple Present (Action Verb)", "Question Tags – Simple Present"),
    ("Question Tags – Simple Present (Does)",        "Question Tags – Simple Present"),
    ("Question Tags – Simple Present (Habitual)",    "Question Tags – Simple Present"),
    ("Question Tags – Simple Present (Likes/Habits)", "Question Tags – Simple Present"),
    ("Question Tags – Could/Past Simple",            "Question Tags – Past Simple"),
    ("Question Tags – Past Simple (Be Verb)",        "Question Tags – Past Simple"),
    ("Question Tags – Simple Past",                  "Question Tags – Past Simple"),
    ("Question Tags – Modal Must",                   "Question Tags – Modal Verbs"),
    ("Question Tags – Modal Should + Plural Subject", "Question Tags – Modal Verbs"),
    ("Question Tags – Can (Ability/Possibility)",    "Question Tags – Can"),
    ("Question Tags – Can (Affirmative)",            "Question Tags – Can"),
    ("Question Tags – Negative + Does",              "Question Tags – Negative Clause"),
    ("Question Tags – Negative + Won't",             "Question Tags – Negative Clause"),
    ("Question Tags – Negative Main Clause",         "Question Tags – Negative Clause"),
    # English / Phrasal Verbs — split by keyword gives no analytic signal.
    ("Phrasal Verbs with 'Call'",                    "Phrasal Verbs"),
    ("Phrasal Verbs with 'Carry'",                   "Phrasal Verbs"),
    ("Phrasal Verbs with 'Come'",                    "Phrasal Verbs"),
    ("Phrasal Verbs with 'Keep'",                    "Phrasal Verbs"),
    ("Phrasal Verbs with 'Put'",                     "Phrasal Verbs"),
    ("Phrasal Verbs with 'Run'",                     "Phrasal Verbs"),
    # Maths / Probability — split by prop, not by concept.
    ("Classical Probability — Cards",                "Probability via Counting"),
    ("Classical Probability — Coins",                "Probability via Counting"),
    ("Classical Probability — Dice",                 "Probability via Counting"),
    ("Classical probability with repeated letters",  "Probability via Counting"),
    # Physics / Rotational Dynamics — split by scenario.
    ("Conservation of Angular Momentum – Collision on Disc",
     "Conservation of Angular Momentum"),
    ("Conservation of Angular Momentum – Condition", "Conservation of Angular Momentum"),
    ("Conservation of Angular Momentum – Earth",     "Conservation of Angular Momentum"),
    ("Conservation of Angular Momentum – Gymnast",   "Conservation of Angular Momentum"),
    ("Conservation of Angular Momentum – Human Body", "Conservation of Angular Momentum"),
    # Physics / Optics — split by sub-question.
    ("Total Internal Reflection – Colour Filtering",  "Total Internal Reflection"),
    ("Total Internal Reflection – Conditions",        "Total Internal Reflection"),
    ("Total Internal Reflection – Critical Angle",    "Total Internal Reflection"),
    ("Total Internal Reflection – Critical Angle from Wavelength",
     "Total Internal Reflection"),
    ("Total Internal Reflection – Prism Ray Path",    "Total Internal Reflection"),
    ("Total Internal Reflection – Speed Relation",    "Total Internal Reflection"),
    # Chemistry / Inorganic Chemistry — one bucket per chemical.
    ("Common Chemicals — Baking Soda",               "Common Chemicals"),
    ("Common Chemicals — Bleaching Powder",          "Common Chemicals"),
    ("Common Chemicals — Limestone",                 "Common Chemicals"),
    ("Common Chemicals — Soda Lime",                 "Common Chemicals"),
    # Chemistry / Mole Concept — split by what is being counted.
    ("Avogadro's Number and Atoms",                  "Avogadro's Number"),
    ("Avogadro's Number and Molecules",              "Avogadro's Number"),
    ("Avogadro's Number and Neutrons",               "Avogadro's Number"),
    # Geography / Atmosphere — the `<X> Cloud Characteristics` family only.
    # Formation / altitude / weather-association buckets are NOT touched.
    ("Cirrus Cloud Characteristics",                 "Cloud Types and Characteristics"),
    ("Cumulonimbus Cloud Characteristics",           "Cloud Types and Characteristics"),
    ("Cumulus Cloud Characteristics",                "Cloud Types and Characteristics"),
    ("Nimbostratus Cloud Characteristics",           "Cloud Types and Characteristics"),
    ("Nimbus Cloud Characteristics",                 "Cloud Types and Characteristics"),
    ("Stratus Cloud Characteristics",                "Cloud Types and Characteristics"),
    ("Cloud Types",                                  "Cloud Types and Characteristics"),
])
def test_cleanup_tier2_2026_07_29(old, new):
    q = make_q(old)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == new


@pytest.mark.parametrize("kept", [
    # Question Tags — distinct grammar rules, not scenario splits.
    "Question Tags – Let's (Suggestions)",
    "Question Tags – Needn't",
    "Question Tags – Ought To",
    "Question Tags – Seldom (Negative Adverb)",
    "Question Tags – Indefinite Pronouns",
    "Question Tags – Subject-Pronoun Agreement",
    "Question Tags – Present Perfect",
    "Question Tags – Future Tense",
    # Atmosphere — distinct cloud concepts the `%Cloud%` sweep also matches.
    "Cloud Formation Mechanism",
    "Cloud Altitude",
    "Cloud and Weather Association",
    "Cloudburst",
    "Thunderstorm Clouds",
    "Monsoon Rainfall Clouds",
    # Chapter-scoped: cannot be renamed by a subtopic-keyed map (see below).
    "Vocabulary - Nouns",
    "Vocabulary - Adjectives",
    "Vocabulary - Verbs",
    "Features of Constitution",
])
def test_cleanup_tier2_distinct_subtopics_preserved(kept):
    q = make_q(kept)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == kept


# ── Tier 3: PYQ Vault subtopic conformance (2026-07-31) ────────────────────
# Targets are the canonical NDA Maths subtopic names from the PYQ Vault
# taxonomy (pyqvault.com/guide/nda-maths — 111 subtopics over 2,160 PYQs),
# the same content master `NDA_FREQ_BY_SUBJECT` already tracks at chapter
# level. Subtopic weightage can only be joined to a student's questions by
# exact name, so an off-taxonomy tag is invisible to that analysis.
#
# NOTE: this batch also RETARGETS existing entries whose target was itself
# off-taxonomy (`Sum of GP` pointed at `Sum of Geometric Progression`, not at
# canonical `Geometric Progressions`). `apply_renames` is single-pass, so a
# chain would silently leave those questions one hop short.

@pytest.mark.parametrize("old, new", [
    # Tier 1 — pure wording / prefix variants.
    ("Position Vectors and Section Formula",     "Position Vectors and Section"),
    ("Area Bounded by Curves, Lines, and Axes",  "Area Bounded by a Curve, Lines, and Axes"),
    ("Regression",                               "Regression and Correlation"),
    ("Composition of Functions",                 "Composition and Inverse of Functions"),
    ("Properties of Determinants",               "Determinant Properties, Operations, and Sums"),
    # Tier 2 — unambiguous single-parent rollup.
    ("Classical Probability",                    "Probability via Counting"),
    ("Combinatorial Probability",                "Probability via Counting"),
    ("Maxima and Minima",                        "Monotonicity, Extrema, and Critical Points"),
    ("Increasing and Decreasing Functions",      "Monotonicity, Extrema, and Critical Points"),
    ("Implicit Differentiation",                 "Parametric, Implicit, and Higher-Order Derivatives"),
    ("Scalar Triple Product",                    "Cross Product and Triple Product"),
    ("Powers of i",                              "Powers and Roots"),
    ("Sum of Geometric Progression",             "Geometric Progressions"),
    ("Equation of a Line",                       "Equation, Slope, and Family of Lines"),
    ("Inverse of a Matrix",                      "Cofactors, Adjoint, and Inverse"),
])
def test_cleanup_tier3_2026_07_31(old, new):
    q = make_q(old)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == new


@pytest.mark.parametrize("canonical", [
    # These two were being renamed AWAY from the canonical name — the same
    # wrong-direction bug as the `Height & Distance` chapter entry (2026-07-29).
    # A canonical name must survive a pass untouched.
    "Position Vectors and Section",
    "Area Bounded by a Curve, Lines, and Axes",
    # Canonical targets introduced by this batch must be terminal.
    "Probability via Counting",
    "Monotonicity, Extrema, and Critical Points",
    "Geometric Progressions",
    "Cofactors, Adjoint, and Inverse",
    "Parametric, Implicit, and Higher-Order Derivatives",
    "Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions",
])
def test_cleanup_tier3_canonical_names_survive(canonical):
    q = make_q(canonical)
    apply_renames([make_exam([q])], SUBTOPIC_RENAMES)
    assert q["subtopic"] == canonical


@pytest.mark.parametrize("name, chapters", [
    ("Arithmetic Mean",   "Sequence & Series / Statistics"),
    ("Mean and Variance", "Binomial Distribution / Statistics"),
    ("Product Rule",      "Differentiation / Logarithms"),
    ("Quotient Rule",     "Differentiation / Logarithms"),
])
def test_tier3_chapter_ambiguous_names_stay_unmapped(name, chapters):
    """Same capability gap as the Vocabulary entries — one key, two targets.

    Each of these appears under two chapters in the live bank and means a
    different thing in each (`Product Rule` is the derivative rule under
    Differentiation and log(ab)=log a+log b under Logarithms). A subtopic-keyed
    map cannot say that, and either global target would misfile the other
    chapter's questions.
    """
    assert name not in SUBTOPIC_RENAMES, (
        f"{name!r} appears in {chapters} and needs a chapter-scoped rename"
    )


def test_rename_map_cannot_express_chapter_scoped_renames():
    """Documents a real capability gap, so it isn't rediscovered as a bug.

    `Vocabulary - Nouns` lives in BOTH the Antonyms chapter (where it should
    become `Vocabulary - Antonyms`) and the Synonyms chapter (where it should
    become `Vocabulary - Synonyms`). The map is keyed on subtopic alone, so
    one key cannot resolve to two targets. Same for `Vocabulary - Adjectives`,
    `Vocabulary - Verbs`, and `Features of Constitution`
    (Constitutional Framework vs Preamble).

    Applying either target globally would mislabel the other chapter's
    questions — worse than leaving them split. These stay unmapped until
    `apply_renames` can key on (chapter, subtopic).
    """
    chapter_scoped = [
        "Vocabulary - Nouns",
        "Vocabulary - Adjectives",
        "Vocabulary - Verbs",
        "Features of Constitution",
    ]
    for name in chapter_scoped:
        assert name not in SUBTOPIC_RENAMES, (
            f"{name!r} needs a chapter-scoped rename; a global entry would "
            f"mislabel one of the two chapters it appears in"
        )


# ── Python / JS rename-map drift guard ─────────────────────────────────────
# The maps are duplicated in merge_subtopics.py (dev disk) and
# migrate_subtopics_supabase.js (prod). They must not drift — a miss means
# prod and dev disagree on a subtopic name, silently splitting analytics.

_JS_PAIR = re.compile(
    r"""(?P<kq>['"])(?P<key>(?:\\.|(?!(?P=kq))[^\\])*)(?P=kq)\s*:\s*"""
    r"""(?P<vq>['"])(?P<val>(?:\\.|(?!(?P=vq))[^\\])*)(?P=vq)""",
    re.S,
)


def _js_map_body(name):
    """Return the comment-stripped body of a top-level `const <name> = { … }`."""
    with open(JS_SCRIPT, encoding='utf-8') as f:
        src = f.read()
    start = src.index(f'const {name} = {{')
    end = src.index('\n}', start)
    return re.sub(r'//[^\n]*', '', src[start:end])   # strip line comments


def _parse_js_map(name):
    """Extract a top-level `const <name> = { … }` string map from the JS script."""
    return {m.group('key'): m.group('val') for m in _JS_PAIR.finditer(_js_map_body(name))}


# Outer keys of a nested map are plain chapter names — no quotes or backslashes
# inside them — so this stays deliberately simpler than _JS_PAIR.
_JS_OUTER = re.compile(r"'([^']*)'\s*:\s*\{([^{}]*)\}", re.S)


def _parse_js_nested_map(name):
    """Extract a top-level `const <name> = { k: { k: v } }` map from the JS script."""
    body = _js_map_body(name)
    return {
        outer: {m.group('key'): m.group('val') for m in _JS_PAIR.finditer(inner)}
        for outer, inner in _JS_OUTER.findall(body)
    }


def test_js_subtopic_map_matches_python():
    js_map = _parse_js_map('SUBTOPIC_RENAMES')
    assert js_map, 'failed to parse SUBTOPIC_RENAMES out of the JS script'
    assert js_map == SUBTOPIC_RENAMES, (
        'SUBTOPIC_RENAMES has drifted between merge_subtopics.py and '
        'migrate_subtopics_supabase.js\n'
        f'  only in .py: {sorted(set(SUBTOPIC_RENAMES) - set(js_map))}\n'
        f'  only in .js: {sorted(set(js_map) - set(SUBTOPIC_RENAMES))}\n'
        f'  differing targets: '
        f'{sorted(k for k in set(js_map) & set(SUBTOPIC_RENAMES) if js_map[k] != SUBTOPIC_RENAMES[k])}'
    )


def test_js_chapter_map_matches_python():
    assert _parse_js_map('CHAPTER_RENAMES') == CHAPTER_RENAMES


# ── Chapter renames ────────────────────────────────────────────────────────

def test_chapter_rename_heights_and_distances():
    """Canonical is `Height & Distance` — the name NDA_FREQ_BY_SUBJECT carries.

    This mapping pointed the other way from 2026-06-16 until 2026-07-29. It was
    never run against prod until the Tier 1 sweep, which then pushed 2 questions
    onto a name `computeProjectedScore` cannot join — chapter names bind to the
    weightage table by exact match, and a miss scores 0.
    """
    q = {"q": 1, "chapter": "Heights and Distances", "subject": "Maths"}
    changed = apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert changed == 1
    assert q["chapter"] == "Height & Distance"

def test_chapter_rename_canonical_unchanged():
    q = {"q": 1, "chapter": "Height & Distance", "subject": "Maths"}
    changed = apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert changed == 0
    assert q["chapter"] == "Height & Distance"

def test_chapter_rename_unmatched_unchanged():
    q = {"q": 1, "chapter": "Differentiation", "subject": "Maths"}
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert q["chapter"] == "Differentiation"

def test_chapter_rename_is_idempotent():
    q = {"q": 1, "chapter": "Heights and Distances", "subject": "Maths"}
    exams = [make_exam([q])]
    apply_chapter_renames(exams, CHAPTER_RENAMES)
    apply_chapter_renames(exams, CHAPTER_RENAMES)
    assert q["chapter"] == "Height & Distance"

def test_chapter_rename_empty_and_missing():
    assert apply_chapter_renames([], CHAPTER_RENAMES) == 0
    assert apply_chapter_renames([make_exam([{"q": 1}])], CHAPTER_RENAMES) == 0


# ── Chapter renames must target a name the weightage table knows ───────
# `computeProjectedScore` joins question chapters to NDA_FREQ_BY_SUBJECT by
# exact (case-insensitive) string match and scores `projected: 0` on a miss.
# A rename whose TARGET is off that list therefore makes analytics worse, not
# better — silently, since nothing errors.

def _canonical_maths_chapters():
    """Chapter names from the Maths block of src/lib/ndaFreq.js."""
    with open(NDA_FREQ_JS, encoding='utf-8') as f:
        src = f.read()
    start = src.index('Maths: [')
    end = src.index('],', start)
    return set(re.findall(r"chapter:\s*'([^']*)'", src[start:end]))


def test_canonical_maths_chapter_list_is_parseable():
    canon = _canonical_maths_chapters()
    assert len(canon) > 25, f'parsed only {len(canon)} chapters from ndaFreq.js'
    assert 'Height & Distance' in canon


# Targets that live ONLY in the faculty-configured table
# (faculty_state.data.ndaFreqBySubject), not in the ndaFreq.js seed — the seed
# is empty for every subject except Maths. A test cannot query Supabase, so
# this is a deliberate snapshot: each entry records the subject and pct it was
# verified at. Adding one must be a conscious act, not an accident.
NON_SEED_CHAPTER_TARGETS = {
    'Idioms & Phrases',    # English, pct 3.2 — verified against prod 2026-07-29
}


def _allowed_chapter_targets():
    return _canonical_maths_chapters() | NON_SEED_CHAPTER_TARGETS


def test_chapter_rename_targets_are_in_the_weightage_table():
    allowed = _allowed_chapter_targets()
    for old, new in CHAPTER_RENAMES.items():
        assert new in allowed, (
            f'{old!r} -> {new!r}: the target is in neither NDA_FREQ_BY_SUBJECT.Maths '
            f'nor NON_SEED_CHAPTER_TARGETS, so every renamed question would score 0 '
            f'in computeProjectedScore. If this is a configured non-Maths chapter, '
            f'verify it against prod and add it to NON_SEED_CHAPTER_TARGETS.'
        )


def test_english_idioms_ampersand_variant():
    """`Idioms and Phrases` (56 Q) vs the configured `Idioms & Phrases` (233 Q)."""
    q = make_cq("Idioms and Phrases", "any subtopic", subject="English")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == "Idioms & Phrases"


@pytest.mark.parametrize("kept", [
    # The 'English' placeholder chapter holds five different sections under one
    # (chapter, subtopic) pair, so neither map can split it. Per-question work.
    "English",
])
def test_english_placeholder_chapter_is_not_renamed(kept):
    q = make_cq(kept, "General", subject="English")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == kept
    assert kept not in CHAPTER_RENAMES


# ── Chapter conformance: (chapter, subtopic) precedence (2026-07-29) ───────
# A chapter can need more than one target. `Integration` (25 Q) is really
# `Indefinite Integration` except for 3 questions that are definite integrals —
# one chapter name, two correct answers, which a chapter-keyed map cannot say.
# CHAPTER_SUBTOPIC_RENAMES holds the exceptions; CHAPTER_RENAMES the default.

def make_cq(chapter, subtopic=None, subject="Maths"):
    return {"q": 1, "chapter": chapter, "subject": subject, "subtopic": subtopic}


def test_subtopic_exception_wins_over_chapter_wide_rename():
    q = make_cq("Integration", "Definite integral with greatest integer function")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == "Definite Integration"


def test_chapter_wide_rename_applies_when_subtopic_is_not_an_exception():
    q = make_cq("Integration", "Integration by Substitution")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == "Indefinite Integration"


def test_chapter_wide_rename_applies_when_subtopic_is_missing():
    q = make_cq("Integration", None)
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == "Indefinite Integration"


def test_subtopic_map_does_not_touch_other_chapters():
    q = make_cq("Differentiation", "Definite integral with greatest integer function")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == "Differentiation"


def test_apply_chapter_renames_without_subtopic_map_is_backward_compatible():
    q = make_cq("Integration", "Definite integral with greatest integer function")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES)
    assert q["chapter"] == "Indefinite Integration"


def test_chapter_subtopic_renames_counts_each_change_once():
    exams = [make_exam([
        make_cq("Integration", "Definite integral of log over symmetric interval"),
        make_cq("Integration", "Integration by Substitution"),
        make_cq("Vectors", "Anything"),
    ])]
    changed = apply_chapter_renames(exams, CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert changed == 2


@pytest.mark.parametrize("old,new", [
    ("Limits",           "Limits & Continuity"),
    ("Straight Line",    "Lines"),
    ("Area Under Curve", "Applications of Integration"),
    ("Integration",      "Indefinite Integration"),
])
def test_maths_chapter_conformance_2026_07_29(old, new):
    q = make_cq(old, "some subtopic")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == new


@pytest.mark.parametrize("subtopic", [
    "Definite integral of log over symmetric interval",
    "Definite integral with greatest integer function",
    "Definite integral with greatest integer function — second constant",
])
def test_integration_definite_exceptions(subtopic):
    q = make_cq("Integration", subtopic)
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == "Definite Integration"


@pytest.mark.parametrize("kept", [
    # Class-10 foundation paper (APJ_NDA_11th, 2026-06-14). Correctly tagged —
    # these chapters are real, they are just not NDA chapters. Renaming them
    # into an NDA chapter would score foundation work at NDA weightage.
    # Decision 2026-07-29: leave off-table, do not map.
    "Real Numbers", "Polynomials", "Triangles", "Areas Related to Circles",
    "Pair of Linear Equations", "Coordinate Geometry", "Arithmetic Progressions",
    "Introduction to Trigonometry",
])
def test_foundation_paper_chapters_are_not_renamed(kept):
    q = make_cq(kept, "any subtopic")
    apply_chapter_renames([make_exam([q])], CHAPTER_RENAMES, CHAPTER_SUBTOPIC_RENAMES)
    assert q["chapter"] == kept
    assert kept not in CHAPTER_RENAMES


def test_chapter_subtopic_rename_targets_are_in_the_weightage_table():
    canon = _canonical_maths_chapters()
    for chapter, subs in CHAPTER_SUBTOPIC_RENAMES.items():
        for subtopic, new in subs.items():
            assert new in canon, (
                f'({chapter!r}, {subtopic!r}) -> {new!r}: target is not in '
                f'NDA_FREQ_BY_SUBJECT.Maths, so renamed questions would score 0.'
            )


def test_js_chapter_subtopic_map_matches_python():
    assert _parse_js_nested_map('CHAPTER_SUBTOPIC_RENAMES') == CHAPTER_SUBTOPIC_RENAMES


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
