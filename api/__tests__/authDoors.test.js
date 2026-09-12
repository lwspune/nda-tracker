// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

// Every endpoint that authenticates a SESSION must also decide about teachers.
//
// On 2026-09-12 two of the nine did not: send-whatsapp.js (exam results to
// parents) and the lecture-miss path of send-attendance-alerts.js. Neither was
// a decision — the check simply never got added, and with nine hand-maintained
// copies of the same eight lines there was nothing to notice it against. Worse,
// three sibling endpoints carry comments saying they 403 teachers "mirroring
// api/send-attendance-alerts.js", having been modelled on the one path that
// lacked it.
//
// This is a structural guard, not a behavioural one: it cannot tell a correct
// policy from a wrong one, only a considered one from an absent one. An endpoint
// that genuinely should admit teachers passes by saying so in a comment
// containing ALLOWS_TEACHERS.

const API = resolve(__dirname, '..')
const endpoints = readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'))

describe('every session-authenticating endpoint decides about teachers', () => {
  const sessionEndpoints = endpoints.filter(f =>
    readFileSync(join(API, f), 'utf-8').includes('getUserOrNull('))

  it('finds the session endpoints (guard against the list silently emptying)', () => {
    // If this drops to zero the whole suite below becomes vacuous.
    expect(sessionEndpoints.length).toBeGreaterThanOrEqual(8)
  })

  it.each(sessionEndpoints)('%s gates or explicitly allows teachers', file => {
    const src = readFileSync(join(API, file), 'utf-8')
    const gated = src.includes('isTeacherUser(')
    const deliberate = src.includes('ALLOWS_TEACHERS')
    expect(gated || deliberate).toBe(true)
  })

  // One `isTeacherUser` in a file with two independent session doors is not
  // enough — that is exactly how the lecture path stayed open while the hostel
  // path in the SAME FILE was gated.
  it.each(sessionEndpoints)('%s gates every session door it opens, not just one', file => {
    const src = readFileSync(join(API, file), 'utf-8')
    if (src.includes('ALLOWS_TEACHERS')) return
    const doors = (src.match(/getUserOrNull\(/g) || []).length
    const gates = (src.match(/isTeacherUser\(user\)|isTeacherUser\(u\b/g) || []).length
    expect(gates).toBeGreaterThanOrEqual(doors)
  })
})
