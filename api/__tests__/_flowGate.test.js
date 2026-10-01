// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isFlowEnabledOnServer, FlowGateReadError, refuseIfFlowOff } from '../_flowGate.js'

// A chainable stand-in for `supabase.from('faculty_state').select().eq().single()`.
function client(result) {
  const calls = []
  const b = {
    select: (...a) => { calls.push(['select', ...a]); return b },
    eq: (...a) => { calls.push(['eq', ...a]); return b },
    single: () => Promise.resolve(result),
  }
  return { from: t => { calls.push(['from', t]); return b }, calls }
}

const row = whatsappFlows => ({ data: { data: { whatsappFlows } }, error: null })

function makeRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this },
  }
}

describe('isFlowEnabledOnServer', () => {
  it('reads the faculty_state singleton', async () => {
    const c = client(row({}))
    await isFlowEnabledOnServer(c, 'late')
    expect(c.calls).toEqual([['from', 'faculty_state'], ['select', 'data'], ['eq', 'id', 1]])
  })

  it('is on when the blob has no whatsappFlows key (legacy row)', async () => {
    expect(await isFlowEnabledOnServer(client({ data: { data: {} }, error: null }), 'late')).toBe(true)
  })

  it('is on when the flow has no entry', async () => {
    expect(await isFlowEnabledOnServer(client(row({ homework: { enabled: false } })), 'late')).toBe(true)
  })

  it('is off for an explicit enabled:false', async () => {
    expect(await isFlowEnabledOnServer(client(row({ late: { enabled: false } })), 'late')).toBe(false)
  })

  // Fail closed: a guard that evaporates on a failed read is the defect
  // api/_blockGate.js was written to stop.
  it('throws on a read error rather than reading it as on', async () => {
    const c = client({ data: null, error: { message: 'boom' } })
    await expect(isFlowEnabledOnServer(c, 'late')).rejects.toBeInstanceOf(FlowGateReadError)
  })

  it('throws when the row comes back empty', async () => {
    await expect(isFlowEnabledOnServer(client({ data: null, error: null }), 'late'))
      .rejects.toBeInstanceOf(FlowGateReadError)
  })

  it('throws when the client call itself rejects', async () => {
    const c = { from: () => { throw new Error('network') } }
    await expect(isFlowEnabledOnServer(c, 'late')).rejects.toBeInstanceOf(FlowGateReadError)
  })
})

describe('refuseIfFlowOff', () => {
  it('lets an enabled flow through and writes nothing', async () => {
    const res = makeRes()
    expect(await refuseIfFlowOff(client(row({})), 'late', res)).toBe(false)
    expect(res.statusCode).toBe(0)
  })

  it('answers 409 with disabled:true for a switched-off flow', async () => {
    const res = makeRes()
    expect(await refuseIfFlowOff(client(row({ late: { enabled: false } })), 'late', res)).toBe(true)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      ok: false, disabled: true, flow: 'late', sent: 0, lines: [],
      error: 'Late to first lecture is switched off in Settings → WhatsApp',
    })
  })

  it('answers 500 and refuses on a read error', async () => {
    const res = makeRes()
    expect(await refuseIfFlowOff(client({ data: null, error: { message: 'boom' } }), 'late', res)).toBe(true)
    expect(res.statusCode).toBe(500)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/boom/)
  })

  it('answers 200 skipped for a cron caller, so an intended stop is not logged as an outage', async () => {
    const res = makeRes()
    expect(await refuseIfFlowOff(client(row({ mentorNudge: { enabled: false } })), 'mentorNudge', res, { cron: true })).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, skipped: 'disabled', flow: 'mentorNudge', sent: 0 })
    expect(res.body.lines[0]).toMatch(/switched off/)
  })

  it('still answers 500 for a cron caller when the read fails', async () => {
    const res = makeRes()
    await refuseIfFlowOff(client({ data: null, error: { message: 'boom' } }), 'mentorNudge', res, { cron: true })
    expect(res.statusCode).toBe(500)
  })
})
