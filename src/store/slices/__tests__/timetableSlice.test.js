import { describe, it, expect } from 'vitest'
import { createTimetableSlice } from '../timetableSlice'

function makeStore(initial = {}) {
  let state = {
    timetableTeachers: [],
    timetableMappings: [],
    timetables: [],
    examSchedules: [],
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
  slice = createTimetableSlice(set, get)
  return { get, slice, saves }
}

// ── Teacher CRUD ──────────────────────────────────────────────────────────────
describe('addTimetableTeacher', () => {
  it('adds a teacher and returns id', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetableTeacher('Navneet Sir')
    expect(get().timetableTeachers).toHaveLength(1)
    expect(get().timetableTeachers[0]).toMatchObject({ id, name: 'Navneet Sir' })
  })

  it('trims whitespace', () => {
    const { get, slice } = makeStore()
    slice.addTimetableTeacher('  Vilas Sir  ')
    expect(get().timetableTeachers[0].name).toBe('Vilas Sir')
  })

  it('does not add empty name', () => {
    const { get, slice } = makeStore()
    slice.addTimetableTeacher('   ')
    expect(get().timetableTeachers).toHaveLength(0)
  })

  it('saves', () => {
    const { saves, slice } = makeStore()
    slice.addTimetableTeacher('Sir')
    expect(saves).toHaveLength(1)
  })
})

describe('updateTimetableTeacher', () => {
  it('renames a teacher', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetableTeacher('Old Name')
    slice.updateTimetableTeacher(id, { name: 'New Name' })
    expect(get().timetableTeachers[0].name).toBe('New Name')
  })
})

describe('deleteTimetableTeacher', () => {
  it('removes a teacher', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetableTeacher('Sir')
    slice.deleteTimetableTeacher(id)
    expect(get().timetableTeachers).toHaveLength(0)
  })

  it('clears teacherId on mappings that reference the deleted teacher', () => {
    const { get, slice } = makeStore()
    const tid = slice.addTimetableTeacher('Sir')
    const mid = slice.addTimetableMapping('Maths (Sir)', 'Maths', tid)
    slice.deleteTimetableTeacher(tid)
    const mapping = get().timetableMappings.find(m => m.id === mid)
    expect(mapping.teacherId).toBeNull()
  })
})

// ── Mapping CRUD ──────────────────────────────────────────────────────────────
describe('addTimetableMapping', () => {
  it('adds a mapping and returns id', () => {
    const { get, slice } = makeStore()
    const tid = slice.addTimetableTeacher('Sir')
    const mid = slice.addTimetableMapping('Maths (Sir)', 'Maths', tid)
    expect(get().timetableMappings).toHaveLength(1)
    expect(get().timetableMappings[0]).toMatchObject({ id: mid, label: 'Maths (Sir)', subject: 'Maths', teacherId: tid })
  })

  it('allows null teacherId (break / unassigned)', () => {
    const { get, slice } = makeStore()
    const mid = slice.addTimetableMapping('Lunch Break', null, null)
    expect(get().timetableMappings[0]).toMatchObject({ id: mid, teacherId: null })
  })

  it('does not add empty label', () => {
    const { get, slice } = makeStore()
    slice.addTimetableMapping('  ', 'Maths', null)
    expect(get().timetableMappings).toHaveLength(0)
  })
})

describe('updateTimetableMapping', () => {
  it('patches label and subject', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetableMapping('Old', 'Maths', null)
    slice.updateTimetableMapping(id, { label: 'New', subject: 'Physics' })
    expect(get().timetableMappings[0]).toMatchObject({ label: 'New', subject: 'Physics' })
  })
})

describe('deleteTimetableMapping', () => {
  it('removes the mapping', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetableMapping('Maths', 'Maths', null)
    slice.deleteTimetableMapping(id)
    expect(get().timetableMappings).toHaveLength(0)
  })

  it('clears cells in all timetables that used this mapping', () => {
    const { get, slice } = makeStore()
    const mid = slice.addTimetableMapping('Maths', 'Maths', null)
    const ttId = slice.addTimetable('APJ', '9th Std')
    const slotId = slice.addTimetableSlot(ttId, '9:00 AM', '10:30 AM')
    slice.setTimetableCell(ttId, slotId, 'Monday', 'class', mid)
    slice.deleteTimetableMapping(mid)
    const cell = get().timetables[0].grid[slotId]?.['Monday']
    expect(cell).toBeUndefined()
  })
})

// ── Timetable CRUD ────────────────────────────────────────────────────────────
describe('addTimetable', () => {
  it('adds a timetable with default days and empty grid', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetable('APJ', '9th and 10th Std')
    expect(get().timetables).toHaveLength(1)
    expect(get().timetables[0]).toMatchObject({ id, branch: 'APJ', batchName: '9th and 10th Std' })
    expect(get().timetables[0].timeSlots).toEqual([])
    expect(get().timetables[0].grid).toEqual({})
  })
})

describe('updateTimetable', () => {
  it('patches branch and batchName', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetable('APJ', 'Old')
    slice.updateTimetable(id, { batchName: 'New' })
    expect(get().timetables[0].batchName).toBe('New')
  })
})

describe('renameTimetableBatch', () => {
  it('renames batchName on the matching timetable', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', '12th Std')
    slice.renameTimetableBatch('12th Std', 'APJ_12th_NDA_(2026-27)')
    expect(get().timetables[0].batchName).toBe('APJ_12th_NDA_(2026-27)')
  })

  it('cascades to examSchedules with the same batchName', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', '12th Std')
    slice.addExamSchedule({ ...EXAM_BASE, branch: 'APJ', batchName: '12th Std', teacherId: null })
    slice.addExamSchedule({ ...EXAM_BASE, branch: 'APJ', batchName: '12th Std', teacherId: null })
    slice.renameTimetableBatch('12th Std', 'APJ_12th_NDA_(2026-27)')
    expect(get().examSchedules.every(e => e.batchName === 'APJ_12th_NDA_(2026-27)')).toBe(true)
  })

  it('leaves examSchedules with a different batchName untouched', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', '12th Std')
    slice.addExamSchedule({ ...EXAM_BASE, branch: 'APJ', batchName: '12th Std', teacherId: null })
    slice.addExamSchedule({ ...EXAM_BASE, branch: 'APJ', batchName: '11th Std', teacherId: null })
    slice.renameTimetableBatch('12th Std', 'APJ_12th_NDA_(2026-27)')
    const names = get().examSchedules.map(e => e.batchName).sort()
    expect(names).toEqual(['11th Std', 'APJ_12th_NDA_(2026-27)'])
  })

  it('renames all timetables sharing the same old batchName', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', 'Shared')
    slice.addTimetable('LWS Pune', 'Shared')
    slice.renameTimetableBatch('Shared', 'Renamed')
    expect(get().timetables.every(t => t.batchName === 'Renamed')).toBe(true)
  })

  it('is a no-op when oldName equals newName', () => {
    const { saves, slice } = makeStore()
    slice.addTimetable('APJ', 'Same')
    const before = saves.length
    slice.renameTimetableBatch('Same', 'Same')
    expect(saves.length).toBe(before)
  })

  it('trims newName whitespace', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', 'Old')
    slice.renameTimetableBatch('Old', '  New  ')
    expect(get().timetables[0].batchName).toBe('New')
  })

  it('is a no-op when newName is blank', () => {
    const { get, slice } = makeStore()
    slice.addTimetable('APJ', 'Old')
    slice.renameTimetableBatch('Old', '   ')
    expect(get().timetables[0].batchName).toBe('Old')
  })

  it('is a no-op when no timetable matches oldName', () => {
    const { saves, slice } = makeStore()
    slice.addTimetable('APJ', 'Existing')
    const before = saves.length
    slice.renameTimetableBatch('Missing', 'Something')
    expect(saves.length).toBe(before)
  })

  it('saves once after a successful rename', () => {
    const { saves, slice } = makeStore()
    slice.addTimetable('APJ', 'Old')
    const before = saves.length
    slice.renameTimetableBatch('Old', 'New')
    expect(saves.length).toBe(before + 1)
  })
})

describe('deleteTimetable', () => {
  it('removes the timetable', () => {
    const { get, slice } = makeStore()
    const id = slice.addTimetable('APJ', 'Batch')
    slice.deleteTimetable(id)
    expect(get().timetables).toHaveLength(0)
  })
})

// ── Slot CRUD ─────────────────────────────────────────────────────────────────
describe('addTimetableSlot', () => {
  it('adds a time slot to a timetable', () => {
    const { get, slice } = makeStore()
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '9:00 AM', '10:30 AM')
    expect(get().timetables[0].timeSlots).toHaveLength(1)
    expect(get().timetables[0].timeSlots[0]).toMatchObject({ id: slotId, startTime: '9:00 AM', endTime: '10:30 AM' })
  })
})

describe('deleteTimetableSlot', () => {
  it('removes the slot and its grid row', () => {
    const { get, slice } = makeStore()
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '9:00 AM', '10:30 AM')
    const mid = slice.addTimetableMapping('Maths', 'Maths', null)
    slice.setTimetableCell(ttId, slotId, 'Monday', 'class', mid)
    slice.deleteTimetableSlot(ttId, slotId)
    expect(get().timetables[0].timeSlots).toHaveLength(0)
    expect(get().timetables[0].grid[slotId]).toBeUndefined()
  })
})

// ── Cell mutations ────────────────────────────────────────────────────────────
describe('setTimetableCell', () => {
  it('sets a class cell with mappingId', () => {
    const { get, slice } = makeStore()
    const mid = slice.addTimetableMapping('Maths', 'Maths', null)
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '9:00 AM', '10:30 AM')
    slice.setTimetableCell(ttId, slotId, 'Monday', 'class', mid)
    expect(get().timetables[0].grid[slotId]['Monday']).toEqual({ type: 'class', mappingId: mid })
  })

  it('sets a break cell with label', () => {
    const { get, slice } = makeStore()
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '12:30 PM', '1:15 PM')
    slice.setTimetableCell(ttId, slotId, 'Monday', 'break', null, 'Lunch Break')
    expect(get().timetables[0].grid[slotId]['Monday']).toEqual({ type: 'break', label: 'Lunch Break' })
  })
})

describe('clearTimetableCell', () => {
  it('removes a cell entry', () => {
    const { get, slice } = makeStore()
    const mid = slice.addTimetableMapping('Maths', 'Maths', null)
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '9:00 AM', '10:30 AM')
    slice.setTimetableCell(ttId, slotId, 'Monday', 'class', mid)
    slice.clearTimetableCell(ttId, slotId, 'Monday')
    expect(get().timetables[0].grid[slotId]?.['Monday']).toBeUndefined()
  })
})

// ── Span cells (break rows spanning all days) ─────────────────────────────────
describe('setTimetableSpanCell', () => {
  it('marks a slot as a full-row span with label', () => {
    const { get, slice } = makeStore()
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '12:30 PM', '1:15 PM')
    slice.setTimetableSpanCell(ttId, slotId, 'Lunch Break')
    expect(get().timetables[0].grid[slotId]['__span']).toEqual({ type: 'span', label: 'Lunch Break' })
  })

  it('clearTimetableSpanCell removes span', () => {
    const { get, slice } = makeStore()
    const ttId = slice.addTimetable('APJ', 'Batch')
    const slotId = slice.addTimetableSlot(ttId, '12:30 PM', '1:15 PM')
    slice.setTimetableSpanCell(ttId, slotId, 'Lunch Break')
    slice.clearTimetableSpanCell(ttId, slotId)
    expect(get().timetables[0].grid[slotId]?.['__span']).toBeUndefined()
  })
})

// ── Exam schedule CRUD ────────────────────────────────────────────────────────

const EXAM_BASE = {
  date: '2026-05-11',
  startTime: '9:00 AM',
  endTime: '11:00 AM',
  subject: 'Maths',
  chapter: 'Trigonometry',
  branch: 'LWS Pune',
  batchName: 'NDA Batch A',
  status: 'Planned',
}

function makeStoreWithTeacher() {
  const store = makeStore()
  const tid = store.slice.addTimetableTeacher('Navneet Sir', 'n@example.com')
  return { ...store, tid }
}

describe('addExamSchedule', () => {
  it('adds an exam entry and returns id', () => {
    const { get, slice, tid } = makeStoreWithTeacher()
    const id = slice.addExamSchedule({ ...EXAM_BASE, teacherId: tid })
    expect(get().examSchedules).toHaveLength(1)
    expect(get().examSchedules[0]).toMatchObject({ id, ...EXAM_BASE, teacherId: tid })
  })

  it('allows null teacherId', () => {
    const { get, slice } = makeStore()
    slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    expect(get().examSchedules[0].teacherId).toBeNull()
  })

  it('defaults status to Planned', () => {
    const { get, slice } = makeStore()
    const { status: _s, ...noStatus } = EXAM_BASE
    slice.addExamSchedule({ ...noStatus, teacherId: null })
    expect(get().examSchedules[0].status).toBe('Planned')
  })

  it('saves', () => {
    const { saves, slice } = makeStore()
    slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    expect(saves.length).toBeGreaterThan(0)
  })
})

describe('updateExamSchedule', () => {
  it('patches chapter and status', () => {
    const { get, slice } = makeStore()
    const id = slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    slice.updateExamSchedule(id, { chapter: 'Algebra', status: 'Completed' })
    expect(get().examSchedules[0]).toMatchObject({ chapter: 'Algebra', status: 'Completed' })
  })

  it('does not affect other entries', () => {
    const { get, slice } = makeStore()
    slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    const id2 = slice.addExamSchedule({ ...EXAM_BASE, chapter: 'Algebra', teacherId: null })
    slice.updateExamSchedule(id2, { status: 'Cancelled' })
    expect(get().examSchedules[0].status).toBe('Planned')
    expect(get().examSchedules[1].status).toBe('Cancelled')
  })
})

describe('deleteExamSchedule', () => {
  it('removes the entry', () => {
    const { get, slice } = makeStore()
    const id = slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    slice.deleteExamSchedule(id)
    expect(get().examSchedules).toHaveLength(0)
  })

  it('leaves other entries intact', () => {
    const { get, slice } = makeStore()
    const id1 = slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    slice.addExamSchedule({ ...EXAM_BASE, chapter: 'Algebra', teacherId: null })
    slice.deleteExamSchedule(id1)
    expect(get().examSchedules).toHaveLength(1)
    expect(get().examSchedules[0].chapter).toBe('Algebra')
  })
})

describe('cycleExamStatus', () => {
  it('cycles Planned → Completed', () => {
    const { get, slice } = makeStore()
    const id = slice.addExamSchedule({ ...EXAM_BASE, teacherId: null })
    slice.cycleExamStatus(id)
    expect(get().examSchedules[0].status).toBe('Completed')
  })

  it('cycles Completed → Cancelled', () => {
    const { get, slice } = makeStore()
    const id = slice.addExamSchedule({ ...EXAM_BASE, status: 'Completed', teacherId: null })
    slice.cycleExamStatus(id)
    expect(get().examSchedules[0].status).toBe('Cancelled')
  })

  it('cycles Cancelled → Planned', () => {
    const { get, slice } = makeStore()
    const id = slice.addExamSchedule({ ...EXAM_BASE, status: 'Cancelled', teacherId: null })
    slice.cycleExamStatus(id)
    expect(get().examSchedules[0].status).toBe('Planned')
  })
})

describe('deleteTimetableTeacher cascades to examSchedules', () => {
  it('nulls teacherId on exam entries when teacher is deleted', () => {
    const { get, slice, tid } = makeStoreWithTeacher()
    slice.addExamSchedule({ ...EXAM_BASE, teacherId: tid })
    slice.deleteTimetableTeacher(tid)
    expect(get().examSchedules[0].teacherId).toBeNull()
  })
})
