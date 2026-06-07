import { describe, it, expect } from 'vitest'
import { buildAttendanceLeaders } from '../attendanceLeaders'

// studentProfiles is keyed by canonical name AND every variant; 'Ali' is a
// variant key pointing at Alice's profile (name !== key) and must be skipped.
const profiles = {
  Alice: { lwsId: 'L1', name: 'Alice', branch: 'APJ',      accountStatus: 'Active' },
  Bob:   { lwsId: 'L2', name: 'Bob',   branch: 'APJ',      accountStatus: 'Active' },
  Carol: { lwsId: 'L3', name: 'Carol', branch: 'LWS Pune', accountStatus: 'Active' },
  Dave:  { lwsId: 'L4', name: 'Dave',  branch: 'APJ',      accountStatus: 'Block'  }, // excluded
  Ali:   { lwsId: 'L1', name: 'Alice', branch: 'APJ',      accountStatus: 'Active' }, // variant key
}

const attendanceRows = [
  { lws_id: 'L1', status: 'A' }, { lws_id: 'L1', status: 'A' }, { lws_id: 'L1', status: 'A' }, // Alice 3 A
  { lws_id: 'L2', status: 'A' },                                                               // Bob 1 A
  { lws_id: 'L4', status: 'A' },                                                               // Dave (Block) — excluded
  { lws_id: 'L3', status: 'P' },                                                               // present — ignored
  { lws_id: 'L1', status: 'L' },                                                               // Alice 1 late
  { lws_id: 'L2', status: 'L' }, { lws_id: 'L2', status: 'L' },                                // Bob 2 late
]
const lectureRows  = [{ lws_id: 'L3' }, { lws_id: 'L3' }, { lws_id: 'L1' }] // Carol 2, Alice 1
const homeworkRows = [{ lws_id: 'L2' }]                                     // Bob 1

describe('buildAttendanceLeaders', () => {
  const leaders = buildAttendanceLeaders({ attendanceRows, lectureRows, homeworkRows, studentProfiles: profiles })

  it('ranks absentees (status A) by count desc, excluding non-Active students', () => {
    expect(leaders.absentees.map(r => [r.name, r.count])).toEqual([['Alice', 3], ['Bob', 1]])
    // Dave is Block → excluded despite an A row
    expect(leaders.absentees.some(r => r.name === 'Dave')).toBe(false)
  })

  it('counts late (status L) separately from absences', () => {
    expect(leaders.late.map(r => [r.name, r.count])).toEqual([['Bob', 2], ['Alice', 1]])
  })

  it('counts lecture misses per student', () => {
    expect(leaders.lectureMiss.map(r => [r.name, r.count])).toEqual([['Carol', 2], ['Alice', 1]])
  })

  it('counts homework/notes misses per student', () => {
    expect(leaders.homeworkMiss.map(r => [r.name, r.count])).toEqual([['Bob', 1]])
  })

  it('carries name + branch + lwsId on each leader row', () => {
    expect(leaders.absentees[0]).toMatchObject({ lwsId: 'L1', name: 'Alice', branch: 'APJ', count: 3 })
  })

  it('does not double-count a student via a variant-keyed profile entry', () => {
    expect(leaders.absentees.filter(r => r.lwsId === 'L1')).toHaveLength(1)
  })

  it('respects topN', () => {
    const top1 = buildAttendanceLeaders({ attendanceRows, lectureRows, homeworkRows, studentProfiles: profiles, topN: 1 })
    expect(top1.absentees).toHaveLength(1)
    expect(top1.absentees[0].name).toBe('Alice')
  })

  it('breaks ties by name ascending', () => {
    const tied = buildAttendanceLeaders({
      attendanceRows: [{ lws_id: 'L2', status: 'A' }, { lws_id: 'L3', status: 'A' }],
      lectureRows: [], homeworkRows: [], studentProfiles: profiles,
    })
    expect(tied.absentees.map(r => r.name)).toEqual(['Bob', 'Carol']) // both count 1 → alphabetical
  })

  it('returns empty arrays for empty inputs', () => {
    const empty = buildAttendanceLeaders({ attendanceRows: [], lectureRows: [], homeworkRows: [], studentProfiles: profiles })
    expect(empty).toEqual({ absentees: [], late: [], homeworkMiss: [], lectureMiss: [] })
  })
})
