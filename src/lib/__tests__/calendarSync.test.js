import { describe, it, expect } from 'vitest'
import {
  buildTeacherBlocks,
  diffBlocks,
  blockSignature,
  toGCalEvent,
  nextDateForWeekday,
} from '../calendarSync'

const TEACHERS = [
  { id: 't1', name: 'Navneet Sir', email: 'navneet@example.com' },
  { id: 't2', name: 'Sameer Sir', email: 'sameer@example.com' },
  { id: 't3', name: 'No Email Sir', email: '' },
]
const MAPPINGS = [
  { id: 'm-phy', label: 'Physics', subject: 'Physics', teacherId: 't1' },
  { id: 'm-chem', label: 'Chemistry', subject: 'Chemistry', teacherId: 't2' },
  { id: 'm-none', label: 'Mystery', subject: 'X', teacherId: 't3' },
  { id: 'm-unassigned', label: 'Unassigned', subject: 'Y', teacherId: null },
]
function tt(id, branch, batchName, grid) {
  return {
    id, branch, batchName,
    timeSlots: [
      { id: 's1', startTime: '9:30 AM', endTime: '10:50 AM' },
      { id: 's2', startTime: '1:45 PM', endTime: '2:50PM' }, // note: no space before PM (real data has this)
    ],
    grid,
  }
}

describe('buildTeacherBlocks', () => {
  it('emits one block per (teacher, timetable, slot, day) class cell', () => {
    const t = tt('ttA', 'APJ', '11A', {
      s1: { Monday: { type: 'class', mappingId: 'm-phy' }, Tuesday: { type: 'class', mappingId: 'm-chem' } },
    })
    const blocks = buildTeacherBlocks([t], MAPPINGS, TEACHERS)
    expect(blocks).toHaveLength(2)
    const phy = blocks.find(b => b.teacherId === 't1')
    expect(phy).toMatchObject({
      blockKey: 't1|ttA|s1|Monday',
      teacherEmail: 'navneet@example.com',
      day: 'Monday', startTime: '9:30 AM', endTime: '10:50 AM',
      label: 'Physics', batchName: '11A', branch: 'APJ',
    })
    expect(typeof phy.signature).toBe('string')
  })

  it('skips breaks, __span rows, unassigned mappings, and teachers without email', () => {
    const t = tt('ttA', 'APJ', '11A', {
      s1: {
        __span: { type: 'span', label: 'Lunch' },
        Monday: { type: 'class', mappingId: 'm-phy' },
      },
      s2: {
        Monday: { type: 'break', label: 'Tea' },
        Tuesday: { type: 'class', mappingId: 'm-none' },       // teacher has no email -> skip
        Wednesday: { type: 'class', mappingId: 'm-unassigned' }, // no teacher -> skip
        Thursday: { type: 'class', mappingId: 'm-missing' },     // mapping doesn't exist -> skip
      },
    })
    const blocks = buildTeacherBlocks([t], MAPPINGS, TEACHERS)
    // only the s1 __span row is skipped entirely, so Monday/s1 Physics is gone too
    expect(blocks).toEqual([])
  })

  it('a teacher swap on a cell changes the blockKey set (old released, new added)', () => {
    const before = buildTeacherBlocks(
      [tt('ttA', 'APJ', '11A', { s1: { Monday: { type: 'class', mappingId: 'm-phy' } } })],
      MAPPINGS, TEACHERS
    )
    const after = buildTeacherBlocks(
      [tt('ttA', 'APJ', '11A', { s1: { Monday: { type: 'class', mappingId: 'm-chem' } } })],
      MAPPINGS, TEACHERS
    )
    expect(before[0].blockKey).toBe('t1|ttA|s1|Monday')
    expect(after[0].blockKey).toBe('t2|ttA|s1|Monday')
    expect(before[0].blockKey).not.toBe(after[0].blockKey)
  })

  it('is deterministic / stable in order', () => {
    const t = tt('ttA', 'APJ', '11A', {
      s1: { Tuesday: { type: 'class', mappingId: 'm-chem' }, Monday: { type: 'class', mappingId: 'm-phy' } },
    })
    const a = buildTeacherBlocks([t], MAPPINGS, TEACHERS).map(b => b.blockKey)
    const b = buildTeacherBlocks([t], MAPPINGS, TEACHERS).map(b => b.blockKey)
    expect(a).toEqual(b)
  })
})

describe('blockSignature', () => {
  it('changes when content changes, stable otherwise', () => {
    const base = { startTime: '9:30 AM', endTime: '10:50 AM', label: 'Physics', batchName: '11A', branch: 'APJ', teacherEmail: 'n@x.com' }
    const s1 = blockSignature(base)
    expect(blockSignature({ ...base })).toBe(s1)
    expect(blockSignature({ ...base, label: 'Physics PYQs' })).not.toBe(s1)
    expect(blockSignature({ ...base, endTime: '11:00 AM' })).not.toBe(s1)
    expect(blockSignature({ ...base, teacherEmail: 'other@x.com' })).not.toBe(s1)
  })
})

describe('diffBlocks', () => {
  const mk = (key, sig) => ({ blockKey: key, signature: sig })
  it('classifies create / update / delete by blockKey + signature', () => {
    const desired = [mk('a', 's1'), mk('b', 's2new'), mk('c', 's3')]
    const ledger = [
      { block_key: 'b', signature: 's2old', event_id: 'eB' }, // changed -> update
      { block_key: 'c', signature: 's3', event_id: 'eC' },     // same -> noop
      { block_key: 'd', signature: 's4', event_id: 'eD' },     // gone -> delete
    ]
    const { toCreate, toUpdate, toDelete } = diffBlocks(desired, ledger)
    expect(toCreate.map(b => b.blockKey)).toEqual(['a'])
    expect(toUpdate.map(b => b.blockKey)).toEqual(['b'])
    expect(toUpdate[0].eventId).toBe('eB')           // carries the existing event id to patch
    expect(toDelete.map(d => d.blockKey)).toEqual(['d'])
    expect(toDelete[0].eventId).toBe('eD')
  })

  it('empty desired deletes everything in the ledger', () => {
    const ledger = [{ block_key: 'x', signature: 's', event_id: 'e1' }]
    const { toCreate, toUpdate, toDelete } = diffBlocks([], ledger)
    expect(toCreate).toEqual([])
    expect(toUpdate).toEqual([])
    expect(toDelete.map(d => d.blockKey)).toEqual(['x'])
  })

  it('empty ledger creates everything', () => {
    const desired = [mk('a', 's1'), mk('b', 's2')]
    const { toCreate, toDelete } = diffBlocks(desired, [])
    expect(toCreate.map(b => b.blockKey)).toEqual(['a', 'b'])
    expect(toDelete).toEqual([])
  })
})

describe('nextDateForWeekday', () => {
  it('returns the first occurrence of the weekday on/after the reference date', () => {
    // 2026-06-10 is a Wednesday
    expect(nextDateForWeekday('Wednesday', '2026-06-10')).toBe('2026-06-10') // same day
    expect(nextDateForWeekday('Thursday', '2026-06-10')).toBe('2026-06-11')
    expect(nextDateForWeekday('Monday', '2026-06-10')).toBe('2026-06-15')    // next week
    expect(nextDateForWeekday('Saturday', '2026-06-10')).toBe('2026-06-13')
  })
})

describe('toGCalEvent', () => {
  const block = {
    blockKey: 't1|ttA|s1|Monday', teacherId: 't1', teacherEmail: 'navneet@example.com',
    day: 'Monday', startTime: '9:30 AM', endTime: '10:50 AM',
    label: 'Physics', subject: 'Physics', batchName: '11A', branch: 'APJ',
    signature: 'sig123',
  }
  it('builds a weekly recurring event with the teacher as attendee, busy + tagged', () => {
    const ev = toGCalEvent(block, '2026-06-10')
    expect(ev.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO'])
    expect(ev.attendees).toEqual([{ email: 'navneet@example.com' }])
    expect(ev.transparency).toBe('opaque')
    expect(ev.start).toEqual({ dateTime: '2026-06-15T09:30:00', timeZone: 'Asia/Kolkata' })
    expect(ev.end).toEqual({ dateTime: '2026-06-15T10:50:00', timeZone: 'Asia/Kolkata' })
    expect(ev.location).toBe('APJ')
    expect(ev.summary).toContain('Physics')
    expect(ev.extendedProperties.private).toMatchObject({ blockKey: 't1|ttA|s1|Monday', signature: 'sig123' })
  })

  it('parses afternoon PM times with no space (real data quirk)', () => {
    const ev = toGCalEvent({ ...block, day: 'Tuesday', startTime: '1:45 PM', endTime: '2:50PM' }, '2026-06-10')
    expect(ev.start.dateTime).toBe('2026-06-16T13:45:00')
    expect(ev.end.dateTime).toBe('2026-06-16T14:50:00')
  })
})
