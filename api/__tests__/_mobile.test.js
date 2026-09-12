// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { normMobile } from '../_mobile.js'

// The single server-side phone normaliser.
//
// This function decides two things with real-world consequences: which number a
// parent-facing WhatsApp message is delivered to, and — via api/student-login.js
// — whether a mobile matches a student or guardian record at all. It existed as
// nine byte-identical private copies across api/ until 2026-09-12, none of them
// directly tested; these cases pin the contract now that there is one copy.
//
// Contract: return a 12-digit `91`-prefixed string, or null. Never a partial
// number — a caller that receives null skips the recipient and logs a SKIP line,
// which is the safe outcome. Returning a malformed number would send to it.

describe('normMobile', () => {
  it('prefixes a bare 10-digit Indian mobile with 91', () => {
    expect(normMobile('9876543210')).toBe('919876543210')
  })

  it('accepts an already-prefixed 12-digit number unchanged', () => {
    expect(normMobile('919876543210')).toBe('919876543210')
  })

  it('replaces a single leading 0 on an 11-digit number with 91', () => {
    expect(normMobile('09876543210')).toBe('919876543210')
  })

  it('strips separators, spaces and a +91 country code', () => {
    expect(normMobile('+91 98765 43210')).toBe('919876543210')
    expect(normMobile('98765-43210')).toBe('919876543210')
    expect(normMobile('(987) 654 3210')).toBe('919876543210')
  })

  // Anything that is not resolvable to exactly one Indian mobile must be null.
  // A truncated or over-long number that still "looked like" a number is how a
  // message reaches a stranger.
  it('returns null for a number that is too short or too long', () => {
    expect(normMobile('12345')).toBeNull()
    expect(normMobile('987654321')).toBeNull()          // 9 digits
    expect(normMobile('98765432101')).toBeNull()         // 11 digits, no leading 0
    expect(normMobile('9198765432100')).toBeNull()       // 13 digits
  })

  it('returns null for a non-91 country code of the right length', () => {
    expect(normMobile('449876543210')).toBeNull()
  })

  it('returns null for empty, blank and non-string input', () => {
    expect(normMobile('')).toBeNull()
    expect(normMobile(null)).toBeNull()
    expect(normMobile(undefined)).toBeNull()
    expect(normMobile('   ')).toBeNull()
    expect(normMobile('not a number')).toBeNull()
  })

  it('accepts a number given as a JS number, not a string', () => {
    // Excel and JSON payloads both hand these over unquoted.
    expect(normMobile(9876543210)).toBe('919876543210')
  })
})
