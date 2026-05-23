import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createConfigSlice } from '../configSlice'
import { createTimetableSlice } from '../timetableSlice'
import { createSyllabusSlice } from '../syllabusSlice'

// Spy on the Supabase cascade — the in-memory JSONB renames are tested
// directly; the Supabase cascade is fire-and-forget and just verifies the
// helper is called with the right args.
const mockCascade = vi.fn().mockResolvedValue({ studentBatchRows: 0, examRows: 0 })
vi.mock('../batchSupabase', () => ({
  cascadeBatchRenameToSupabase: (...args) => mockCascade(...args),
}))
beforeEach(() => mockCascade.mockClear())

// Compose configSlice with the syllabus + timetable slices so the cascade
// behaviour (renameBatch / deleteBatch / renameBranch) can be exercised
// against a realistic store, not a mock.
function makeStore(initial = {}) {
  let state = {
    branches: [],
    timetables: [],
    examSchedules: [],
    syllabusBatches: [],
    syllabusBatchBranches: {},
    batchProgramAssignments: {},
    batchSyllabusProgress: {},
    batchChapterTimelines: {},
    timetableTeachers: [],
    timetableMappings: [],
    syllabusPrograms: [],
    ...initial,
  }
  const saves = []
  let slice
  const get = () => ({
    ...state,
    _save: () => saves.push('save'),
    ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')),
  })
  const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = {
    ...createTimetableSlice(set, get),
    ...createSyllabusSlice(set, get),
    ...createConfigSlice(set, get),
  }
  return { get, slice, saves, state: () => state }
}

// ── Branch CRUD ──────────────────────────────────────────────────────────────
describe('addBranch', () => {
  it('adds a branch', () => {
    const { get, slice } = makeStore()
    slice.addBranch('APJ')
    expect(get().branches).toEqual(['APJ'])
  })

  it('trims whitespace', () => {
    const { get, slice } = makeStore()
    slice.addBranch('  LWS Pune  ')
    expect(get().branches).toEqual(['LWS Pune'])
  })

  it('ignores empty', () => {
    const { get, slice } = makeStore()
    slice.addBranch('   ')
    expect(get().branches).toEqual([])
  })

  it('ignores duplicates', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    slice.addBranch('APJ')
    expect(get().branches).toEqual(['APJ'])
  })

  it('saves on add', () => {
    const { saves, slice } = makeStore()
    slice.addBranch('APJ')
    expect(saves).toHaveLength(1)
  })
})

describe('renameBranch', () => {
  it('renames the branch in branches[]', () => {
    const { get, slice } = makeStore({ branches: ['LWS Pune'] })
    slice.renameBranch('LWS Pune', 'LWS')
    expect(get().branches).toEqual(['LWS'])
  })

  it('cascades to timetables[].branch', () => {
    const { get, slice } = makeStore({ branches: ['LWS Pune'] })
    slice.addTimetable('LWS Pune', 'Batch A')
    slice.addTimetable('LWS Pune', 'Batch B')
    slice.addTimetable('APJ', 'Other')
    slice.renameBranch('LWS Pune', 'LWS')
    expect(get().timetables.map(t => t.branch)).toEqual(['LWS', 'LWS', 'APJ'])
  })

  it('cascades to examSchedules[].branch', () => {
    const { get, slice } = makeStore({ branches: ['LWS Pune'] })
    slice.addExamSchedule({ date: '2026-06-01', startTime: '9:00 AM', endTime: '11:00 AM', subject: 'Maths', chapter: 'Sets', branch: 'LWS Pune', batchName: 'Batch A', teacherId: null })
    slice.renameBranch('LWS Pune', 'LWS')
    expect(get().examSchedules[0].branch).toBe('LWS')
  })

  it('cascades to syllabusBatchBranches values', () => {
    const { get, slice } = makeStore({
      branches: ['LWS Pune'],
      syllabusBatchBranches: { 'LWS_NDA_2Y_(25-27)_A': 'LWS Pune', 'APJ_10th_Std': 'APJ' },
    })
    slice.renameBranch('LWS Pune', 'LWS')
    expect(get().syllabusBatchBranches).toEqual({ 'LWS_NDA_2Y_(25-27)_A': 'LWS', 'APJ_10th_Std': 'APJ' })
  })

  it('no-op when oldName not in branches[]', () => {
    const { saves, slice } = makeStore({ branches: ['APJ'] })
    const before = saves.length
    slice.renameBranch('Missing', 'New')
    expect(saves.length).toBe(before)
  })

  it('no-op when newName already exists', () => {
    const { get, slice } = makeStore({ branches: ['APJ', 'LWS'] })
    slice.renameBranch('APJ', 'LWS')
    expect(get().branches).toEqual(['APJ', 'LWS'])
  })

  it('no-op when oldName equals newName', () => {
    const { saves, slice } = makeStore({ branches: ['APJ'] })
    const before = saves.length
    slice.renameBranch('APJ', 'APJ')
    expect(saves.length).toBe(before)
  })

  it('trims newName whitespace', () => {
    const { get, slice } = makeStore({ branches: ['Old'] })
    slice.renameBranch('Old', '  New  ')
    expect(get().branches).toEqual(['New'])
  })
})

describe('branchInUseBy', () => {
  it('counts references across timetables, examSchedules, syllabusBatchBranches', () => {
    const { slice } = makeStore({
      branches: ['LWS'],
      syllabusBatchBranches: { 'B1': 'LWS', 'B2': 'LWS', 'B3': 'APJ' },
    })
    slice.addTimetable('LWS', 'X')
    slice.addExamSchedule({ date: '2026-06-01', startTime: '9:00 AM', endTime: '11:00 AM', subject: 'Maths', chapter: 'Sets', branch: 'LWS', batchName: 'X', teacherId: null })
    expect(slice.branchInUseBy('LWS')).toEqual({ timetables: 1, examSchedules: 1, syllabusBatches: ['B1', 'B2'] })
  })

  it('returns zero counts when unused', () => {
    const { slice } = makeStore({ branches: ['Unused'] })
    expect(slice.branchInUseBy('Unused')).toEqual({ timetables: 0, examSchedules: 0, syllabusBatches: [] })
  })
})

describe('deleteBranch', () => {
  it('blocks deletion when used by a timetable', () => {
    const { get, slice } = makeStore({ branches: ['LWS'] })
    slice.addTimetable('LWS', 'X')
    const result = slice.deleteBranch('LWS')
    expect(result.ok).toBe(false)
    expect(result.usage.timetables).toBe(1)
    expect(get().branches).toEqual(['LWS'])
  })

  it('blocks deletion when used by an exam schedule', () => {
    const { slice } = makeStore({ branches: ['LWS'] })
    slice.addExamSchedule({ date: '2026-06-01', startTime: '9:00 AM', endTime: '11:00 AM', subject: 'Maths', chapter: 'Sets', branch: 'LWS', batchName: 'X', teacherId: null })
    const result = slice.deleteBranch('LWS')
    expect(result.ok).toBe(false)
    expect(result.usage.examSchedules).toBe(1)
  })

  it('blocks deletion when referenced by syllabusBatchBranches', () => {
    const { slice } = makeStore({ branches: ['LWS'], syllabusBatchBranches: { 'B1': 'LWS' } })
    const result = slice.deleteBranch('LWS')
    expect(result.ok).toBe(false)
    expect(result.usage.syllabusBatches).toEqual(['B1'])
  })

  it('removes branch when unused', () => {
    const { get, slice } = makeStore({ branches: ['Unused', 'Active'] })
    const result = slice.deleteBranch('Unused')
    expect(result.ok).toBe(true)
    expect(get().branches).toEqual(['Active'])
  })

  it('saves on successful delete', () => {
    const { saves, slice } = makeStore({ branches: ['Unused'] })
    const before = saves.length
    slice.deleteBranch('Unused')
    expect(saves.length).toBe(before + 1)
  })
})

// ── Unified batch CRUD ───────────────────────────────────────────────────────
describe('addBatch', () => {
  it('creates syllabus entry + branch mapping in one call', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    const result = slice.addBatch('APJ_12th', 'APJ')
    expect(result.ok).toBe(true)
    expect(get().syllabusBatches).toEqual(['APJ_12th'])
    expect(get().syllabusBatchBranches).toEqual({ 'APJ_12th': 'APJ' })
  })

  it('rejects empty name', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    const result = slice.addBatch('   ', 'APJ')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('name_required')
    expect(get().syllabusBatches).toEqual([])
  })

  it('rejects empty branch', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    const result = slice.addBatch('X', '')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('branch_required')
    expect(get().syllabusBatches).toEqual([])
  })

  it('rejects branch not in branches[]', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    const result = slice.addBatch('X', 'MissingBranch')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unknown_branch')
    expect(get().syllabusBatches).toEqual([])
  })

  it('rejects duplicate name (already in syllabusBatches)', () => {
    const { get, slice } = makeStore({ branches: ['APJ'], syllabusBatches: ['X'] })
    const result = slice.addBatch('X', 'APJ')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('duplicate_name')
    expect(get().syllabusBatches).toEqual(['X'])
  })

  it('rejects duplicate name (already a timetable batchName)', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    slice.addTimetable('APJ', 'X')
    const result = slice.addBatch('X', 'APJ')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('duplicate_name')
    expect(get().syllabusBatches).toEqual([])
  })

  it('trims whitespace', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    slice.addBatch('  Y  ', 'APJ')
    expect(get().syllabusBatches).toEqual(['Y'])
    expect(get().syllabusBatchBranches['Y']).toBe('APJ')
  })

  it('rejects name containing a comma (comma is the exam.batch separator)', () => {
    const { get, slice } = makeStore({ branches: ['APJ'] })
    const result = slice.addBatch('Foo, Bar', 'APJ')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('comma_in_name')
    expect(get().syllabusBatches).toEqual([])
  })

  it('rejects name with comma even when other validations would pass', () => {
    const { slice } = makeStore({ branches: ['APJ'] })
    expect(slice.addBatch('A,B', 'APJ').reason).toBe('comma_in_name')
    expect(slice.addBatch(' ,X', 'APJ').reason).toBe('comma_in_name')
  })
})

describe('renameBatch', () => {
  it('renames in both syllabusBatches[] and timetables[].batchName', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('OldName')
    slice.addTimetable('APJ', 'OldName')
    slice.renameBatch('OldName', 'NewName')
    expect(get().syllabusBatches).toEqual(['NewName'])
    expect(get().timetables[0].batchName).toBe('NewName')
  })

  it('cascades through syllabus assignments + progress + branch + timelines', () => {
    const { get, slice } = makeStore({
      syllabusBatches: ['OldName'],
      batchProgramAssignments: { 'OldName': ['prog_1'] },
      batchSyllabusProgress:   { 'OldName': { 'prog_1': {} } },
      syllabusBatchBranches:   { 'OldName': 'APJ' },
      batchChapterTimelines:   { 'OldName': { 'prog_1': {} } },
    })
    slice.renameBatch('OldName', 'NewName')
    expect(get().batchProgramAssignments).toEqual({ 'NewName': ['prog_1'] })
    expect(get().batchSyllabusProgress).toEqual({ 'NewName': { 'prog_1': {} } })
    expect(get().syllabusBatchBranches).toEqual({ 'NewName': 'APJ' })
    expect(get().batchChapterTimelines).toEqual({ 'NewName': { 'prog_1': {} } })
  })

  it('cascades to examSchedules[].batchName', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', 'OldName')
    slice.addExamSchedule({ date: '2026-06-01', startTime: '9:00 AM', endTime: '11:00 AM', subject: 'Maths', chapter: 'Sets', branch: 'APJ', batchName: 'OldName', teacherId: null })
    slice.renameBatch('OldName', 'NewName')
    expect(get().examSchedules[0].batchName).toBe('NewName')
  })

  it('works when batch exists only in syllabus (no timetable yet)', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('SyllabusOnly')
    slice.renameBatch('SyllabusOnly', 'Renamed')
    expect(get().syllabusBatches).toEqual(['Renamed'])
  })

  it('works when batch exists only in timetables (no syllabus entry)', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', 'TimetableOnly')
    slice.renameBatch('TimetableOnly', 'Renamed')
    expect(get().timetables[0].batchName).toBe('Renamed')
  })

  it('fires the Supabase cascade (student_batches + exams.batch) with old + new names', () => {
    const { slice } = makeStore()
    slice.addSyllabusBatch('OldName')
    slice.renameBatch('OldName', 'NewName')
    expect(mockCascade).toHaveBeenCalledWith(expect.anything(), 'OldName', 'NewName')
  })

  it('does NOT fire the cascade for a no-op rename (oldName equals newName)', () => {
    const { slice } = makeStore()
    slice.addSyllabusBatch('Same')
    slice.renameBatch('Same', 'Same')
    expect(mockCascade).not.toHaveBeenCalled()
  })

  it('does NOT fire the cascade when the rename is rejected (newName already exists)', () => {
    const { slice } = makeStore()
    slice.addSyllabusBatch('A')
    slice.addSyllabusBatch('B')
    slice.renameBatch('A', 'B')   // both already in syllabusBatches → rename is rejected
    expect(mockCascade).not.toHaveBeenCalled()
  })
})

describe('batchInUseBy', () => {
  it('reports usage across both sides', () => {
    const { slice } = makeStore()
    slice.addSyllabusBatch('X')
    slice.addTimetable('APJ', 'X')
    slice.addExamSchedule({ date: '2026-06-01', startTime: '9:00 AM', endTime: '11:00 AM', subject: 'Maths', chapter: 'Sets', branch: 'APJ', batchName: 'X', teacherId: null })
    expect(slice.batchInUseBy('X')).toEqual({ inSyllabus: true, timetableCount: 1, examScheduleCount: 1 })
  })
})

describe('deleteBatch', () => {
  it('blocks deletion when a timetable still exists for the batch', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('X')
    slice.addTimetable('APJ', 'X')
    const result = slice.deleteBatch('X')
    expect(result.ok).toBe(false)
    expect(get().syllabusBatches).toEqual(['X'])
    expect(get().timetables).toHaveLength(1)
  })

  it('blocks deletion when an exam schedule references the batch', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('X')
    slice.addExamSchedule({ date: '2026-06-01', startTime: '9:00 AM', endTime: '11:00 AM', subject: 'Maths', chapter: 'Sets', branch: 'APJ', batchName: 'X', teacherId: null })
    const result = slice.deleteBatch('X')
    expect(result.ok).toBe(false)
    expect(get().syllabusBatches).toEqual(['X'])
  })

  it('deletes from syllabus when no timetable/exam references exist', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('SyllabusOnly')
    const result = slice.deleteBatch('SyllabusOnly')
    expect(result.ok).toBe(true)
    expect(get().syllabusBatches).toEqual([])
  })
})
