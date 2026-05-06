import { describe, it, expect } from 'vitest'
import { nextLwsId, mergeStudents, enrichWithRollNos, applyManualMatch, findDuplicateCandidates, mergeStudentRecords, getUnmatchedExamNames, findExamNameCandidates } from '../mergeStudents'
import { parseStudentDate } from '../excel'

// ── Fixtures ──────────────────────────────────────────────────

function makeExisting(overrides = {}) {
  return {
    lws_id:            'LWS-001',
    canonical_name:    'Alice Sharma',
    mobile:            '9000000001',
    dob:               '2008-05-10',
    gender:            'Female',
    email:             'alice@example.com',
    eis_reg_no:        'EIS-001',
    registration_date: '2026-01-15',
    batches:           ['11&12 (25-27) A'],
    branch:            'TBU',
    account_status:    'Active',
    coming_status:     'Coming',
    quit_date:         null,
    name_variants:     ['Alice Sharma'],
    evalbee_roll_nos:  ['001'],
    match_signatures:  ['alice sharma', '9000000001', 'EIS-001'],
    attendance:        [{ date: '2026-04-01', status: 'P' }],
    exams:             [],
    fees:              { paid: 10000 },
    ...overrides,
  }
}

function makeImportRow(overrides = {}) {
  return {
    eis_reg_no:        'EIS-001',
    canonical_name:    'Alice Sharma',
    gender:            'Female',
    dob:               '2008-05-10',
    mobile:            '9000000001',
    email:             'alice@example.com',
    batches:           ['11&12 (25-27) A'],
    coming_status:     'Coming',
    account_status:    'Active',
    registration_date: '2026-01-15',
    quit_date:         null,
    ...overrides,
  }
}

// ── nextLwsId ─────────────────────────────────────────────────

describe('nextLwsId', () => {
  it('returns LWS-001 for empty array', () => {
    expect(nextLwsId([])).toBe('LWS-001')
  })

  it('returns next sequential ID after existing students', () => {
    const students = [
      makeExisting({ lws_id: 'LWS-001' }),
      makeExisting({ lws_id: 'LWS-002' }),
      makeExisting({ lws_id: 'LWS-010' }),
    ]
    expect(nextLwsId(students)).toBe('LWS-011')
  })

  it('pads IDs to 3 digits', () => {
    const students = [makeExisting({ lws_id: 'LWS-009' })]
    expect(nextLwsId(students)).toBe('LWS-010')
  })

  it('handles students with missing or malformed lws_id', () => {
    const students = [
      makeExisting({ lws_id: 'LWS-005' }),
      makeExisting({ lws_id: '' }),
      makeExisting({ lws_id: null }),
    ]
    expect(nextLwsId(students)).toBe('LWS-006')
  })
})

// ── mergeStudents — counts ────────────────────────────────────

describe('mergeStudents — counts', () => {
  it('returns added=1 for a brand-new student', () => {
    const { added, updated, unchanged } = mergeStudents(
      [makeExisting()],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar' })],
    )
    expect(added).toBe(1)
    expect(updated).toBe(0)
    expect(unchanged).toBe(0)
  })

  it('returns updated=1 when an existing student has a changed field', () => {
    const { added, updated, unchanged } = mergeStudents(
      [makeExisting({ mobile: '9000000001' })],
      [makeImportRow({ mobile: '9999999999' })],
    )
    expect(added).toBe(0)
    expect(updated).toBe(1)
    expect(unchanged).toBe(0)
  })

  it('returns unchanged=1 when nothing differs', () => {
    const { added, updated, unchanged } = mergeStudents(
      [makeExisting()],
      [makeImportRow()],
    )
    expect(added).toBe(0)
    expect(updated).toBe(0)
    expect(unchanged).toBe(1)
  })

  it('skips rows without eis_reg_no', () => {
    const { added, updated, unchanged } = mergeStudents(
      [makeExisting()],
      [makeImportRow({ eis_reg_no: '' })],
    )
    expect(added).toBe(0)
    expect(updated).toBe(0)
    expect(unchanged).toBe(0)
  })

  it('handles mixed batch of new + updated + unchanged', () => {
    const existing = [
      makeExisting({ lws_id: 'LWS-001', eis_reg_no: 'EIS-001', mobile: '9000000001' }),
      makeExisting({ lws_id: 'LWS-002', eis_reg_no: 'EIS-002', mobile: '9000000002', canonical_name: 'Bob Kumar', name_variants: ['Bob Kumar'] }),
    ]
    const imported = [
      makeImportRow({ eis_reg_no: 'EIS-001', mobile: '9111111111' }), // updated
      makeImportRow({ eis_reg_no: 'EIS-002', mobile: '9000000002', canonical_name: 'Bob Kumar' }), // unchanged
      makeImportRow({ eis_reg_no: 'EIS-003', canonical_name: 'Carol Nair' }),  // new
    ]
    const { added, updated, unchanged } = mergeStudents(existing, imported)
    expect(added).toBe(1)
    expect(updated).toBe(1)
    expect(unchanged).toBe(1)
  })
})

// ── mergeStudents — new student ───────────────────────────────

describe('mergeStudents — new student', () => {
  it('assigns the next LWS ID to a new student', () => {
    const { students } = mergeStudents(
      [makeExisting({ lws_id: 'LWS-001' })],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar' })],
    )
    const newStudent = students.find(s => s.eis_reg_no === 'EIS-NEW')
    expect(newStudent.lws_id).toBe('LWS-002')
  })

  it('assigns sequential IDs when multiple new students are imported', () => {
    const { students } = mergeStudents(
      [makeExisting({ lws_id: 'LWS-005' })],
      [
        makeImportRow({ eis_reg_no: 'EIS-NEW-1', canonical_name: 'Bob Kumar' }),
        makeImportRow({ eis_reg_no: 'EIS-NEW-2', canonical_name: 'Carol Nair' }),
      ],
    )
    const ids = students.filter(s => ['EIS-NEW-1', 'EIS-NEW-2'].includes(s.eis_reg_no))
                        .map(s => s.lws_id).sort()
    expect(ids).toEqual(['LWS-006', 'LWS-007'])
  })

  it('initialises attendance, exams, fees, evalbee_roll_nos as empty', () => {
    const { students } = mergeStudents(
      [],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar' })],
    )
    const s = students[0]
    expect(s.attendance).toEqual([])
    expect(s.exams).toEqual([])
    expect(s.fees).toEqual({})
    expect(s.evalbee_roll_nos).toEqual([])
  })

  it('sets name_variants to [canonical_name] for a new student', () => {
    const { students } = mergeStudents(
      [],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar' })],
    )
    expect(students[0].name_variants).toEqual(['Bob Kumar'])
  })

  it('builds match_signatures from name, mobile, eis_reg_no', () => {
    const { students } = mergeStudents(
      [],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar', mobile: '9000000099' })],
    )
    const sig = students[0].match_signatures
    expect(sig).toContain('bob kumar')
    expect(sig).toContain('9000000099')
    expect(sig).toContain('EIS-NEW')
  })
})

// ── mergeStudents — existing student updates ──────────────────

describe('mergeStudents — existing student field updates', () => {
  it('updates mobile when it changes', () => {
    const { students } = mergeStudents(
      [makeExisting({ mobile: '9000000001' })],
      [makeImportRow({ mobile: '9999999999' })],
    )
    expect(students[0].mobile).toBe('9999999999')
  })

  it('updates coming_status when it changes', () => {
    const { students } = mergeStudents(
      [makeExisting({ coming_status: 'Coming' })],
      [makeImportRow({ coming_status: 'Not Coming' })],
    )
    expect(students[0].coming_status).toBe('Not Coming')
  })

  it('updates account_status when it changes', () => {
    const { students } = mergeStudents(
      [makeExisting({ account_status: 'Active' })],
      [makeImportRow({ account_status: 'Inactive' })],
    )
    expect(students[0].account_status).toBe('Inactive')
  })

  it('updates email when it changes', () => {
    const { students } = mergeStudents(
      [makeExisting({ email: 'old@example.com' })],
      [makeImportRow({ email: 'new@example.com' })],
    )
    expect(students[0].email).toBe('new@example.com')
  })

  it('does not overwrite a field with an empty value', () => {
    const { students } = mergeStudents(
      [makeExisting({ mobile: '9000000001' })],
      [makeImportRow({ mobile: '' })],
    )
    expect(students[0].mobile).toBe('9000000001')
  })

  it('preserves attendance, fees, evalbee_roll_nos from existing record', () => {
    const { students } = mergeStudents(
      [makeExisting({ mobile: '9000000001' })],
      [makeImportRow({ mobile: '9999999999' })],
    )
    expect(students[0].attendance).toEqual([{ date: '2026-04-01', status: 'P' }])
    expect(students[0].fees).toEqual({ paid: 10000 })
    expect(students[0].evalbee_roll_nos).toEqual(['001'])
  })
})

// ── mergeStudents — batch merging ─────────────────────────────

describe('mergeStudents — batch merging', () => {
  it('adds a new batch that is not already in the array', () => {
    const { students } = mergeStudents(
      [makeExisting({ batches: ['Batch A'] })],
      [makeImportRow({ batches: ['Batch B'] })],
    )
    expect(students[0].batches).toContain('Batch A')
    expect(students[0].batches).toContain('Batch B')
  })

  it('does not duplicate a batch already in the array', () => {
    const { students } = mergeStudents(
      [makeExisting({ batches: ['Batch A'] })],
      [makeImportRow({ batches: ['Batch A'] })],
    )
    expect(students[0].batches.filter(b => b === 'Batch A')).toHaveLength(1)
  })

  it('keeps existing batches untouched when import row has no batch', () => {
    const { students } = mergeStudents(
      [makeExisting({ batches: ['Batch A'] })],
      [makeImportRow({ batches: [] })],
    )
    expect(students[0].batches).toEqual(['Batch A'])
  })
})

// ── mergeStudents — name variants ─────────────────────────────

describe('mergeStudents — name variant merging', () => {
  it('adds a new name variant if the Excel name differs from stored variants', () => {
    const { students } = mergeStudents(
      [makeExisting({ canonical_name: 'Alice Sharma', name_variants: ['Alice Sharma'] })],
      [makeImportRow({ canonical_name: 'Alice S.' })],
    )
    expect(students[0].name_variants).toContain('Alice S.')
    expect(students[0].name_variants).toContain('Alice Sharma')
  })

  it('does not duplicate a name variant already present', () => {
    const { students } = mergeStudents(
      [makeExisting({ name_variants: ['Alice Sharma', 'Alice S.'] })],
      [makeImportRow({ canonical_name: 'Alice S.' })],
    )
    expect(students[0].name_variants.filter(v => v === 'Alice S.')).toHaveLength(1)
  })
})

// ── mergeStudents — branch ────────────────────────────────────

describe('mergeStudents — branch', () => {
  it('sets branch on a new student from the import row', () => {
    const { students } = mergeStudents(
      [],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar', branch: 'Pune Main' })],
    )
    expect(students[0].branch).toBe('Pune Main')
  })

  it('defaults branch to empty string when import row has no branch', () => {
    const { students } = mergeStudents(
      [],
      [makeImportRow({ eis_reg_no: 'EIS-NEW', canonical_name: 'Bob Kumar' })],
    )
    expect(students[0].branch).toBe('')
  })

  it('updates branch on an existing student when it changes', () => {
    const { students } = mergeStudents(
      [makeExisting({ branch: 'TBU' })],
      [makeImportRow({ branch: 'Kothrud' })],
    )
    expect(students[0].branch).toBe('Kothrud')
  })

  it('counts an existing student as updated when branch changes', () => {
    const { updated } = mergeStudents(
      [makeExisting({ branch: 'TBU' })],
      [makeImportRow({ branch: 'Kothrud' })],
    )
    expect(updated).toBe(1)
  })

  it('does not overwrite branch with an empty value', () => {
    const { students } = mergeStudents(
      [makeExisting({ branch: 'Kothrud' })],
      [makeImportRow({ branch: '' })],
    )
    expect(students[0].branch).toBe('Kothrud')
  })

  it('counts as unchanged when branch is same', () => {
    const { unchanged } = mergeStudents(
      [makeExisting({ branch: 'Kothrud' })],
      [makeImportRow({ branch: 'Kothrud' })],
    )
    expect(unchanged).toBe(1)
  })
})

// ── mergeStudents — immutability ──────────────────────────────

describe('mergeStudents — does not mutate inputs', () => {
  it('does not modify the original existingStudents array', () => {
    const existing = [makeExisting({ mobile: '9000000001' })]
    const original = JSON.stringify(existing)
    mergeStudents(existing, [makeImportRow({ mobile: '9999999999' })])
    expect(JSON.stringify(existing)).toBe(original)
  })
})

// ── parseStudentDate ──────────────────────────────────────────

describe('parseStudentDate', () => {
  it('converts DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(parseStudentDate('20/04/2010')).toBe('2010-04-20')
  })

  it('pads single-digit day and month', () => {
    expect(parseStudentDate('5/3/2009')).toBe('2009-03-05')
  })

  it('returns null for empty / null / undefined', () => {
    expect(parseStudentDate('')).toBeNull()
    expect(parseStudentDate(null)).toBeNull()
    expect(parseStudentDate(undefined)).toBeNull()
  })

  it('passes through an already-ISO date unchanged', () => {
    expect(parseStudentDate('2010-04-20')).toBe('2010-04-20')
  })
})

// ── enrichWithRollNos — helpers ───────────────────────────────

function makeStudent(overrides = {}) {
  return {
    lws_id:           'LWS-001',
    canonical_name:   'Alice Sharma',
    evalbee_roll_nos: [],
    name_variants:    ['Alice Sharma'],
    ...overrides,
  }
}

function makeExamStudent(name, rollNo = '00001') {
  return { name, rollNo }
}

// ── enrichWithRollNos — exact matches ─────────────────────────

describe('enrichWithRollNos — exact match', () => {
  it('adds roll no to evalbee_roll_nos on exact name match', () => {
    const { students } = enrichWithRollNos(
      [makeStudent()],
      [makeExamStudent('Alice Sharma', '00001')],
    )
    expect(students[0].evalbee_roll_nos).toContain('00001')
  })

  it('matches on a known name variant', () => {
    const { students } = enrichWithRollNos(
      [makeStudent({ name_variants: ['Alice Sharma', 'A. Sharma'] })],
      [makeExamStudent('A. Sharma', '00002')],
    )
    expect(students[0].evalbee_roll_nos).toContain('00002')
  })

  it('does not add exam name to name_variants when it equals canonical_name', () => {
    const { students } = enrichWithRollNos(
      [makeStudent()],
      [makeExamStudent('Alice Sharma', '00001')],
    )
    expect(students[0].name_variants.filter(v => v === 'Alice Sharma')).toHaveLength(1)
  })

  it('adds exam name to name_variants when it differs from canonical_name', () => {
    // "Alice Sharmaa" (typo) vs "Alice Sharma" — Jaccard 0.917 >= 0.85, auto-matched as fuzzy
    const { students } = enrichWithRollNos(
      [makeStudent()],
      [makeExamStudent('Alice Sharmaa', '00001')],
    )
    expect(students[0].name_variants).toContain('Alice Sharmaa')
  })

  it('does not duplicate a roll no already in evalbee_roll_nos', () => {
    const { students } = enrichWithRollNos(
      [makeStudent({ evalbee_roll_nos: ['00001'] })],
      [makeExamStudent('Alice Sharma', '00001')],
    )
    expect(students[0].evalbee_roll_nos.filter(r => r === '00001')).toHaveLength(1)
  })

  it('does not duplicate a name variant already present', () => {
    const { students } = enrichWithRollNos(
      [makeStudent({ name_variants: ['Alice Sharma', 'Alice S.'] })],
      [makeExamStudent('Alice S.', '00001')],
    )
    expect(students[0].name_variants.filter(v => v === 'Alice S.')).toHaveLength(1)
  })
})

// ── enrichWithRollNos — counts ────────────────────────────────

describe('enrichWithRollNos — matched / unresolved counts', () => {
  it('places exact match in matched[]', () => {
    const { matched, unresolved } = enrichWithRollNos(
      [makeStudent()],
      [makeExamStudent('Alice Sharma', '00001')],
    )
    expect(matched).toHaveLength(1)
    expect(unresolved).toHaveLength(0)
    expect(matched[0].confidence).toBe('exact')
    expect(matched[0].rollNo).toBe('00001')
    expect(matched[0].lwsId).toBe('LWS-001')
  })

  it('places high-similarity name in matched[] with confidence fuzzy', () => {
    // "Vihaan Batwal" vs "Vihan Batwal" — very close spelling
    const { matched, unresolved } = enrichWithRollNos(
      [makeStudent({ canonical_name: 'Vihan Batwal', name_variants: ['Vihan Batwal'] })],
      [makeExamStudent('Vihaan Batwal', '00007')],
    )
    expect(matched).toHaveLength(1)
    expect(unresolved).toHaveLength(0)
    expect(matched[0].confidence).toBe('fuzzy')
  })

  it('places mid-similarity name in unresolved[] with a candidate', () => {
    // "Priya Patel" vs "Priya Patil" — Jaccard 0.667, between 0.55 and 0.85 → candidate shown
    const { matched, unresolved } = enrichWithRollNos(
      [makeStudent({ canonical_name: 'Priya Patil', name_variants: ['Priya Patil'] })],
      [makeExamStudent('Priya Patel', '00004')],
    )
    expect(matched).toHaveLength(0)
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].examName).toBe('Priya Patel')
    expect(unresolved[0].candidate).toBe('Priya Patil')
    expect(unresolved[0].candidateScore).toBeGreaterThan(0.55)
  })

  it('places completely unknown name in unresolved[] with null candidate', () => {
    const { matched, unresolved } = enrichWithRollNos(
      [makeStudent({ canonical_name: 'Alice Sharma' })],
      [makeExamStudent('Xyz Qwerty', '00099')],
    )
    expect(matched).toHaveLength(0)
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].candidate).toBeNull()
  })

  it('places name below candidate threshold in unresolved[] with null candidate', () => {
    // "Anshuman Goel" vs "Ayushman Goel" — Jaccard 0.533, below 0.55 candidate threshold
    const { matched, unresolved } = enrichWithRollNos(
      [makeStudent({ canonical_name: 'Ayushman Goel', name_variants: ['Ayushman Goel'] })],
      [makeExamStudent('Anshuman Goel', '00004')],
    )
    expect(matched).toHaveLength(0)
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].candidate).toBeNull()
  })

  it('skips exam students with empty name', () => {
    const { matched, unresolved } = enrichWithRollNos(
      [makeStudent()],
      [makeExamStudent('', '00001')],
    )
    expect(matched).toHaveLength(0)
    expect(unresolved).toHaveLength(0)
  })

  it('handles mixed batch: some matched, some unresolved', () => {
    const students = [
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma', name_variants: ['Alice Sharma'] }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar',    name_variants: ['Bob Kumar'] }),
    ]
    const examStudents = [
      makeExamStudent('Alice Sharma', '00001'),   // exact
      makeExamStudent('Xyz Unknown',  '00099'),   // unresolved
    ]
    const { matched, unresolved } = enrichWithRollNos(students, examStudents)
    expect(matched).toHaveLength(1)
    expect(unresolved).toHaveLength(1)
  })
})

// ── enrichWithRollNos — immutability ──────────────────────────

describe('enrichWithRollNos — does not mutate inputs', () => {
  it('does not modify the original students array', () => {
    const students = [makeStudent()]
    const original = JSON.stringify(students)
    enrichWithRollNos(students, [makeExamStudent('Alice Sharma', '00001')])
    expect(JSON.stringify(students)).toBe(original)
  })
})

// ── applyManualMatch ──────────────────────────────────────────

describe('applyManualMatch', () => {
  it('adds roll no to the matched student', () => {
    const result = applyManualMatch(
      [makeStudent()], 'Alice Sharma', 'Alice S.', '00005',
    )
    expect(result[0].evalbee_roll_nos).toContain('00005')
  })

  it('adds exam name as variant when it differs from canonical', () => {
    const result = applyManualMatch(
      [makeStudent()], 'Alice Sharma', 'Alice S.', '00005',
    )
    expect(result[0].name_variants).toContain('Alice S.')
  })

  it('does not add exam name as variant when it equals canonical', () => {
    const result = applyManualMatch(
      [makeStudent()], 'Alice Sharma', 'Alice Sharma', '00005',
    )
    expect(result[0].name_variants.filter(v => v === 'Alice Sharma')).toHaveLength(1)
  })

  it('does not affect students other than the matched one', () => {
    const students = [
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar', evalbee_roll_nos: [] }),
    ]
    const result = applyManualMatch(students, 'Alice Sharma', 'Alice S.', '00005')
    expect(result[1].evalbee_roll_nos).toEqual([])
  })

  it('does not mutate the original students array', () => {
    const students = [makeStudent()]
    const original = JSON.stringify(students)
    applyManualMatch(students, 'Alice Sharma', 'Alice S.', '00005')
    expect(JSON.stringify(students)).toBe(original)
  })
})

// ── findDuplicateCandidates — helpers ─────────────────────────

function makeDedupStudent(overrides = {}) {
  return {
    lws_id:         'LWS-001',
    canonical_name: 'Alice Sharma',
    branch:         'Pune Main',
    mobile:         '9000000001',
    eis_reg_no:     'EIS-001',
    name_variants:  [],
    ...overrides,
  }
}

// ── findDuplicateCandidates — name similarity ─────────────────

describe('findDuplicateCandidates — name similarity', () => {
  it('flags a pair with similar names in the same branch', () => {
    // "Vihaan Batwal" vs "Vihan Batwal" — Jaccard 0.917 ≥ 0.75 threshold
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Vihan Batwal',  branch: 'Pune Main', mobile: '9001' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Vihaan Batwal', branch: 'Pune Main', mobile: '9002' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('name_similar')
    expect(result[0].score).toBeGreaterThanOrEqual(0.75)
  })

  it('DOES flag a pair with similar names in different branches when no branchFilter is set', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Vihan Batwal',  branch: 'Branch A', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Vihaan Batwal', branch: 'Branch B', mobile: '2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('name_similar')
  })

  it('does NOT flag clearly different names', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma', branch: 'Pune Main', mobile: '9001', eis_reg_no: 'EIS-001' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar',    branch: 'Pune Main', mobile: '9002', eis_reg_no: 'EIS-002' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(0)
  })

  it('treats unassigned branch (empty string) as its own group', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Vihan Batwal',  branch: '' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Vihaan Batwal', branch: '' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
  })

  it('sorts results by score descending', () => {
    // "Alice Sharmaa" vs "Alice Sharma" ≈ 0.917; "Alice Sharms" vs "Alice Sharma" ≈ 0.833
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma',  branch: 'X', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Alice Sharmaa', branch: 'X', mobile: '2' }),
      makeDedupStudent({ lws_id: 'LWS-003', canonical_name: 'Alice Sharms',  branch: 'X', mobile: '3' }),
    ]
    const result = findDuplicateCandidates(students)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score)
    }
  })
})

// ── findDuplicateCandidates — other signals ───────────────────

describe('findDuplicateCandidates — same mobile / same EIS', () => {
  it('flags a pair sharing the same mobile number (same branch)', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma', branch: 'B', mobile: '9000000001' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Completely Different Name', branch: 'B', mobile: '9000000001' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('same_mobile')
  })

  it('flags a pair sharing the same eis_reg_no (same branch)', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma',        branch: 'B', eis_reg_no: 'EIS-999' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Completely Different', branch: 'B', eis_reg_no: 'EIS-999' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('same_eis')
  })

  it('does not flag empty mobile numbers as a match', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma',        branch: 'B', mobile: '', eis_reg_no: 'EIS-001' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Completely Different', branch: 'B', mobile: '', eis_reg_no: 'EIS-002' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(0)
  })

  it('accumulates multiple reasons on one pair', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Vihan Batwal',  branch: 'B', mobile: '9000000001', eis_reg_no: 'EIS-001' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Vihaan Batwal', branch: 'B', mobile: '9000000001', eis_reg_no: 'EIS-001' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('name_similar')
    expect(result[0].reasons).toContain('same_mobile')
    expect(result[0].reasons).toContain('same_eis')
  })
})

// ── findDuplicateCandidates — branchFilter option ─────────────

describe('findDuplicateCandidates — branchFilter', () => {
  it('limits scan to the specified branch', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Vihan Batwal',  branch: 'Branch A', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Vihaan Batwal', branch: 'Branch A', mobile: '2' }),
      makeDedupStudent({ lws_id: 'LWS-003', canonical_name: 'Vihan Batwal',  branch: 'Branch B', mobile: '3' }),
      makeDedupStudent({ lws_id: 'LWS-004', canonical_name: 'Vihaan Batwal', branch: 'Branch B', mobile: '4' }),
    ]
    const result = findDuplicateCandidates(students, { branchFilter: 'Branch A' })
    expect(result).toHaveLength(1)
    expect(result[0].studentA.branch).toBe('Branch A')
  })

  it('returns empty when the filtered branch has fewer than 2 students', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', branch: 'Branch A' }),
      makeDedupStudent({ lws_id: 'LWS-002', branch: 'Branch B' }),
    ]
    const result = findDuplicateCandidates(students, { branchFilter: 'Branch A' })
    expect(result).toHaveLength(0)
  })
})

// ── findDuplicateCandidates — name_subset signal ──────────────

describe('findDuplicateCandidates — name_subset signal', () => {
  it('flags same first+last with different middle name (e.g. Nirnit Hemraj Patil vs Nirnit Patil)', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Nirnit Hemraj Patil', branch: 'B', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Nirnit Patil',         branch: 'B', mobile: '2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('name_subset')
  })

  it('flags when all tokens of shorter name appear in longer (order-independent)', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Patil Nirnit',         branch: 'B', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Nirnit Hemraj Patil',  branch: 'B', mobile: '2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('name_subset')
  })

  it('does NOT flag when the shorter name has a token not in the longer name', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Ram Sharma',   branch: 'B', mobile: '1', eis_reg_no: 'E1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Priya Sharma', branch: 'B', mobile: '2', eis_reg_no: 'E2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(0)
  })

  it('does NOT flag single-token names as subset of any longer name', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Sharma',     branch: 'B', mobile: '1', eis_reg_no: 'E1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Ram Sharma', branch: 'B', mobile: '2', eis_reg_no: 'E2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(0)
  })
})

// ── findDuplicateCandidates — cross-branch scan ───────────────

describe('findDuplicateCandidates — cross-branch scan', () => {
  it('flags name_subset pairs across different branches when no branchFilter is set', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Nirnit Hemraj Patil', branch: 'Branch A', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Nirnit Patil',         branch: 'Branch B', mobile: '2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('name_subset')
  })

  it('does NOT flag cross-branch pair when a specific branchFilter is set', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Nirnit Hemraj Patil', branch: 'Branch A', mobile: '1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Nirnit Patil',         branch: 'Branch B', mobile: '2' }),
    ]
    const result = findDuplicateCandidates(students, { branchFilter: 'Branch A' })
    expect(result).toHaveLength(0)
  })

  it('flags same-mobile students across branches when no branchFilter is set', () => {
    const students = [
      makeDedupStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma',        branch: 'Branch A', mobile: '9000000001', eis_reg_no: 'E1' }),
      makeDedupStudent({ lws_id: 'LWS-002', canonical_name: 'Completely Different', branch: 'Branch B', mobile: '9000000001', eis_reg_no: 'E2' }),
    ]
    const result = findDuplicateCandidates(students)
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toContain('same_mobile')
  })
})

// ── mergeStudentRecords — scalar fields ───────────────────────

function makeFullStudent(overrides = {}) {
  return {
    lws_id:           'LWS-001',
    canonical_name:   'Alice Sharma',
    mobile:           '9000000001',
    dob:              '2008-05-10',
    gender:           'Female',
    email:            'alice@example.com',
    eis_reg_no:       'EIS-001',
    registration_date:'2026-01-15',
    branch:           'Pune Main',
    account_status:   'Active',
    coming_status:    'Coming',
    quit_date:        null,
    batches:          ['Batch A'],
    name_variants:    ['Alice Sharma'],
    evalbee_roll_nos: ['R001'],
    match_signatures: ['alice sharma'],
    attendance:       [{ date: '2026-04-01', batch: 'Batch A', status: 'P' }],
    exams:            [{ exam_name: 'NDA Mock 1', exam_date: '2026-04-01', total_marks: 250 }],
    fees:             { paid: 10000, remaining: 5000 },
    ...overrides,
  }
}

describe('mergeStudentRecords — scalar fields', () => {
  it("preserves the primary's canonical_name", () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', canonical_name: 'Alice Sharmaa' })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const merged = result.find(s => s.lws_id === 'LWS-001')
    expect(merged.canonical_name).toBe('Alice Sharma')
  })

  it("preserves the primary's mobile, email and other scalar fields", () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', mobile: '9000000001' })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', mobile: '9999999999' })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    expect(result.find(s => s.lws_id === 'LWS-001').mobile).toBe('9000000001')
  })

  it("preserves the primary's fees", () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', fees: { paid: 10000 } })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', fees: { paid: 99999 } })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    expect(result.find(s => s.lws_id === 'LWS-001').fees).toEqual({ paid: 10000 })
  })
})

// ── mergeStudentRecords — array merging ───────────────────────

describe('mergeStudentRecords — array field merging', () => {
  it("adds secondary's canonical_name to primary's name_variants", () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma', name_variants: ['Alice Sharma'] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', canonical_name: 'Alice Sharmaa', name_variants: ['Alice Sharmaa'] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const merged = result.find(s => s.lws_id === 'LWS-001')
    expect(merged.name_variants).toContain('Alice Sharmaa')
  })

  it('unions name_variants without duplicates', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', name_variants: ['Alice Sharma', 'Alice S.'] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', canonical_name: 'Alice S.', name_variants: ['Alice S.', 'A. Sharma'] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const variants = result.find(s => s.lws_id === 'LWS-001').name_variants
    expect(variants.filter(v => v === 'Alice S.')).toHaveLength(1)
    expect(variants).toContain('A. Sharma')
  })

  it('unions evalbee_roll_nos without duplicates', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', evalbee_roll_nos: ['R001', 'R002'] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', evalbee_roll_nos: ['R002', 'R003'] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const rolls = result.find(s => s.lws_id === 'LWS-001').evalbee_roll_nos
    expect(rolls).toContain('R001')
    expect(rolls).toContain('R002')
    expect(rolls).toContain('R003')
    expect(rolls.filter(r => r === 'R002')).toHaveLength(1)
  })

  it('unions batches without duplicates', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', batches: ['Batch A'] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', batches: ['Batch A', 'Batch B'] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const batches = result.find(s => s.lws_id === 'LWS-001').batches
    expect(batches.filter(b => b === 'Batch A')).toHaveLength(1)
    expect(batches).toContain('Batch B')
  })
})

// ── mergeStudentRecords — attendance merging ──────────────────

describe('mergeStudentRecords — attendance merging', () => {
  it('combines attendance records from both students', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', attendance: [{ date: '2026-04-01', batch: 'A', status: 'P' }] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', attendance: [{ date: '2026-04-02', batch: 'A', status: 'A' }] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const att = result.find(s => s.lws_id === 'LWS-001').attendance
    expect(att).toHaveLength(2)
  })

  it('deduplicates attendance by date+batch, primary wins', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', attendance: [{ date: '2026-04-01', batch: 'A', status: 'P' }] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', attendance: [{ date: '2026-04-01', batch: 'A', status: 'A' }] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const att = result.find(s => s.lws_id === 'LWS-001').attendance
    expect(att).toHaveLength(1)
    expect(att[0].status).toBe('P') // primary wins
  })
})

// ── mergeStudentRecords — exam merging ────────────────────────

describe('mergeStudentRecords — exam merging', () => {
  it('combines exam records from both students', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', exams: [{ exam_name: 'Mock 1', exam_date: '2026-04-01', total_marks: 250 }] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', exams: [{ exam_name: 'Mock 2', exam_date: '2026-04-08', total_marks: 300 }] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const exams = result.find(s => s.lws_id === 'LWS-001').exams
    expect(exams).toHaveLength(2)
  })

  it('deduplicates exams by exam_name+exam_date, primary wins', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001', exams: [{ exam_name: 'Mock 1', exam_date: '2026-04-01', total_marks: 250 }] })
    const secondary = makeFullStudent({ lws_id: 'LWS-002', exams: [{ exam_name: 'Mock 1', exam_date: '2026-04-01', total_marks: 100 }] })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    const exams = result.find(s => s.lws_id === 'LWS-001').exams
    expect(exams).toHaveLength(1)
    expect(exams[0].total_marks).toBe(250) // primary wins
  })
})

// ── mergeStudentRecords — secondary removal ───────────────────

describe('mergeStudentRecords — secondary removal', () => {
  it('removes the secondary student from the array', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001' })
    const secondary = makeFullStudent({ lws_id: 'LWS-002' })
    const result = mergeStudentRecords([primary, secondary], 'LWS-001', 'LWS-002')
    expect(result).toHaveLength(1)
    expect(result.find(s => s.lws_id === 'LWS-002')).toBeUndefined()
  })

  it('leaves other students untouched', () => {
    const primary   = makeFullStudent({ lws_id: 'LWS-001' })
    const secondary = makeFullStudent({ lws_id: 'LWS-002' })
    const other     = makeFullStudent({ lws_id: 'LWS-003', canonical_name: 'Carol Nair' })
    const result = mergeStudentRecords([primary, secondary, other], 'LWS-001', 'LWS-002')
    expect(result).toHaveLength(2)
    expect(result.find(s => s.lws_id === 'LWS-003')).toBeDefined()
  })

  it('returns array unchanged when primary lws_id is not found', () => {
    const students = [makeFullStudent({ lws_id: 'LWS-001' })]
    const result = mergeStudentRecords(students, 'LWS-MISSING', 'LWS-001')
    expect(result).toHaveLength(1)
  })

  it('does not mutate the original students array', () => {
    const students = [
      makeFullStudent({ lws_id: 'LWS-001' }),
      makeFullStudent({ lws_id: 'LWS-002' }),
    ]
    const original = JSON.stringify(students)
    mergeStudentRecords(students, 'LWS-001', 'LWS-002')
    expect(JSON.stringify(students)).toBe(original)
  })
})

// ── getUnmatchedExamNames ─────────────────────────────────────

describe('getUnmatchedExamNames', () => {
  it('returns exam names not present as a key in studentProfiles', () => {
    const exams = [{ students: [{ name: 'Nirnit Patil' }, { name: 'Alice Sharma' }] }]
    const studentProfiles = { 'Alice Sharma': { lwsId: 'LWS-001', name: 'Alice Sharma' } }
    expect(getUnmatchedExamNames(exams, studentProfiles)).toEqual(['Nirnit Patil'])
  })

  it('excludes names already indexed as a name variant (variant key present in studentProfiles)', () => {
    const exams = [{ students: [{ name: 'Nirnit Patil' }] }]
    const studentProfiles = {
      'Nirnit Hemraj Patil': { lwsId: 'LWS-183', name: 'Nirnit Hemraj Patil' },
      'Nirnit Patil':        { lwsId: 'LWS-183', name: 'Nirnit Hemraj Patil' },
    }
    expect(getUnmatchedExamNames(exams, studentProfiles)).toEqual([])
  })

  it('deduplicates exam names that appear across multiple exams', () => {
    const exams = [
      { students: [{ name: 'Unknown Person' }] },
      { students: [{ name: 'Unknown Person' }] },
    ]
    expect(getUnmatchedExamNames(exams, {})).toEqual(['Unknown Person'])
  })

  it('skips students with empty or missing name', () => {
    const exams = [{ students: [{ name: '' }, { name: null }, { name: 'Real Name' }] }]
    expect(getUnmatchedExamNames(exams, {})).toEqual(['Real Name'])
  })

  it('returns empty array when all exam names are matched', () => {
    const exams = [{ students: [{ name: 'Alice Sharma' }] }]
    const studentProfiles = { 'Alice Sharma': { lwsId: 'LWS-001' } }
    expect(getUnmatchedExamNames(exams, studentProfiles)).toEqual([])
  })
})

// ── findExamNameCandidates ────────────────────────────────────

const EXAM_SNAKE_PROFILES = [
  { lws_id: 'LWS-183', canonical_name: 'Nirnit Hemraj Patil', branch: 'APJSCH', mobile: '' },
  { lws_id: 'LWS-001', canonical_name: 'Alice Sharma',         branch: 'Kothrud', mobile: '' },
]

describe('findExamNameCandidates', () => {
  it('catches name_subset: Nirnit Patil vs Nirnit Hemraj Patil', () => {
    const result = findExamNameCandidates(['Nirnit Patil'], EXAM_SNAKE_PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].examName).toBe('Nirnit Patil')
    expect(result[0].profile.lws_id).toBe('LWS-183')
    expect(result[0].reasons).toContain('name_subset')
  })

  it('catches name_similar for a typo (Alice Sharmaa vs Alice Sharma)', () => {
    const result = findExamNameCandidates(['Alice Sharmaa'], EXAM_SNAKE_PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].examName).toBe('Alice Sharmaa')
    expect(result[0].profile.lws_id).toBe('LWS-001')
    expect(result[0].reasons).toContain('name_similar')
  })

  it('does NOT flag completely different names', () => {
    const result = findExamNameCandidates(['Completely Unrelated Name'], EXAM_SNAKE_PROFILES)
    expect(result).toHaveLength(0)
  })

  it('returns multiple pairs when one exam name matches multiple profiles', () => {
    const profiles = [
      { lws_id: 'LWS-001', canonical_name: 'Nirnit Hemraj Patil', branch: '', mobile: '' },
      { lws_id: 'LWS-002', canonical_name: 'Nirnit Kumar Patil',  branch: '', mobile: '' },
    ]
    const result = findExamNameCandidates(['Nirnit Patil'], profiles)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.profile.lws_id)).toContain('LWS-001')
    expect(result.map(r => r.profile.lws_id)).toContain('LWS-002')
  })

  it('sorts results by score descending', () => {
    const result = findExamNameCandidates(['Alice Sharmaa', 'Nirnit Patil'], EXAM_SNAKE_PROFILES)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score)
    }
  })

  it('returns an empty array for an empty unmatched names list', () => {
    expect(findExamNameCandidates([], EXAM_SNAKE_PROFILES)).toEqual([])
  })
})
