import { describe, it, expect } from 'vitest'
import { buildOpenLeaveList, STALE_LEAVE_DAYS, OPEN_LEAVE_MS } from '../hostelLeave'

const NAMES = new Map([['APJ-1', 'Aarav Nair'], ['APJ-2', 'Bhavya Rao'], ['APJ-3', 'Chetan Joshi']])
// 13-07-2026 IST midnight, the "board day" every case is measured against.
const DAY_START = Date.parse('2026-07-13T00:00:00+05:30')
const day = n => Date.parse(`2026-07-${String(n).padStart(2, '0')}T00:00:00+05:30`)

describe('buildOpenLeaveList', () => {
  it('counts whole days out from the leave start to the board day', () => {
    const out = buildOpenLeaveList({
      rows: [{ id: 'l1', lws_id: 'APJ-1', from_ts: '2026-07-10T00:00:00+05:30', to_ts: null }],
      nameByLwsId: NAMES,
      dayStartMs: DAY_START,
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'l1', lwsId: 'APJ-1', name: 'Aarav Nair', daysOut: 3 })
  })

  it('flags a leave running STALE_LEAVE_DAYS or longer', () => {
    // The guard against an open-ended leave silently masking a boarder forever.
    const rows = [
      { id: 'l1', lws_id: 'APJ-1', from_ts: '2026-07-10T00:00:00+05:30', to_ts: null }, // 3 days
      { id: 'l2', lws_id: 'APJ-2', from_ts: '2026-07-12T00:00:00+05:30', to_ts: null }, // 1 day
    ]
    const out = buildOpenLeaveList({ rows, nameByLwsId: NAMES, dayStartMs: DAY_START })
    expect(out.find(l => l.lwsId === 'APJ-1').stale).toBe(true)
    expect(out.find(l => l.lwsId === 'APJ-2').stale).toBe(false)
    expect(STALE_LEAVE_DAYS).toBe(3)
  })

  it('never reports negative days for a leave starting in the future', () => {
    const out = buildOpenLeaveList({
      rows: [{ id: 'l1', lws_id: 'APJ-1', from_ts: '2026-07-20T00:00:00+05:30', to_ts: null }],
      nameByLwsId: NAMES,
      dayStartMs: DAY_START,
    })
    expect(out[0].daysOut).toBe(0)
    expect(out[0].stale).toBe(false)
  })

  it('sorts longest-out first, then by name', () => {
    const rows = [
      { id: 'l1', lws_id: 'APJ-2', from_ts: '2026-07-12T00:00:00+05:30', to_ts: null },
      { id: 'l2', lws_id: 'APJ-1', from_ts: '2026-07-08T00:00:00+05:30', to_ts: null },
      { id: 'l3', lws_id: 'APJ-3', from_ts: '2026-07-12T00:00:00+05:30', to_ts: null },
    ]
    const out = buildOpenLeaveList({ rows, nameByLwsId: NAMES, dayStartMs: DAY_START })
    expect(out.map(l => l.name)).toEqual(['Aarav Nair', 'Bhavya Rao', 'Chetan Joshi'])
  })

  it('treats both NULL and the 2099 sentinel as open-ended', () => {
    // Open-ended is encoded as the sentinel so stale bundles still read it, but
    // NULL rows predate that and must not be misreported as bounded.
    const rows = [
      { id: 'l1', lws_id: 'APJ-1', from_ts: day(12), to_ts: null },
      { id: 'l2', lws_id: 'APJ-2', from_ts: day(12), to_ts: '2099-12-31T23:59:59+05:30' },
      { id: 'l3', lws_id: 'APJ-3', from_ts: day(12), to_ts: '2026-07-20T00:00:00+05:30' },
    ]
    const out = buildOpenLeaveList({ rows, nameByLwsId: NAMES, dayStartMs: DAY_START })
    expect(out.find(l => l.lwsId === 'APJ-1').openEnded).toBe(true)
    expect(out.find(l => l.lwsId === 'APJ-2').openEnded).toBe(true)
    expect(out.find(l => l.lwsId === 'APJ-3').openEnded).toBe(false)
    expect(Number.isFinite(OPEN_LEAVE_MS)).toBe(true)
  })

  it('drops rows for students outside the roster', () => {
    // Scoped to the boarder roster — a leave for a day-scholar is not this
    // surface's business and would render as an unnamed row.
    const out = buildOpenLeaveList({
      rows: [{ id: 'l1', lws_id: 'LWS-9', from_ts: day(12), to_ts: null }],
      nameByLwsId: NAMES,
      dayStartMs: DAY_START,
    })
    expect(out).toEqual([])
  })

  it('returns [] for no rows', () => {
    expect(buildOpenLeaveList({ rows: null, nameByLwsId: NAMES, dayStartMs: DAY_START })).toEqual([])
  })
})
