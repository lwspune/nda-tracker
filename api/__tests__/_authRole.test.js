// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { userRole, isTeacherUser, isSuperadminUser } from '../_authRole.js'

// Server-side twin of src/lib/authRole.js. The endpoints receive a `user`
// object from `supabase.auth.getUser(bearer)` rather than a session, so the
// shape differs by one level — but the rule is identical and load-bearing:
// read `app_metadata` ONLY. See src/lib/__tests__/authRole.test.js for why.

describe('userRole', () => {
  it('reads the role from app_metadata', () => {
    expect(userRole({ app_metadata: { role: 'teacher' } })).toBe('teacher')
    expect(userRole({ app_metadata: { role: 'superadmin' } })).toBe('superadmin')
  })

  it('returns null when there is no role claim, or no user at all', () => {
    expect(userRole({ app_metadata: {} })).toBeNull()
    expect(userRole({})).toBeNull()
    expect(userRole(null)).toBeNull()
    expect(userRole(undefined)).toBeNull()
  })

  it('IGNORES user_metadata.role entirely', () => {
    expect(userRole({ user_metadata: { role: 'superadmin' } })).toBeNull()
    expect(userRole({ user_metadata: { role: 'teacher' } })).toBeNull()
  })
})

describe('isTeacherUser', () => {
  it('is true only for an app_metadata teacher claim', () => {
    expect(isTeacherUser({ app_metadata: { role: 'teacher' } })).toBe(true)
    expect(isTeacherUser({ app_metadata: { role: 'superadmin' } })).toBe(false)
    expect(isTeacherUser({ app_metadata: {} })).toBe(false)
    expect(isTeacherUser(null)).toBe(false)
  })

  // The six parent-facing send endpoints 403 on this. A teacher who rewrote
  // their own user_metadata must still be refused.
  it('stays true when user_metadata claims another role', () => {
    expect(isTeacherUser({ app_metadata: { role: 'teacher' }, user_metadata: { role: 'admin' } })).toBe(true)
  })

  it('is false when teacher is claimed only in user_metadata', () => {
    expect(isTeacherUser({ user_metadata: { role: 'teacher' } })).toBe(false)
  })
})

describe('isSuperadminUser', () => {
  it('is true only for an app_metadata superadmin claim', () => {
    expect(isSuperadminUser({ app_metadata: { role: 'superadmin' } })).toBe(true)
    expect(isSuperadminUser({ app_metadata: { role: 'teacher' } })).toBe(false)
    expect(isSuperadminUser({})).toBe(false)
    expect(isSuperadminUser(null)).toBe(false)
  })

  it('is false when superadmin is claimed only in user_metadata', () => {
    expect(isSuperadminUser({ user_metadata: { role: 'superadmin' } })).toBe(false)
  })
})
