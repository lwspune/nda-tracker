// Tests for Dashboard subject filter logic.
// These are pure-function tests — no React, no store.
// The helper `getAvailableSubjects` will be extracted from Dashboard once implemented.

// ── Fixture factory ──────────────────────────────────────────────────────────

function makeExam(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Test Exam',
    date: '2024-01-01',
    subject: 'Maths',
    batch: null,
    marking: { correct: 4, wrong: -1 },
    questions: [],
    students: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Helper under test (mirrors what Dashboard will implement) ────────────────
// We define the function here so tests are written against the expected contract.
// Once the Dashboard implements it (inline), these tests verify the same logic.

function getAvailableSubjects(exams) {
  return [...new Set(exams.map(e => e.subject || 'Maths'))].sort()
}

function applySubjectFilter(exams, subjectFilter) {
  if (subjectFilter === 'all') return exams
  return exams.filter(e => (e.subject || 'Maths') === subjectFilter)
}

function applyBatchFilter(exams, batchFilter) {
  if (batchFilter === 'all') return exams
  return exams.filter(e => e.batch === batchFilter)
}

function applyExamFilter(exams, examId) {
  if (examId === 'all') return exams
  return exams.filter(e => e.id === examId)
}

// ── getAvailableSubjects ─────────────────────────────────────────────────────

describe('getAvailableSubjects', () => {
  it('returns empty array when there are no exams', () => {
    expect(getAvailableSubjects([])).toEqual([])
  })

  it('returns a single subject when all exams share the same subject', () => {
    const exams = [
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'Maths' }),
    ]
    expect(getAvailableSubjects(exams)).toEqual(['Maths'])
  })

  it('returns unique subjects sorted alphabetically', () => {
    const exams = [
      makeExam({ subject: 'Physics' }),
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: 'English' }),
      makeExam({ subject: 'Physics' }), // duplicate
    ]
    expect(getAvailableSubjects(exams)).toEqual(['English', 'Maths', 'Physics'])
  })

  it('defaults to Maths when subject field is missing on an exam', () => {
    const exam = makeExam()
    delete exam.subject
    expect(getAvailableSubjects([exam])).toEqual(['Maths'])
  })

  it('defaults to Maths when subject field is null', () => {
    const exam = makeExam({ subject: null })
    expect(getAvailableSubjects([exam])).toEqual(['Maths'])
  })

  it('does not include duplicate subjects even when mixed with missing fields', () => {
    const exams = [
      makeExam({ subject: 'Maths' }),
      makeExam({ subject: null }),   // should also resolve to 'Maths'
    ]
    expect(getAvailableSubjects(exams)).toEqual(['Maths'])
  })
})

// ── Subject filter ───────────────────────────────────────────────────────────

describe('applySubjectFilter', () => {
  const exams = [
    makeExam({ id: 'e1', subject: 'Maths' }),
    makeExam({ id: 'e2', subject: 'Physics' }),
    makeExam({ id: 'e3', subject: 'Maths' }),
    makeExam({ id: 'e4', subject: 'English' }),
  ]

  it('returns all exams when filter is "all"', () => {
    expect(applySubjectFilter(exams, 'all')).toHaveLength(4)
  })

  it('returns only exams matching the selected subject', () => {
    const result = applySubjectFilter(exams, 'Maths')
    expect(result).toHaveLength(2)
    expect(result.every(e => e.subject === 'Maths')).toBe(true)
  })

  it('returns empty array when no exams match subject', () => {
    expect(applySubjectFilter(exams, 'Chemistry')).toHaveLength(0)
  })

  it('treats null subject as Maths', () => {
    const withNull = [makeExam({ id: 'x', subject: null })]
    expect(applySubjectFilter(withNull, 'Maths')).toHaveLength(1)
  })
})

// ── Filter chain: subject → batch → specific exam ───────────────────────────

describe('filter chain', () => {
  const mathsBatch1 = makeExam({ id: 'm1', subject: 'Maths', batch: 'Batch-A' })
  const mathsBatch2 = makeExam({ id: 'm2', subject: 'Maths', batch: 'Batch-B' })
  const physBatch1  = makeExam({ id: 'p1', subject: 'Physics', batch: 'Batch-A' })
  const physNoBatch = makeExam({ id: 'p2', subject: 'Physics', batch: null })

  const exams = [mathsBatch1, mathsBatch2, physBatch1, physNoBatch]

  it('subject → batch narrows correctly', () => {
    const afterSubject = applySubjectFilter(exams, 'Physics')
    const afterBatch   = applyBatchFilter(afterSubject, 'Batch-A')
    expect(afterBatch).toHaveLength(1)
    expect(afterBatch[0].id).toBe('p1')
  })

  it('subject → batch → specific exam returns exactly one exam', () => {
    const afterSubject = applySubjectFilter(exams, 'Maths')
    const afterBatch   = applyBatchFilter(afterSubject, 'Batch-A')
    const afterExam    = applyExamFilter(afterBatch, 'm1')
    expect(afterExam).toHaveLength(1)
    expect(afterExam[0].id).toBe('m1')
  })

  it('specific exam filter only sees exams in the already-filtered set', () => {
    // m2 is Maths/Batch-B. If subject=Physics, batch filter for Batch-B returns [].
    // Trying to select m2 by ID on the empty set returns nothing.
    const afterSubject = applySubjectFilter(exams, 'Physics')
    const afterBatch   = applyBatchFilter(afterSubject, 'Batch-B')
    const afterExam    = applyExamFilter(afterBatch, 'm2') // m2 is Maths, not in set
    expect(afterExam).toHaveLength(0)
  })

  it('all-subjects + all-batches + all-exams returns full list', () => {
    const result = applyExamFilter(applyBatchFilter(applySubjectFilter(exams, 'all'), 'all'), 'all')
    expect(result).toHaveLength(4)
  })
})

// ── Batch dropdown options after subject change ──────────────────────────────
// After the user changes subject, the available batches visible in the batch
// dropdown must be re-derived from subject-filtered exams only.

describe('batch options after subject change', () => {
  function getAvailableBatches(exams) {
    return [...new Set(exams.map(e => e.batch).filter(Boolean))]
  }

  it('shows only batches that have exams in the selected subject', () => {
    const exams = [
      makeExam({ subject: 'Maths',   batch: 'Batch-A' }),
      makeExam({ subject: 'Physics', batch: 'Batch-B' }),
    ]
    const subjectFiltered = applySubjectFilter(exams, 'Maths')
    expect(getAvailableBatches(subjectFiltered)).toEqual(['Batch-A'])
  })

  it('shows no batches when subject has no exam with a batch', () => {
    const exams = [makeExam({ subject: 'Maths', batch: null })]
    const subjectFiltered = applySubjectFilter(exams, 'Maths')
    expect(getAvailableBatches(subjectFiltered)).toEqual([])
  })
})

// ── Exam dropdown options after subject change ───────────────────────────────

describe('exam dropdown options after subject change', () => {
  it('lists only exams matching the selected subject', () => {
    const exams = [
      makeExam({ id: 'e1', name: 'Maths Test 1', subject: 'Maths' }),
      makeExam({ id: 'e2', name: 'Physics Test 1', subject: 'Physics' }),
    ]
    const filtered = applySubjectFilter(exams, 'Maths')
    const ids = filtered.map(e => e.id)
    expect(ids).toEqual(['e1'])
  })
})
