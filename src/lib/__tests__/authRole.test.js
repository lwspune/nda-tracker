import { describe, it, expect } from 'vitest'
import { sessionRole, isTeacherSession, isSuperadminSession } from '../authRole'

// The role claim moved from `user_metadata` to `app_metadata` (2026-09-10).
//
// `user_metadata` is writable by the account holder itself
// (`supabase.auth.updateUser({ data: { role: 'superadmin' } })`), so every gate
// keyed on it was defeatable by the very accounts it was meant to restrict —
// Supabase's linter flags this as `rls_references_user_metadata` (ERROR).
// `app_metadata` can only be written by the Admin API (service role).
//
// The spoof-resistance cases below are the point of this module: a reader that
// falls back to `user_metadata` when `app_metadata` is missing would reinstate
// the whole vulnerability, so "ignores user_metadata" is asserted explicitly
// rather than left implicit in the app_metadata cases.

const session = meta => ({ user: { ...meta } })

describe('sessionRole', () => {
  it('reads the role from app_metadata', () => {
    expect(sessionRole(session({ app_metadata: { role: 'teacher' } }))).toBe('teacher')
    expect(sessionRole(session({ app_metadata: { role: 'superadmin' } }))).toBe('superadmin')
  })

  it('returns null for a session with no role claim (the plain admin account)', () => {
    expect(sessionRole(session({ app_metadata: {} }))).toBeNull()
    expect(sessionRole(session({}))).toBeNull()
  })

  it('returns null for a missing/!null session rather than throwing', () => {
    expect(sessionRole(null)).toBeNull()
    expect(sessionRole(undefined)).toBeNull()
    expect(sessionRole({})).toBeNull()
  })

  // ── spoof resistance ────────────────────────────────────────────
  it('IGNORES user_metadata.role entirely', () => {
    expect(sessionRole(session({ user_metadata: { role: 'superadmin' } }))).toBeNull()
    expect(sessionRole(session({ user_metadata: { role: 'teacher' } }))).toBeNull()
  })

  it('does not let user_metadata override or supplement app_metadata', () => {
    const s = session({ app_metadata: { role: 'teacher' }, user_metadata: { role: 'superadmin' } })
    expect(sessionRole(s)).toBe('teacher')
  })
})

describe('isTeacherSession', () => {
  it('is true only for an app_metadata teacher claim', () => {
    expect(isTeacherSession(session({ app_metadata: { role: 'teacher' } }))).toBe(true)
    expect(isTeacherSession(session({ app_metadata: { role: 'superadmin' } }))).toBe(false)
    expect(isTeacherSession(session({ app_metadata: {} }))).toBe(false)
    expect(isTeacherSession(null)).toBe(false)
  })

  // A teacher relabelling themselves in user_metadata must not escape the
  // teacher deny-lists (faculty_state writes, the six send endpoints).
  it('stays true when user_metadata claims a different role', () => {
    const s = session({ app_metadata: { role: 'teacher' }, user_metadata: { role: 'admin' } })
    expect(isTeacherSession(s)).toBe(true)
  })
})

describe('isSuperadminSession', () => {
  it('is true only for an app_metadata superadmin claim', () => {
    expect(isSuperadminSession(session({ app_metadata: { role: 'superadmin' } }))).toBe(true)
    expect(isSuperadminSession(session({ app_metadata: { role: 'teacher' } }))).toBe(false)
    expect(isSuperadminSession(session({ app_metadata: {} }))).toBe(false)
    expect(isSuperadminSession(null)).toBe(false)
  })

  // The gate that protects fee data. A self-service promotion must not open it.
  it('is false when superadmin is claimed only in user_metadata', () => {
    expect(isSuperadminSession(session({ user_metadata: { role: 'superadmin' } }))).toBe(false)
  })
})
