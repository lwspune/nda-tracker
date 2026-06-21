import { describe, it, expect } from 'vitest'
import { buildIntegrityLeaders } from '../integrityLeaders'

const rows = [
  { id: '1', lws_id: 'L1', student_name: 'Manas', exam_id: 'e1', exam_name: 'Mock A', exam_date: '2026-06-14', counterpart_name: 'Saarth', status: 'admitted', created_at: '2026-06-15T09:00:00Z' },
  { id: '2', lws_id: 'L1', student_name: 'Manas', exam_id: 'e2', exam_name: 'Mock B', exam_date: '2026-06-13', counterpart_name: 'Ganesh', status: 'admitted', created_at: '2026-06-14T09:00:00Z' },
  { id: '3', lws_id: 'L2', student_name: 'Saarth', exam_id: 'e1', exam_name: 'Mock A', exam_date: '2026-06-14', counterpart_name: 'Manas', status: 'admitted', created_at: '2026-06-15T09:00:00Z' },
]

const profiles = {
  'Manas Shirsat': { name: 'Manas Shirsat', lwsId: 'L1', branch: 'APJ', accountStatus: 'Active' },
  // L2 deliberately has no profile → falls back to the row's student_name.
}

describe('buildIntegrityLeaders', () => {
  it('groups by student, counts incidents + distinct exams, ranks repeat-first', () => {
    const out = buildIntegrityLeaders(rows, profiles)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ lwsId: 'L1', incidentCount: 2, examCount: 2 })
    expect(out[1]).toMatchObject({ lwsId: 'L2', incidentCount: 1, examCount: 1 })
  })

  it('prefers the profile canonical name + branch, falls back to the row snapshot', () => {
    const out = buildIntegrityLeaders(rows, profiles)
    const l1 = out.find(s => s.lwsId === 'L1')
    const l2 = out.find(s => s.lwsId === 'L2')
    expect(l1).toMatchObject({ name: 'Manas Shirsat', branch: 'APJ' }) // from profile
    expect(l2).toMatchObject({ name: 'Saarth', branch: '' })           // from row
  })

  it('lists each student’s exams newest-first with counterpart + status', () => {
    const out = buildIntegrityLeaders(rows, profiles)
    const l1 = out.find(s => s.lwsId === 'L1')
    expect(l1.exams.map(e => e.examName)).toEqual(['Mock A', 'Mock B'])
    expect(l1.exams[0]).toMatchObject({ counterpartName: 'Saarth', status: 'admitted' })
  })

  it('counts distinct exams even if a duplicate row for the same exam appears', () => {
    const dup = [...rows, { ...rows[0], id: '4' }] // same lws_id + exam_id
    const out = buildIntegrityLeaders(dup, profiles)
    const l1 = out.find(s => s.lwsId === 'L1')
    expect(l1.incidentCount).toBe(3)  // raw rows
    expect(l1.examCount).toBe(2)      // distinct exams
  })

  it('skips rows with no lws_id and returns [] for empty input', () => {
    expect(buildIntegrityLeaders([{ id: 'x', student_name: 'Nobody' }], profiles)).toEqual([])
    expect(buildIntegrityLeaders([], profiles)).toEqual([])
    expect(buildIntegrityLeaders(null)).toEqual([])
  })
})
