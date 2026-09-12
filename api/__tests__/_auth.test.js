// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { bearerFrom, getUserOrNull } from '../_auth.js'

// The MECHANICAL half of the auth preamble — pulling a token out of a header,
// and turning a token into a user or null. Nothing here decides who is allowed
// in: that stays inline in each endpoint, on purpose.
//
// Nine endpoints hand-maintained the same eight lines, and they were not
// identical — send-whatsapp.js was missing its teacher 403 entirely (fixed
// 2026-09-12), which is exactly the kind of omission nine near-identical blocks
// hide. The fix for that is a test per door, not a requireAdmin() helper that
// hides WHICH callers refuse a teacher.

describe('bearerFrom', () => {
  it('strips the Bearer prefix', () => {
    expect(bearerFrom({ headers: { authorization: 'Bearer abc.def' } })).toBe('abc.def')
  })

  it('is case-insensitive about the scheme and tolerates extra spacing', () => {
    expect(bearerFrom({ headers: { authorization: 'bearer   abc' } })).toBe('abc')
    expect(bearerFrom({ headers: { authorization: 'BEARER abc  ' } })).toBe('abc')
  })

  it('returns a bare token unchanged', () => {
    expect(bearerFrom({ headers: { authorization: 'abc.def' } })).toBe('abc.def')
  })

  it('returns empty string when there is no header at all', () => {
    expect(bearerFrom({ headers: {} })).toBe('')
    expect(bearerFrom({})).toBe('')
    expect(bearerFrom(null)).toBe('')
    expect(bearerFrom({ headers: { authorization: '' } })).toBe('')
    expect(bearerFrom({ headers: { authorization: 'Bearer ' } })).toBe('')
  })
})

describe('getUserOrNull', () => {
  const clientReturning = value => ({ auth: { getUser: vi.fn().mockResolvedValue(value) } })

  it('returns the user for a valid token', async () => {
    const user = { id: 'u1', app_metadata: { role: 'teacher' } }
    expect(await getUserOrNull(clientReturning({ data: { user } }), 'jwt')).toEqual(user)
  })

  it('returns null when the token resolves to no user', async () => {
    expect(await getUserOrNull(clientReturning({ data: { user: null } }), 'jwt')).toBeNull()
  })

  it('does not call the auth service for an empty token', async () => {
    const client = clientReturning({ data: { user: { id: 'u1' } } })
    expect(await getUserOrNull(client, '')).toBeNull()
    expect(client.auth.getUser).not.toHaveBeenCalled()
  })

  // The nine inline copies all wrote `const { data: { user } } = await ...`,
  // which THROWS if the call rejects or hands back a bodyless response — an
  // unhandled rejection rather than a refusal. Resolving to null lets every
  // caller's existing `if (!user) -> 401` handle it, which fails closed.
  it('returns null when the auth call rejects', async () => {
    const client = { auth: { getUser: vi.fn().mockRejectedValue(new Error('network down')) } }
    expect(await getUserOrNull(client, 'jwt')).toBeNull()
  })

  it('returns null when the response has no data envelope', async () => {
    expect(await getUserOrNull(clientReturning({}), 'jwt')).toBeNull()
    expect(await getUserOrNull(clientReturning({ data: null }), 'jwt')).toBeNull()
    expect(await getUserOrNull(clientReturning(undefined), 'jwt')).toBeNull()
  })

  it('returns null when an error is reported alongside a user', async () => {
    const client = clientReturning({ data: { user: { id: 'u1' } }, error: { message: 'expired' } })
    expect(await getUserOrNull(client, 'jwt')).toBeNull()
  })
})
