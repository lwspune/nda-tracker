import { describe, it, expect } from 'vitest'
import { getBlockableMembers } from '../batchMembers'

function profile(name, over = {}) {
  return { lwsId: 'LWS-' + name, name, batches: ['X'], accountStatus: 'Active', nameVariants: [], ...over }
}

function indexed(list) {
  // Mirrors studentProfiles: keyed by canonical name AND every name variant.
  const map = {}
  for (const p of list) {
    map[p.name] = p
    for (const v of p.nameVariants) map[v] = p
  }
  return map
}

describe('getBlockableMembers', () => {
  it('returns the batch members who can currently log in', () => {
    const profiles = indexed([profile('Aarav'), profile('Bina')])
    expect(getBlockableMembers(profiles, 'X').map(m => m.name)).toEqual(['Aarav', 'Bina'])
  })

  it('ignores students in other batches', () => {
    const profiles = indexed([profile('Aarav'), profile('Chetan', { batches: ['Y'] })])
    expect(getBlockableMembers(profiles, 'X').map(m => m.name)).toEqual(['Aarav'])
  })

  // Blocking a student who is already Block / Quit / Inactive gains nothing and
  // overwrites a more specific status with a vaguer one.
  it('skips students who are already blocked, quit or inactive', () => {
    const profiles = indexed([
      profile('Aarav'),
      profile('Bina',   { accountStatus: 'Block' }),
      profile('Chetan', { accountStatus: 'Quit' }),
      profile('Divya',  { accountStatus: 'Inactive' }),
    ])
    expect(getBlockableMembers(profiles, 'X').map(m => m.name)).toEqual(['Aarav'])
  })

  // Blank is legacy-active: api/student-login fails OPEN on it, so such a student
  // CAN log in and must be blocked or archiving would leave them access.
  it('includes a student with a blank status (legacy rows can still log in)', () => {
    const profiles = indexed([profile('Aarav', { accountStatus: '' })])
    expect(getBlockableMembers(profiles, 'X').map(m => m.name)).toEqual(['Aarav'])
  })

  it('does not return a student twice via a name variant', () => {
    const profiles = indexed([profile('Aarav Sharma', { nameVariants: ['A Sharma'] })])
    expect(getBlockableMembers(profiles, 'X')).toHaveLength(1)
  })

  it('skips profiles with no lwsId — there is nothing to update', () => {
    const profiles = indexed([profile('Aarav', { lwsId: '' })])
    expect(getBlockableMembers(profiles, 'X')).toEqual([])
  })

  it('tolerates empty / missing inputs', () => {
    expect(getBlockableMembers({}, 'X')).toEqual([])
    expect(getBlockableMembers(null, 'X')).toEqual([])
    expect(getBlockableMembers(indexed([profile('Aarav')]), '')).toEqual([])
  })

  it('sorts by name so the confirm list is stable', () => {
    const profiles = indexed([profile('Zoya'), profile('Aarav')])
    expect(getBlockableMembers(profiles, 'X').map(m => m.name)).toEqual(['Aarav', 'Zoya'])
  })
})
