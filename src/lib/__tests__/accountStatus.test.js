import { describe, it, expect } from 'vitest'
import { INACTIVE_STATUSES, isBlockedStatus, isActiveContact } from '../accountStatus'

// A "blocked contact" must never be sent a WhatsApp message. The authoritative
// definition mirrors the login gate (api/student-login.js): only explicit
// Block / Quit / Inactive are excluded; blank/legacy status is treated as active
// (fail open), so a student who was simply never stamped 'Active' is not silenced.

describe('accountStatus — isBlockedStatus', () => {
  it('treats Block / Quit / Inactive as blocked', () => {
    expect(isBlockedStatus('Block')).toBe(true)
    expect(isBlockedStatus('Quit')).toBe(true)
    expect(isBlockedStatus('Inactive')).toBe(true)
  })

  it('treats Active as not blocked', () => {
    expect(isBlockedStatus('Active')).toBe(false)
  })

  it('treats blank / null / undefined (legacy) as not blocked (fail open)', () => {
    expect(isBlockedStatus('')).toBe(false)
    expect(isBlockedStatus(null)).toBe(false)
    expect(isBlockedStatus(undefined)).toBe(false)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(isBlockedStatus(' Block ')).toBe(true)
  })

  it('exposes the canonical inactive set (mirrors the login gate)', () => {
    expect([...INACTIVE_STATUSES].sort()).toEqual(['Block', 'Inactive', 'Quit'])
  })
})

describe('accountStatus — isActiveContact', () => {
  it('returns false for a blocked profile (camelCase accountStatus)', () => {
    expect(isActiveContact({ accountStatus: 'Block' })).toBe(false)
  })

  it('returns true for an Active profile', () => {
    expect(isActiveContact({ accountStatus: 'Active' })).toBe(true)
  })

  it('returns true for a blank/legacy profile', () => {
    expect(isActiveContact({ accountStatus: '' })).toBe(true)
    expect(isActiveContact({})).toBe(true)
  })

  it('returns true for a null/undefined profile (defensive)', () => {
    expect(isActiveContact(null)).toBe(true)
    expect(isActiveContact(undefined)).toBe(true)
  })
})
