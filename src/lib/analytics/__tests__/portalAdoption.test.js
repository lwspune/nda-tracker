import { describe, it, expect } from 'vitest'
import { buildNeverLoggedIn } from '../portalAdoption'

// Fixed "now" so daysEnrolled is deterministic. The pure fn must never read the clock.
const TODAY = new Date('2026-09-11T00:00:00Z')

// studentProfiles is keyed by canonical name AND every variant. 'Ali' is a variant
// key pointing at Alice's profile (name !== key) and must not produce a second row.
const profiles = {
  Alice: {
    lwsId: 'L1', name: 'Alice', branch: 'APJ', batches: ['APJ_NDA_11th_(26-27)_A'],
    accountStatus: 'Active', regDate: '2026-04-01', mobile: '9000000001', parentMobiles: [],
  },
  Bob: {
    lwsId: 'L2', name: 'Bob', branch: 'APJ', batches: ['APJ_NDA_11th_(26-27)_B'],
    accountStatus: 'Active', regDate: '2025-05-14', mobile: '', parentMobiles: ['9000000002'],
  },
  Carol: {
    lwsId: 'L3', name: 'Carol', branch: 'LWS Pune', batches: ['LWS_NDA_2Y_(25-27)_A'],
    accountStatus: 'Active', regDate: '2026-07-12', mobile: '9000000003', parentMobiles: [],
  },
  Dave: {
    lwsId: 'L4', name: 'Dave', branch: 'APJ', batches: [],
    accountStatus: 'Block', regDate: '2025-01-01', mobile: '9000000004', parentMobiles: [],
  },
  Erin: {
    lwsId: 'L5', name: 'Erin', branch: 'APJ', batches: ['APJ_NDA_9th_(26-27)'],
    accountStatus: '', regDate: '2026-05-23', mobile: '', parentMobiles: [],
  },
  Ali: {
    lwsId: 'L1', name: 'Alice', branch: 'APJ', batches: ['APJ_NDA_11th_(26-27)_A'],
    accountStatus: 'Active', regDate: '2026-04-01', mobile: '9000000001', parentMobiles: [],
  },
}

// Alice (L1) has logged in; everyone else has not.
const loginIds = new Set(['L1'])

describe('buildNeverLoggedIn', () => {
  const rows = buildNeverLoggedIn({ loginIds, studentProfiles: profiles, today: TODAY })

  it('returns only students with no login row, longest-enrolled first', () => {
    // Bob (2025-05-14) → Erin (2026-05-23) → Carol (2026-07-12).
    // Alice logged in; Dave is blocked.
    expect(rows.map(r => r.name)).toEqual(['Bob', 'Erin', 'Carol'])
  })

  it('excludes students who have logged in at least once', () => {
    expect(rows.some(r => r.lwsId === 'L1')).toBe(false)
  })

  it('excludes Block / Quit / Inactive students', () => {
    expect(rows.some(r => r.name === 'Dave')).toBe(false)
  })

  it('treats a blank account status as active, mirroring the login gate', () => {
    // Erin has accountStatus '' — she CAN log in (api/student-login.js fails open
    // on blank), so she belongs on the chase list. A strict === 'Active' check
    // would silently drop her.
    expect(rows.some(r => r.name === 'Erin')).toBe(true)
  })

  it('does not emit a duplicate row for a variant-keyed profile', () => {
    const ids = rows.map(r => r.lwsId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('computes daysEnrolled against the injected date, not the clock', () => {
    expect(rows.find(r => r.name === 'Carol').daysEnrolled).toBe(61)  // 2026-07-12 → 2026-09-11
    expect(rows.find(r => r.name === 'Erin').daysEnrolled).toBe(111)  // 2026-05-23 → 2026-09-11
  })

  it('reports how many contact numbers each student has', () => {
    // Erin has neither a mobile nor a parent number — she cannot log in at all,
    // because the student portal authenticates by mobile number.
    expect(rows.find(r => r.name === 'Erin').contactCount).toBe(0)
    expect(rows.find(r => r.name === 'Bob').contactCount).toBe(1)
  })

  it('carries batch and branch through for the chase list', () => {
    expect(rows.find(r => r.name === 'Carol').batches).toEqual(['LWS_NDA_2Y_(25-27)_A'])
    expect(rows.find(r => r.name === 'Carol').branch).toBe('LWS Pune')
  })

  it('accepts loginIds as a plain array as well as a Set', () => {
    const viaArray = buildNeverLoggedIn({ loginIds: ['L1'], studentProfiles: profiles, today: TODAY })
    expect(viaArray.map(r => r.name)).toEqual(['Bob', 'Erin', 'Carol'])
  })

  it('skips profiles with no lwsId — they cannot be matched to a login', () => {
    const withGhost = { ...profiles, Ghost: { lwsId: '', name: 'Ghost', accountStatus: 'Active', regDate: '2020-01-01' } }
    const out = buildNeverLoggedIn({ loginIds, studentProfiles: withGhost, today: TODAY })
    expect(out.some(r => r.name === 'Ghost')).toBe(false)
  })

  it('sorts a student with no regDate last and leaves daysEnrolled null', () => {
    const withUndated = { ...profiles, Frank: { lwsId: 'L6', name: 'Frank', accountStatus: 'Active', regDate: '', batches: [] } }
    const out = buildNeverLoggedIn({ loginIds, studentProfiles: withUndated, today: TODAY })
    expect(out[out.length - 1].name).toBe('Frank')
    expect(out[out.length - 1].daysEnrolled).toBe(null)
  })

  it('returns an empty list when everyone has logged in', () => {
    const out = buildNeverLoggedIn({
      loginIds: new Set(['L1', 'L2', 'L3', 'L5']),
      studentProfiles: profiles,
      today: TODAY,
    })
    expect(out).toEqual([])
  })

  it('is defensive about missing inputs', () => {
    expect(buildNeverLoggedIn({})).toEqual([])
    expect(buildNeverLoggedIn({ studentProfiles: {}, loginIds: new Set() })).toEqual([])
  })
})
