// NDA Maths subtopic weightage — the level below `NDA_FREQ_BY_SUBJECT.Maths`.
//
// Source: PYQ Vault's NDA Maths taxonomy (pyqvault.com/guide/nda-maths) —
// 2160 PYQs across 18 papers, as of 2026-05-17. That is the same content master
// the chapter table already tracks, so chapter names here join it exactly.
//
// `share` is the subtopic's percentage share WITHIN its chapter (each chapter's
// shares sum to 100). Marks at stake are therefore derived, never stored:
//
//     subtopicMarks = chapterPct / 100 * totalMarks * share / 100
//
// That is deliberate. Chapter weights are faculty-editable in
// Settings -> NDA Weightage; keying subtopics to a share of their parent means an
// edited chapter weight flows down automatically instead of contradicting the
// row above it. It also avoids a 111-row editor and a global sum-to-100 gate.
//
// This is empirical fact about the paper, not configuration, so it is a plain
// module constant: NOT store state, NOT persisted, NOT in the student-login
// payload. Adding it needs no `saveToStorage` allow-list entry and no
// `migrateFreq` branch.
//
// `pctHard` is the share of that subtopic's bank questions rated HARD. It is
// carried for display/triage only and never enters the projected score.

export const NDA_SUBTOPIC_SHARES = {
  '3D Geometry': [
    { subtopic: 'Direction Cosines and Ratios', share: 26.97, qCount: 24, pctHard: 25 },
    { subtopic: 'Sphere', share: 22.47, qCount: 20, pctHard: 20 },
    { subtopic: 'Distance, Section, and Collinearity in 3D', share: 22.47, qCount: 20, pctHard: 30 },
    { subtopic: 'The Plane', share: 15.73, qCount: 14, pctHard: 21 },
    { subtopic: 'The Straight Line in 3D', share: 12.36, qCount: 11, pctHard: 9 },
  ],
  'Application of Derivatives': [
    { subtopic: 'Monotonicity, Extrema, and Critical Points', share: 52.05, qCount: 38, pctHard: 16 },
    { subtopic: 'Optimisation — Geometric, Trigonometric, AM-GM', share: 41.10, qCount: 30, pctHard: 20 },
    { subtopic: 'Tangents and Slopes', share: 6.85, qCount: 5, pctHard: 0 },
  ],
  'Applications of Integration': [
    { subtopic: 'Area Bounded by a Curve, Lines, and Axes', share: 64.00, qCount: 16, pctHard: 19 },
    { subtopic: 'Area Between Two Curves and Intersection Points', share: 36.00, qCount: 9, pctHard: 22 },
  ],
  'Binary Numbers': [
    { subtopic: 'Binary Arithmetic — Addition, Division, and Algebraic Identities', share: 53.84, qCount: 7, pctHard: 43 },
    { subtopic: 'Binary Representation and Number Theory', share: 23.08, qCount: 3, pctHard: 33 },
    { subtopic: 'Binary to Decimal Conversion', share: 23.08, qCount: 3, pctHard: 0 },
  ],
  'Binomial Distribution': [
    { subtopic: 'Mean, Variance, and Parameter Estimation in B(n, p)', share: 50.00, qCount: 15, pctHard: 13 },
    { subtopic: 'Computing Binomial Probabilities — Exact, At-Least, and Complementary Events', share: 50.00, qCount: 15, pctHard: 7 },
  ],
  'Binomial Theorem': [
    { subtopic: 'Coefficients and Specific Terms in Expansion', share: 53.70, qCount: 29, pctHard: 14 },
    { subtopic: 'Sums of Binomial Coefficients — Alternating, Weighted, and Symmetric', share: 25.93, qCount: 14, pctHard: 14 },
    { subtopic: 'Integer and Fractional Parts of Binomial Expressions', share: 14.81, qCount: 8, pctHard: 38 },
    { subtopic: 'Remainders and Divisibility via Binomial Expansion', share: 5.56, qCount: 3, pctHard: 0 },
  ],
  'Circles': [
    { subtopic: 'Circle Equation — Centre, Radius, Diameter, and Properties', share: 40.74, qCount: 11, pctHard: 0 },
    { subtopic: 'Circles Through Given Points and Concyclicity', share: 33.33, qCount: 9, pctHard: 78 },
    { subtopic: 'Inscribed Geometry, Tangents, and Segments', share: 25.93, qCount: 7, pctHard: 57 },
  ],
  'Complex Numbers': [
    { subtopic: 'Modulus, Argument, and Conjugate', share: 54.17, qCount: 39, pctHard: 15 },
    { subtopic: 'Cube Roots of Unity', share: 25.00, qCount: 18, pctHard: 33 },
    { subtopic: 'Powers and Roots', share: 20.83, qCount: 15, pctHard: 27 },
  ],
  'Conics': [
    { subtopic: 'Ellipse — Foci, Eccentricity, and Focal Distances', share: 36.84, qCount: 14, pctHard: 14 },
    { subtopic: 'Parabola — Equation, Properties, and Latus Rectum', share: 34.21, qCount: 13, pctHard: 23 },
    { subtopic: 'Conic Sections — Identification and Eccentricity Comparison', share: 18.42, qCount: 7, pctHard: 43 },
    { subtopic: 'Hyperbola — Foci and Eccentricity', share: 10.53, qCount: 4, pctHard: 0 },
  ],
  'Definite Integration': [
    { subtopic: 'Properties of Definite Integrals — Symmetry, King\'s, Odd/Even', share: 48.47, qCount: 32, pctHard: 28 },
    { subtopic: 'Integration of Absolute Value, Piecewise, and Greatest Integer Functions', share: 25.76, qCount: 17, pctHard: 12 },
    { subtopic: 'Fundamental Theorem, Periodic Integrals, and Leibniz Rule', share: 16.67, qCount: 11, pctHard: 0 },
    { subtopic: 'Definite Integrals in Function Conditions', share: 4.55, qCount: 3, pctHard: 67 },
    { subtopic: 'Area Under Curves', share: 4.55, qCount: 3, pctHard: 0 },
  ],
  'Differential Equations': [
    { subtopic: 'Solving and Verifying ODEs — Separable, IVP, and Applications', share: 46.03, qCount: 29, pctHard: 28 },
    { subtopic: 'Order, Degree, and Solutions of ODE', share: 34.92, qCount: 22, pctHard: 32 },
    { subtopic: 'Formation of ODE from Curves and General Solutions', share: 19.05, qCount: 12, pctHard: 25 },
  ],
  'Differentiation': [
    { subtopic: 'Differentiation Techniques — Chain Rule, Logarithmic, Composite Functions', share: 57.65, qCount: 49, pctHard: 14 },
    { subtopic: 'Parametric, Implicit, and Higher-Order Derivatives', share: 23.53, qCount: 20, pctHard: 50 },
    { subtopic: 'Differentiability of Absolute Value, Piecewise, and Greatest Integer Functions', share: 18.82, qCount: 16, pctHard: 19 },
  ],
  'Functions': [
    { subtopic: 'Domain, Range, and Function Properties', share: 44.04, qCount: 48, pctHard: 2 },
    { subtopic: 'Composition and Inverse of Functions', share: 25.69, qCount: 28, pctHard: 25 },
    { subtopic: 'Functional Equations', share: 16.51, qCount: 18, pctHard: 6 },
    { subtopic: 'Function Definition and Classification — Injectivity, Surjectivity, Bijectivity', share: 7.34, qCount: 8, pctHard: 0 },
    { subtopic: 'Greatest Integer Function', share: 6.42, qCount: 7, pctHard: 29 },
  ],
  'Height & Distance': [
    { subtopic: 'Heights and Distances from Angles of Elevation', share: 66.67, qCount: 16, pctHard: 69 },
    { subtopic: 'Shadows, Leaning Structures, and Special Geometry', share: 33.33, qCount: 8, pctHard: 75 },
  ],
  'Indefinite Integration': [
    { subtopic: 'Integration by Substitution — Algebraic, Trigonometric, and Composite Forms', share: 42.50, qCount: 17, pctHard: 24 },
    { subtopic: 'Standard Forms — Exponential, Logarithmic, and Paired Trigonometric Integrals', share: 32.50, qCount: 13, pctHard: 23 },
    { subtopic: 'Integration by Partial Fractions', share: 17.50, qCount: 7, pctHard: 29 },
    { subtopic: 'Integration by Parts', share: 7.50, qCount: 3, pctHard: 0 },
  ],
  'Inverse Trigonometry': [
    { subtopic: 'Identities, Properties, and Sum-Difference Formulas', share: 50.00, qCount: 17, pctHard: 12 },
    { subtopic: 'Evaluation of Composite Inverse Trigonometric Expressions', share: 32.35, qCount: 11, pctHard: 36 },
    { subtopic: 'Solving Inverse Trigonometric Equations and Geometric Applications', share: 17.65, qCount: 6, pctHard: 33 },
  ],
  'Limits & Continuity': [
    { subtopic: 'Continuity and Differentiability — Piecewise, Modulus, Composed, Oscillatory', share: 41.98, qCount: 34, pctHard: 12 },
    { subtopic: 'Limit Evaluation Techniques — L\'Hôpital, Rationalization, Standard Forms', share: 38.27, qCount: 31, pctHard: 10 },
    { subtopic: 'One-Sided Limits, Greatest Integer, and Absolute Value Limits', share: 19.75, qCount: 16, pctHard: 25 },
  ],
  'Linear Inequalities': [
    { subtopic: 'Linear Systems and Feasible Regions', share: 100.00, qCount: 5, pctHard: 0 },
  ],
  'Lines': [
    { subtopic: 'Triangles, Quadrilaterals, and Polygons', share: 32.99, qCount: 32, pctHard: 19 },
    { subtopic: 'Equation, Slope, and Family of Lines', share: 27.84, qCount: 27, pctHard: 15 },
    { subtopic: 'Distance, Section, and Locus', share: 22.68, qCount: 22, pctHard: 27 },
    { subtopic: 'Angle Between Lines, Parallelism, and Perpendicularity', share: 16.49, qCount: 16, pctHard: 25 },
  ],
  'Logarithms': [
    { subtopic: 'Logarithm Identities, Change of Base, and Sums', share: 59.26, qCount: 16, pctHard: 13 },
    { subtopic: 'Solving Logarithmic Equations and Applications', share: 40.74, qCount: 11, pctHard: 27 },
  ],
  'Matrices & Determinants': [
    { subtopic: 'Determinant Properties, Operations, and Sums', share: 34.71, qCount: 59, pctHard: 46 },
    { subtopic: 'Matrix Operations, Polynomials, and Equations', share: 19.41, qCount: 33, pctHard: 12 },
    { subtopic: 'Cofactors, Adjoint, and Inverse', share: 16.47, qCount: 28, pctHard: 25 },
    { subtopic: 'Special Matrices — Skew-Symmetric, Diagonal, Idempotent, Orthogonal, Rotation', share: 12.94, qCount: 22, pctHard: 9 },
    { subtopic: 'Special Determinants — Trig, Complex, Roots of Unity, Polynomial', share: 11.76, qCount: 20, pctHard: 50 },
    { subtopic: 'Linear Systems — Consistency, Cramer\'s Rule, Solution Space', share: 4.71, qCount: 8, pctHard: 25 },
  ],
  'Permutation & Combination': [
    { subtopic: 'Forming Numbers from Digits', share: 25.65, qCount: 20, pctHard: 20 },
    { subtopic: 'Arrangements with Restrictions', share: 21.79, qCount: 17, pctHard: 24 },
    { subtopic: 'Factorials and Binomial Coefficients', share: 21.79, qCount: 17, pctHard: 29 },
    { subtopic: 'Geometric Counting', share: 16.67, qCount: 13, pctHard: 8 },
    { subtopic: 'Combinations', share: 14.10, qCount: 11, pctHard: 9 },
  ],
  'Probability': [
    { subtopic: 'Probability via Counting', share: 52.47, qCount: 85, pctHard: 19 },
    { subtopic: 'Conditional Probability, Total Probability, and Bayes\' Theorem', share: 17.90, qCount: 29, pctHard: 14 },
    { subtopic: 'Event Algebra — Inclusion-Exclusion, Mutually Exclusive, Exhaustive', share: 12.96, qCount: 21, pctHard: 14 },
    { subtopic: 'Independent Events', share: 9.26, qCount: 15, pctHard: 13 },
    { subtopic: 'Bounds on Probability', share: 7.41, qCount: 12, pctHard: 25 },
  ],
  'Properties of Triangle': [
    { subtopic: 'Sine and Cosine Rules — Solving Triangles', share: 59.19, qCount: 29, pctHard: 45 },
    { subtopic: 'Triangle Identities — A+B+C=π, Half-Angle, and Double-Angle', share: 28.57, qCount: 14, pctHard: 43 },
    { subtopic: 'In-circle and Regular Polygon Geometry', share: 12.24, qCount: 6, pctHard: 50 },
  ],
  'Quadratic Equations': [
    { subtopic: 'Vieta\'s Relations and Root-Coefficient Identities', share: 41.27, qCount: 26, pctHard: 42 },
    { subtopic: 'Nature of Roots and Boundary Conditions', share: 33.33, qCount: 21, pctHard: 33 },
    { subtopic: 'Special Quadratics — Parametric, Logarithmic, Constructed', share: 25.40, qCount: 16, pctHard: 44 },
  ],
  'Sequence & Series': [
    { subtopic: 'Arithmetic Progressions', share: 47.19, qCount: 42, pctHard: 14 },
    { subtopic: 'Geometric Progressions', share: 21.35, qCount: 19, pctHard: 5 },
    { subtopic: 'Interrelating AP, GP and HP', share: 16.85, qCount: 15, pctHard: 40 },
    { subtopic: 'Special Series and Special Sums', share: 8.99, qCount: 8, pctHard: 38 },
    { subtopic: 'Harmonic Progressions and the Three Means', share: 5.62, qCount: 5, pctHard: 60 },
  ],
  'Sets & Relations': [
    { subtopic: 'Counting Sets, Subsets, and Inclusion-Exclusion', share: 39.13, qCount: 27, pctHard: 11 },
    { subtopic: 'Set Operations, Identities, and Cartesian Products of Sets', share: 33.33, qCount: 23, pctHard: 22 },
    { subtopic: 'Relations — Properties, Cartesian Product, and Counting', share: 27.54, qCount: 19, pctHard: 5 },
  ],
  'Statistics': [
    { subtopic: 'Measures of Central Tendency — Mean, Median, Mode', share: 46.87, qCount: 75, pctHard: 13 },
    { subtopic: 'Dispersion — Standard Deviation, Variance, Mean Deviation', share: 27.50, qCount: 44, pctHard: 9 },
    { subtopic: 'Regression and Correlation', share: 16.88, qCount: 27, pctHard: 22 },
    { subtopic: 'Frequency Distributions and Graphical Representation', share: 8.75, qCount: 14, pctHard: 0 },
  ],
  'Trigonometric Equations': [
    { subtopic: 'General Solutions and Counting Solutions of Trigonometric Equations', share: 39.40, qCount: 13, pctHard: 46 },
    { subtopic: 'Solving Specific Forms — Double-Angle, Product, Logarithmic, and Vieta', share: 39.39, qCount: 13, pctHard: 15 },
    { subtopic: 'Simultaneous and Combined Trigonometric Systems', share: 21.21, qCount: 7, pctHard: 43 },
  ],
  'Trigonometric Identities': [
    { subtopic: 'Compound Angle Formulas', share: 27.53, qCount: 38, pctHard: 26 },
    { subtopic: 'Multiple and Half-Angle Formulas', share: 21.74, qCount: 30, pctHard: 43 },
    { subtopic: 'Product-to-Sum and Sum-to-Product Identities', share: 19.57, qCount: 27, pctHard: 44 },
    { subtopic: 'Maximum and Minimum of Trigonometric Expressions', share: 15.94, qCount: 22, pctHard: 27 },
    { subtopic: 'Specific Values and Quadrants', share: 15.22, qCount: 21, pctHard: 29 },
  ],
  'Vectors': [
    { subtopic: 'Cross Product and Triple Product', share: 38.14, qCount: 37, pctHard: 27 },
    { subtopic: 'Dot Product and Angle', share: 32.99, qCount: 32, pctHard: 13 },
    { subtopic: 'Magnitude, Components, Projection, and Direction Cosines', share: 11.34, qCount: 11, pctHard: 9 },
    { subtopic: 'Vector Geometry — Triangles, Parallelograms, Quadrilaterals', share: 11.34, qCount: 11, pctHard: 9 },
    { subtopic: 'Position Vectors and Section', share: 6.19, qCount: 6, pctHard: 50 },
  ],
}

// Subtopics for a chapter, or [] when the chapter has no taxonomy entry.
// Callers must treat [] as "no subtopic detail available", never as "no marks".
export function getSubtopicShares(chapter) {
  return NDA_SUBTOPIC_SHARES[chapter] || []
}
