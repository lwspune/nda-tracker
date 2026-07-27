import { describe, it, expect } from 'vitest'
import { findTeacherByEmail, getTeacherLecturesForDate, withFilingStatus, buildFilingBoard, hasHostelAccess } from '../teacherDay'

// 2026-07-27 is a Monday; 2026-07-26 is a Sunday.
const MONDAY = '2026-07-27'
const SUNDAY = '2026-07-26'

const TEACHERS = [
  { id: 't1', name: 'Akash Rathod Sir', email: 'Akash.Rathod@lwspune.com' },
  { id: 't2', name: 'Vilas Shinde Sir', email: 'vilas@lwspune.com' },
  { id: 't3', name: 'No Login Sir' },                     // timetable-only, no email
]

const MAPPINGS = [
  { id: 'm1', label: 'Maths_12th_NDA', subject: 'Maths',   teacherId: 't1' },
  { id: 'm2', label: 'Physics_12th',   subject: 'Physics', teacherId: 't2' },
  { id: 'm3', label: 'Maths_VS',       subject: 'Maths',   teacherId: 't1' },
  { id: 'm4', label: 'Unassigned',     subject: 'English', teacherId: null },
]

// Two batches. t1 teaches slot A in 12th and slot B in 6M; t2 teaches slot B in 12th.
const TIMETABLES = [
  {
    batchName: '12th',
    timeSlots: [
      { id: 'slot_a', startTime: '9:00 AM',  endTime: '10:00 AM' },
      { id: 'slot_b', startTime: '10:00 AM', endTime: '11:00 AM' },
      { id: 'slot_c', startTime: '11:00 AM', endTime: '12:00 PM' },
    ],
    grid: {
      slot_a: { Monday: { type: 'class', mappingId: 'm1' } },
      slot_b: { Monday: { type: 'class', mappingId: 'm2' } },
      slot_c: { Monday: { type: 'class', mappingId: 'm4' } },   // no teacher assigned
    },
  },
  {
    batchName: '6M',
    timeSlots: [
      { id: 'slot_x', startTime: '2:00 PM', endTime: '3:00 PM' },
    ],
    grid: {
      slot_x: { Monday: { type: 'class', mappingId: 'm3' } },
    },
  },
]

const ARGS = { timetables: TIMETABLES, mappings: MAPPINGS, date: MONDAY }

describe('findTeacherByEmail', () => {
  it('matches case-insensitively (auth emails are lowercased, teacher rows are not)', () => {
    expect(findTeacherByEmail(TEACHERS, 'akash.rathod@lwspune.com')?.id).toBe('t1')
    expect(findTeacherByEmail(TEACHERS, 'AKASH.RATHOD@LWSPUNE.COM')?.id).toBe('t1')
  })

  it('trims surrounding whitespace on both sides of the comparison', () => {
    expect(findTeacherByEmail(TEACHERS, '  vilas@lwspune.com ')?.id).toBe('t2')
  })

  it('returns null for an unknown email, a blank email, or a teacher row with no email', () => {
    expect(findTeacherByEmail(TEACHERS, 'stranger@lwspune.com')).toBeNull()
    expect(findTeacherByEmail(TEACHERS, '')).toBeNull()
    expect(findTeacherByEmail(TEACHERS, null)).toBeNull()
    // 'No Login Sir' has no email — must never match a blank/undefined lookup
    expect(findTeacherByEmail(TEACHERS, undefined)).toBeNull()
  })
})

describe('getTeacherLecturesForDate', () => {
  it("returns only the teacher's own periods, across every batch, sorted by start time", () => {
    const out = getTeacherLecturesForDate({ ...ARGS, teacherId: 't1' })
    expect(out.map(l => [l.batchName, l.slotId])).toEqual([
      ['12th', 'slot_a'],   // 9:00 AM
      ['6M',   'slot_x'],   // 2:00 PM
    ])
  })

  it('carries the fields the capture flow needs (subject, label, times, batch)', () => {
    const [first] = getTeacherLecturesForDate({ ...ARGS, teacherId: 't1' })
    expect(first).toMatchObject({
      batchName: '12th',
      slotId: 'slot_a',
      subject: 'Maths',
      label: 'Maths_12th_NDA',
      startTime: '9:00 AM',
      endTime: '10:00 AM',
      teacherId: 't1',
    })
  })

  it('excludes periods taught by other teachers', () => {
    const out = getTeacherLecturesForDate({ ...ARGS, teacherId: 't2' })
    expect(out.map(l => l.slotId)).toEqual(['slot_b'])
  })

  it('excludes periods whose mapping has no teacher assigned', () => {
    const all = [...TEACHERS.map(t => t.id), null].flatMap(id =>
      getTeacherLecturesForDate({ ...ARGS, teacherId: id })
    )
    expect(all.some(l => l.slotId === 'slot_c')).toBe(false)
  })

  // Load-bearing: an unmatched session email must yield an EMPTY day, never the
  // whole school's timetable. Falling open here would let any teacher file
  // attendance for every batch by accident.
  it('returns [] when teacherId is missing/unknown — never falls open to all lectures', () => {
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: null })).toEqual([])
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: undefined })).toEqual([])
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: '' })).toEqual([])
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: 'ghost' })).toEqual([])
  })

  it('returns [] on Sunday and for an empty/absent timetable set', () => {
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: 't1', date: SUNDAY })).toEqual([])
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: 't1', timetables: [] })).toEqual([])
    expect(getTeacherLecturesForDate({ ...ARGS, teacherId: 't1', timetables: null })).toEqual([])
  })

  it('keeps both entries when a teacher is double-booked at the same time (clash stays visible)', () => {
    const clash = [
      TIMETABLES[0],
      { ...TIMETABLES[1], timeSlots: [{ id: 'slot_x', startTime: '9:00 AM', endTime: '10:00 AM' }] },
    ]
    const out = getTeacherLecturesForDate({ ...ARGS, teacherId: 't1', timetables: clash })
    expect(out).toHaveLength(2)
    expect(out.map(l => l.batchName).sort()).toEqual(['12th', '6M'])
  })
})

describe('withFilingStatus', () => {
  const LECTURES = [
    { batchName: '12th', slotId: 'slot_a', subject: 'Maths' },
    { batchName: '6M',   slotId: 'slot_x', subject: 'Maths' },
  ]

  // The whole point of lecture_submissions: with no submission row, zero absentees
  // is indistinguishable from "the teacher never filed". `filed` is what separates
  // them — it must come from the submission row, never from the absentee count.
  it('marks a lecture filed only when a submission row exists', () => {
    const out = withFilingStatus(LECTURES, [
      { slot_id: 'slot_a', batch_name: '12th', submitted_by: 'akash@lwspune.com', submitted_at: '2026-07-27T04:30:00Z', absent_count: 0 },
    ])
    expect(out[0]).toMatchObject({ filed: true, absentCount: 0, submittedBy: 'akash@lwspune.com' })
    expect(out[1]).toMatchObject({ filed: false })
  })

  it('a filed lecture with zero absentees is NOT the same as an unfiled one', () => {
    const [filedEmpty, unfiled] = withFilingStatus(LECTURES, [
      { slot_id: 'slot_a', batch_name: '12th', absent_count: 0, submitted_at: '2026-07-27T04:30:00Z' },
    ])
    expect(filedEmpty.filed).toBe(true)
    expect(unfiled.filed).toBe(false)
    expect(filedEmpty.absentCount).toBe(0)
    expect(unfiled.absentCount).toBeNull()
  })

  it('matches on (slot_id, batch_name) so two batches sharing a slot id stay independent', () => {
    const shared = [
      { batchName: '12th', slotId: 'slot_1', subject: 'Maths' },
      { batchName: '6M',   slotId: 'slot_1', subject: 'Physics' },
    ]
    const out = withFilingStatus(shared, [
      { slot_id: 'slot_1', batch_name: '6M', absent_count: 3, submitted_at: '2026-07-27T04:30:00Z' },
    ])
    expect(out[0].filed).toBe(false)
    expect(out[1]).toMatchObject({ filed: true, absentCount: 3 })
  })

  it('handles an empty / missing submission list', () => {
    expect(withFilingStatus(LECTURES, []).every(l => l.filed === false)).toBe(true)
    expect(withFilingStatus(LECTURES, null).every(l => l.filed === false)).toBe(true)
    expect(withFilingStatus([], [])).toEqual([])
  })
})

describe('buildFilingBoard', () => {
  const BOARD_ARGS = { timetables: TIMETABLES, mappings: MAPPINGS, teachers: TEACHERS, date: MONDAY }

  it('lists every timetabled period for the day, across batches, with its teacher', () => {
    const { rows } = buildFilingBoard({ ...BOARD_ARGS, submissions: [] })
    expect(rows.map(r => [r.batchName, r.slotId, r.teacherName])).toEqual([
      ['12th', 'slot_a', 'Akash Rathod Sir'],
      ['12th', 'slot_b', 'Vilas Shinde Sir'],
      ['12th', 'slot_c', null],            // mapping has no teacher assigned
      ['6M',   'slot_x', 'Akash Rathod Sir'],
    ])
  })

  // The teacher-facing view drops unassigned periods (nobody owns them). The
  // admin board must NOT — an unowned period is exactly the gap worth seeing,
  // and hiding it makes the day look fully covered.
  it('includes periods whose mapping has no teacher, unlike the teacher view', () => {
    const { rows } = buildFilingBoard({ ...BOARD_ARGS, submissions: [] })
    expect(rows.some(r => r.slotId === 'slot_c' && r.teacherName === null)).toBe(true)
  })

  it('counts filed vs outstanding from submission rows, not absentee counts', () => {
    const board = buildFilingBoard({
      ...BOARD_ARGS,
      submissions: [
        { slot_id: 'slot_a', batch_name: '12th', absent_count: 0, submitted_at: '2026-07-27T04:00:00Z' },
        { slot_id: 'slot_x', batch_name: '6M',   absent_count: 4, submitted_at: '2026-07-27T09:00:00Z' },
      ],
    })
    expect(board.filed).toBe(2)
    expect(board.outstanding).toBe(2)
    expect(board.rows.find(r => r.slotId === 'slot_a').filed).toBe(true)
    expect(board.rows.find(r => r.slotId === 'slot_b').filed).toBe(false)
  })

  it('can be scoped to one batch', () => {
    const { rows, filed, outstanding } = buildFilingBoard({
      ...BOARD_ARGS, submissions: [], batchName: '6M',
    })
    expect(rows.map(r => r.batchName)).toEqual(['6M'])
    expect(filed).toBe(0)
    expect(outstanding).toBe(1)
  })

  it('is empty on Sunday and with no timetables', () => {
    expect(buildFilingBoard({ ...BOARD_ARGS, submissions: [], date: SUNDAY }))
      .toEqual({ rows: [], filed: 0, outstanding: 0 })
    expect(buildFilingBoard({ ...BOARD_ARGS, submissions: [], timetables: [] }))
      .toEqual({ rows: [], filed: 0, outstanding: 0 })
  })
})

// Hostel/mess capture is opened to specific staff by flagging their teacher
// record in Settings, rather than by minting a new auth role. Reusing
// role='teacher' matters: every permission gate in the codebase is written as
// "is this a teacher?", so a new role would inherit ADMIN defaults everywhere.
describe('hasHostelAccess', () => {
  const STAFF = [
    { id: 't1', name: 'Akash Rathod Sir', email: 'akash@lwspune.com', hostelAccess: true },
    { id: 't2', name: 'Vilas Shinde Sir', email: 'vilas@lwspune.com' },                 // flag absent
    { id: 't3', name: 'Warden Sir',       email: 'warden@lwspune.com', hostelAccess: false },
    { id: 't4', name: 'No Email Sir',     hostelAccess: true },                          // no email
  ]

  it('grants access only when the matching record is flagged', () => {
    expect(hasHostelAccess(STAFF, 'akash@lwspune.com')).toBe(true)
    expect(hasHostelAccess(STAFF, 'vilas@lwspune.com')).toBe(false)
    expect(hasHostelAccess(STAFF, 'warden@lwspune.com')).toBe(false)
  })

  it('matches case-insensitively, like the lecture-scoping join', () => {
    expect(hasHostelAccess(STAFF, 'AKASH@LWSPUNE.COM')).toBe(true)
    expect(hasHostelAccess(STAFF, '  akash@lwspune.com  ')).toBe(true)
  })

  // Falls closed on every "we can't identify you" case — a blank lookup must
  // never match the flagged record that happens to have no email.
  it('falls closed for unknown, blank and missing emails', () => {
    expect(hasHostelAccess(STAFF, 'stranger@lwspune.com')).toBe(false)
    expect(hasHostelAccess(STAFF, '')).toBe(false)
    expect(hasHostelAccess(STAFF, null)).toBe(false)
    expect(hasHostelAccess(STAFF, undefined)).toBe(false)
    expect(hasHostelAccess([], 'akash@lwspune.com')).toBe(false)
    expect(hasHostelAccess(null, 'akash@lwspune.com')).toBe(false)
  })

  it('only accepts a real boolean true, not a truthy string', () => {
    expect(hasHostelAccess([{ id: 'x', email: 'a@b.c', hostelAccess: 'no' }], 'a@b.c')).toBe(false)
  })
})
