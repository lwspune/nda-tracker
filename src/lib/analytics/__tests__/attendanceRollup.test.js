import { describe, it, expect } from 'vitest'
import { buildAttendanceRollup } from '../attendanceRollup'

// Branch grouping comes from syllabusBatchBranches (batch → branch).
const BRANCHES = {
  'LWS_A': 'LWS Pune',
  'LWS_B': 'LWS Pune',
  'APJ_1': 'APJ',
}

// Profiles keyed by canonical name AND every variant (variant-keyed entries
// must be skipped — same guard as getExamAbsentees).
const PROFILES = {
  Alice:   { name: 'Alice',   lwsId: 'L1', branch: 'LWS Pune', batches: ['LWS_A'], gender: 'Female', accountStatus: 'Active', nameVariants: ['Ali'] },
  Ali:     { name: 'Alice',   lwsId: 'L1', branch: 'LWS Pune', batches: ['LWS_A'], gender: 'Female', accountStatus: 'Active', nameVariants: ['Ali'] }, // variant key → skipped
  Bob:     { name: 'Bob',     lwsId: 'L2', branch: 'LWS Pune', batches: ['LWS_A'], gender: 'Male',   accountStatus: 'Active', nameVariants: [] },
  Carol:   { name: 'Carol',   lwsId: 'L3', branch: 'LWS Pune', batches: ['LWS_B'], gender: 'Female', accountStatus: 'Active', nameVariants: [] },
  Dave:    { name: 'Dave',    lwsId: 'L4', branch: 'APJ',      batches: ['APJ_1'], gender: 'Male',   accountStatus: 'Active', nameVariants: [] },
  Erin:    { name: 'Erin',    lwsId: 'L5', branch: 'APJ',      batches: ['APJ_1'], gender: 'Female', accountStatus: 'Block',  nameVariants: [] }, // non-Active → skipped
  Frank:   { name: 'Frank',   lwsId: 'L6', branch: 'LWS Pune', batches: [],        gender: 'Male',   accountStatus: 'Active', nameVariants: [] }, // no batch → skipped
}

describe('buildAttendanceRollup', () => {
  it('groups by branch → batch → gender with present/absent name lists', () => {
    // Bob absent (A); everyone else present (P / L / no-record).
    const rows = [
      { lws_id: 'L1', status: 'P' },
      { lws_id: 'L2', status: 'A' },
      { lws_id: 'L3', status: 'L' },
      // Dave: no record → present
    ]
    const r = buildAttendanceRollup({ attendanceRows: rows, studentProfiles: PROFILES, syllabusBatchBranches: BRANCHES })

    expect(r['LWS Pune']['LWS_A'].female.present).toEqual(['Alice'])
    expect(r['LWS Pune']['LWS_A'].female.absent).toEqual([])
    expect(r['LWS Pune']['LWS_A'].male.present).toEqual([])
    expect(r['LWS Pune']['LWS_A'].male.absent).toEqual(['Bob'])
    expect(r['LWS Pune']['LWS_B'].female.present).toEqual(['Carol'])
    expect(r['APJ']['APJ_1'].male.present).toEqual(['Dave'])
  })

  it('absent = status A only; everyone else (P/L/-/no-record) is present', () => {
    const rows = [
      { lws_id: 'L1', status: 'P' },
      { lws_id: 'L2', status: 'L' },
      { lws_id: 'L3', status: '-' },
      // L4 no record
    ]
    const r = buildAttendanceRollup({ attendanceRows: rows, studentProfiles: PROFILES, syllabusBatchBranches: BRANCHES })
    expect(r['LWS Pune']['LWS_A'].female.present).toEqual(['Alice'])  // P
    expect(r['LWS Pune']['LWS_A'].male.present).toEqual(['Bob'])      // L → present
    expect(r['LWS Pune']['LWS_B'].female.present).toEqual(['Carol'])  // - → present
    expect(r['APJ']['APJ_1'].male.present).toEqual(['Dave'])          // no record → present
    // no one is absent
    expect(r['LWS Pune']['LWS_A'].male.absent).toEqual([])
  })

  it('skips non-Active students', () => {
    const rows = [{ lws_id: 'L5', status: 'A' }]
    const r = buildAttendanceRollup({ attendanceRows: rows, studentProfiles: PROFILES, syllabusBatchBranches: BRANCHES })
    // Erin (Block) must not appear anywhere
    const apj = r['APJ']?.['APJ_1']
    expect(apj.female.present).toEqual([])
    expect(apj.female.absent).toEqual([])
  })

  it('skips students with no batch', () => {
    const r = buildAttendanceRollup({ attendanceRows: [], studentProfiles: PROFILES, syllabusBatchBranches: BRANCHES })
    // Frank (no batch) contributes to nothing — flatten all names and assert absent
    const allNames = Object.values(r).flatMap(batches =>
      Object.values(batches).flatMap(g => [...g.male.present, ...g.male.absent, ...g.female.present, ...g.female.absent])
    )
    expect(allNames).not.toContain('Frank')
  })

  it('skips variant-keyed profile entries (each student counted once)', () => {
    const rows = [{ lws_id: 'L1', status: 'P' }]
    const r = buildAttendanceRollup({ attendanceRows: rows, studentProfiles: PROFILES, syllabusBatchBranches: BRANCHES })
    expect(r['LWS Pune']['LWS_A'].female.present).toEqual(['Alice'])  // not ['Alice','Alice']
  })

  it('counts a multi-batch student under each of their batches', () => {
    const profiles = {
      Zoe: { name: 'Zoe', lwsId: 'L9', branch: 'LWS Pune', batches: ['LWS_A', 'LWS_B'], gender: 'Female', accountStatus: 'Active', nameVariants: [] },
    }
    const r = buildAttendanceRollup({ attendanceRows: [{ lws_id: 'L9', status: 'A' }], studentProfiles: profiles, syllabusBatchBranches: BRANCHES })
    expect(r['LWS Pune']['LWS_A'].female.absent).toEqual(['Zoe'])
    expect(r['LWS Pune']['LWS_B'].female.absent).toEqual(['Zoe'])
  })

  it('falls back to profile.branch when the batch is not in syllabusBatchBranches', () => {
    const profiles = {
      Yan: { name: 'Yan', lwsId: 'L8', branch: 'APJ', batches: ['UNMAPPED'], gender: 'Male', accountStatus: 'Active', nameVariants: [] },
    }
    const r = buildAttendanceRollup({ attendanceRows: [], studentProfiles: profiles, syllabusBatchBranches: BRANCHES })
    expect(r['APJ']['UNMAPPED'].male.present).toEqual(['Yan'])
  })

  it('returns an empty object for empty profiles', () => {
    expect(buildAttendanceRollup({ attendanceRows: [], studentProfiles: {}, syllabusBatchBranches: BRANCHES })).toEqual({})
  })
})
