import { describe, it, expect } from 'vitest'
import { isRateLimit } from '../_googleCalendar.js'

describe('isRateLimit', () => {
  it('treats HTTP 429 as rate-limited', () => {
    expect(isRateLimit(429, {})).toBe(true)
  })
  it('treats 403 with a rateLimitExceeded reason as rate-limited', () => {
    expect(isRateLimit(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } })).toBe(true)
    expect(isRateLimit(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } })).toBe(true)
    expect(isRateLimit(403, { error: { message: 'Rate Limit Exceeded' } })).toBe(true)
  })
  it('does NOT retry a 403 that is a real auth/permission error', () => {
    expect(isRateLimit(403, { error: { errors: [{ reason: 'forbidden' }], message: 'Forbidden' } })).toBe(false)
  })
  it('does NOT retry other failures (404, 400, 500)', () => {
    expect(isRateLimit(404, { error: { message: 'Not Found' } })).toBe(false)
    expect(isRateLimit(400, {})).toBe(false)
    expect(isRateLimit(500, {})).toBe(false)
  })
})
