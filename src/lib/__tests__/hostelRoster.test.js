import { describe, it, expect } from 'vitest'
import { buildBoarderRoster, HOSTEL_BRANCHES } from '../hostelRoster'

const PROFILES = {
  'Aarav Nair':   { name: 'Aarav Nair',   lwsId: 'APJ-1', branch: 'APJ',       accountStatus: 'Active', gender: 'Male',   batches: ['APJ_NDA_11th'] },
  'Bhavya Rao':   { name: 'Bhavya Rao',   lwsId: 'APJ-2', branch: 'APJ',       accountStatus: 'Active', gender: 'Female', batches: ['APJ_NDA_11th'] },
  'Day Scholar':  { name: 'Day Scholar',  lwsId: 'APJ-3', branch: 'APJ',       accountStatus: 'Active', residential: false },
  'Quit Boarder': { name: 'Quit Boarder', lwsId: 'APJ-9', branch: 'APJ',       accountStatus: 'Quit' },
  'Lws Student':  { name: 'Lws Student',  lwsId: 'LWS-1', branch: 'LWS Pune',  accountStatus: 'Active' },
  'Legacy Blank': { name: 'Legacy Blank', lwsId: 'APJ-4', branch: 'APJ' },      // no accountStatus
  // A name variant pointing at the SAME student as 'Aarav Nair'
  'Aarav N':      { name: 'Aarav Nair',   lwsId: 'APJ-1', branch: 'APJ',       accountStatus: 'Active' },
}

describe('buildBoarderRoster', () => {
  it('includes Active APJ boarders, sorted by name', () => {
    expect(buildBoarderRoster(PROFILES).map(r => r.lwsId)).toEqual(['APJ-1', 'APJ-2', 'APJ-4'])
  })

  it('excludes day-scholars, non-Active students and other branches', () => {
    const ids = buildBoarderRoster(PROFILES).map(r => r.lwsId)
    expect(ids).not.toContain('APJ-3')   // residential === false
    expect(ids).not.toContain('APJ-9')   // Quit
    expect(ids).not.toContain('LWS-1')   // LWS Pune has no boarders
  })

  // Legacy rows with no accountStatus stay in — same fail-open posture as the
  // login gate. Only an explicit non-Active status excludes.
  it('keeps a legacy row with a blank accountStatus', () => {
    expect(buildBoarderRoster(PROFILES).map(r => r.lwsId)).toContain('APJ-4')
  })

  // studentProfiles is keyed by canonical name AND every variant spelling; a
  // variant must not become its own roster row or the boarder is marked twice.
  it('never emits a name variant as a second row', () => {
    const roster = buildBoarderRoster(PROFILES)
    expect(roster.filter(r => r.lwsId === 'APJ-1')).toHaveLength(1)
  })

  it('carries the fields the marking board and alert need', () => {
    const [first] = buildBoarderRoster(PROFILES)
    expect(first).toMatchObject({
      lwsId: 'APJ-1', name: 'Aarav Nair', branch: 'APJ',
      gender: 'Male', batches: ['APJ_NDA_11th'],
    })
  })

  it('handles empty / missing input and an explicit branch list', () => {
    expect(buildBoarderRoster({})).toEqual([])
    expect(buildBoarderRoster(null)).toEqual([])
    expect(buildBoarderRoster(PROFILES, [])).toEqual([])
    expect(buildBoarderRoster(PROFILES, ['LWS Pune']).map(r => r.lwsId)).toEqual(['LWS-1'])
  })

  it('defaults to the APJ-only hostel scope', () => {
    expect(HOSTEL_BRANCHES).toEqual(['APJ'])
  })
})
