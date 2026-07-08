import { describe, it, expect } from 'vitest'
import { buildDailyChain, resolveOnLeave, CHECKPOINT_ORDER } from '../chain'

// ── resolveOnLeave ────────────────────────────────────────────
// A leave explains a day when its [fromMs, toMs] window overlaps the day's
// [dayStartMs, dayEndMs] window (boundaries inclusive). Day-granular by design:
// a partial single-checkpoint deviation is marked as an 'outpass' status on that
// checkpoint instead (see chain.js header).

describe('resolveOnLeave', () => {
  const DAY_START = 1_000
  const DAY_END = 2_000

  it('includes a leave whose window covers the whole day', () => {
    const ids = resolveOnLeave([{ lwsId: 'A', fromMs: 500, toMs: 3_000 }], DAY_START, DAY_END)
    expect(ids.has('A')).toBe(true)
  })

  it('includes a leave that starts mid-day (out-pass from noon)', () => {
    const ids = resolveOnLeave([{ lwsId: 'A', fromMs: 1_500, toMs: 3_000 }], DAY_START, DAY_END)
    expect(ids.has('A')).toBe(true)
  })

  it('excludes a leave that ended before the day started', () => {
    const ids = resolveOnLeave([{ lwsId: 'A', fromMs: 100, toMs: 900 }], DAY_START, DAY_END)
    expect(ids.has('A')).toBe(false)
  })

  it('excludes a leave that starts after the day ended', () => {
    const ids = resolveOnLeave([{ lwsId: 'A', fromMs: 2_100, toMs: 3_000 }], DAY_START, DAY_END)
    expect(ids.has('A')).toBe(false)
  })

  it('treats boundary touch as covered (inclusive)', () => {
    const ids = resolveOnLeave([{ lwsId: 'A', fromMs: 2_000, toMs: 3_000 }], DAY_START, DAY_END)
    expect(ids.has('A')).toBe(true)
  })

  it('collects every covered student', () => {
    const ids = resolveOnLeave([
      { lwsId: 'A', fromMs: 500, toMs: 3_000 },
      { lwsId: 'B', fromMs: 100, toMs: 900 },     // not covered
      { lwsId: 'C', fromMs: 1_200, toMs: 1_300 }, // covered
    ], DAY_START, DAY_END)
    expect([...ids].sort()).toEqual(['A', 'C'])
  })

  it('returns an empty set for no leaves', () => {
    expect(resolveOnLeave([], DAY_START, DAY_END).size).toBe(0)
  })
})

// ── buildDailyChain ───────────────────────────────────────────

const ROSTER = [
  { lwsId: 'S1', name: 'Aarav' },
  { lwsId: 'S2', name: 'Bhavya' },
  { lwsId: 'S3', name: 'Chirag' },
]

function chainFor(rows, lwsId) {
  return rows.find(r => r.lwsId === lwsId)
}

describe('buildDailyChain', () => {
  it('defaults every checkpoint to present when there are no exceptions', () => {
    const rows = buildDailyChain({ roster: ROSTER })
    expect(rows).toHaveLength(3)
    const s1 = chainFor(rows, 'S1')
    for (const cp of CHECKPOINT_ORDER) expect(s1.statuses[cp]).toBe('present')
    expect(s1.anomaly).toBe(false)
    expect(s1.firstBreak).toBe(null)
    expect(s1.onLeave).toBe(false)
  })

  it('marks a checkpoint absence and flags it as an anomaly', () => {
    const rows = buildDailyChain({
      roster: ROSTER,
      checkpointRows: [{ lws_id: 'S2', checkpoint: 'dinner', status: 'absent' }],
    })
    const s2 = chainFor(rows, 'S2')
    expect(s2.statuses.dinner).toBe('absent')
    expect(s2.anomaly).toBe(true)
    expect(s2.firstBreak).toBe('dinner')
  })

  it('does NOT flag sick or outpass checkpoint statuses as anomalies', () => {
    const rows = buildDailyChain({
      roster: ROSTER,
      checkpointRows: [
        { lws_id: 'S1', checkpoint: 'lunch', status: 'sick' },
        { lws_id: 'S2', checkpoint: 'dinner', status: 'outpass' },
      ],
    })
    expect(chainFor(rows, 'S1').statuses.lunch).toBe('sick')
    expect(chainFor(rows, 'S1').anomaly).toBe(false)
    expect(chainFor(rows, 'S2').statuses.dinner).toBe('outpass')
    expect(chainFor(rows, 'S2').anomaly).toBe(false)
  })

  it('an active leave explains EVERY checkpoint for that student', () => {
    const rows = buildDailyChain({
      roster: ROSTER,
      onLeaveIds: new Set(['S3']),
      // A stray absent row must be overridden by the leave.
      checkpointRows: [{ lws_id: 'S3', checkpoint: 'breakfast', status: 'absent' }],
    })
    const s3 = chainFor(rows, 'S3')
    for (const cp of CHECKPOINT_ORDER) expect(s3.statuses[cp]).toBe('leave')
    expect(s3.onLeave).toBe(true)
    expect(s3.anomaly).toBe(false)
    expect(s3.firstBreak).toBe(null)
  })

  it('derives the class checkpoint from daily attendance (A→absent, L→late, P→present)', () => {
    const rows = buildDailyChain({
      roster: ROSTER,
      attendanceRows: [
        { lws_id: 'S1', status: 'A' },
        { lws_id: 'S2', status: 'L' },
        { lws_id: 'S3', status: 'P' },
      ],
    })
    expect(chainFor(rows, 'S1').statuses.class).toBe('absent')
    expect(chainFor(rows, 'S1').anomaly).toBe(true)
    expect(chainFor(rows, 'S2').statuses.class).toBe('late')   // late is not an anomaly
    expect(chainFor(rows, 'S2').anomaly).toBe(false)
    expect(chainFor(rows, 'S3').statuses.class).toBe('present')
  })

  it('firstBreak is the earliest unexplained-absent checkpoint in chain order', () => {
    const rows = buildDailyChain({
      roster: ROSTER,
      attendanceRows: [{ lws_id: 'S1', status: 'A' }],   // class absent (mid-chain)
      checkpointRows: [
        { lws_id: 'S1', checkpoint: 'dinner', status: 'absent' },
        { lws_id: 'S1', checkpoint: 'breakfast', status: 'absent' }, // earliest
      ],
    })
    const s1 = chainFor(rows, 'S1')
    expect(s1.firstBreak).toBe('breakfast')
    expect(s1.anomaly).toBe(true)
  })

  it('honours a custom checkpoint order', () => {
    const order = ['hostel_am', 'hostel_pm']
    const rows = buildDailyChain({ roster: ROSTER, order })
    expect(Object.keys(chainFor(rows, 'S1').statuses)).toEqual(order)
  })

  it('preserves roster order and carries name through', () => {
    const rows = buildDailyChain({ roster: ROSTER })
    expect(rows.map(r => r.name)).toEqual(['Aarav', 'Bhavya', 'Chirag'])
  })
})
