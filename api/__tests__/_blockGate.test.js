// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { loadBlockedLwsIds, BlockGateReadError } from '../_blockGate.js'

// The server-side floor for "never message a blocked contact".
//
// Until 2026-09-12 the late / homework / exam-absence endpoints looped straight
// over req.body.students[] and never read the students table, so the browser's
// preview filter was the ONLY thing between a Block/Quit/Inactive family and a
// WhatsApp message. 87 of 329 students are Block, so this fires constantly.
//
// Two rules that deliberately differ:
//   - student not found  -> SEND (fail open), mirroring isBlockedStatus's
//     blank-status rule and the login gate. A missing profile must not silently
//     mute a real student.
//   - read error         -> REFUSE THE WHOLE SEND (throw), mirroring the
//     lecture-miss alert's leaves-read behaviour. A gate that disappears on a
//     database blip is not a gate.

// Minimal stand-in for the chainable Supabase query builder: .from().select().in()
function mockClient({ rows = [], error = null } = {}) {
  const inSpy = vi.fn().mockResolvedValue({ data: rows, error })
  const selectSpy = vi.fn(() => ({ in: inSpy }))
  const fromSpy = vi.fn(() => ({ select: selectSpy }))
  return { client: { from: fromSpy }, fromSpy, selectSpy, inSpy }
}

describe('loadBlockedLwsIds', () => {
  it('returns the ids whose status is Block, Quit or Inactive', async () => {
    const { client } = mockClient({ rows: [
      { lws_id: 'LWS-1', account_status: 'Active' },
      { lws_id: 'LWS-2', account_status: 'Block' },
      { lws_id: 'LWS-3', account_status: 'Quit' },
      { lws_id: 'LWS-4', account_status: 'Inactive' },
    ] })
    const blocked = await loadBlockedLwsIds(client, ['LWS-1', 'LWS-2', 'LWS-3', 'LWS-4'])
    expect([...blocked].sort()).toEqual(['LWS-2', 'LWS-3', 'LWS-4'])
  })

  // Fail open: blank/legacy status is active everywhere else in this codebase.
  it('does NOT block a blank or missing status', async () => {
    const { client } = mockClient({ rows: [
      { lws_id: 'LWS-1', account_status: '' },
      { lws_id: 'LWS-2', account_status: null },
      { lws_id: 'LWS-3' },
    ] })
    expect(await loadBlockedLwsIds(client, ['LWS-1', 'LWS-2', 'LWS-3'])).toEqual(new Set())
  })

  // Fail open: a row the server cannot identify is sent, which is the existing
  // behaviour and keeps a profile-less student reachable.
  it('does NOT block an id with no matching student row', async () => {
    const { client } = mockClient({ rows: [] })
    expect(await loadBlockedLwsIds(client, ['LWS-UNKNOWN'])).toEqual(new Set())
  })

  it('tolerates surrounding whitespace on the status', async () => {
    const { client } = mockClient({ rows: [{ lws_id: 'LWS-2', account_status: '  Block  ' }] })
    expect(await loadBlockedLwsIds(client, ['LWS-2'])).toEqual(new Set(['LWS-2']))
  })

  it('queries only the ids it was given, once', async () => {
    const { client, fromSpy, selectSpy, inSpy } = mockClient({ rows: [] })
    await loadBlockedLwsIds(client, ['LWS-1', 'LWS-1', 'LWS-2', '', null, undefined])
    expect(fromSpy).toHaveBeenCalledTimes(1)
    expect(fromSpy).toHaveBeenCalledWith('students')
    expect(selectSpy).toHaveBeenCalledWith('lws_id, account_status')
    // De-duplicated, blanks dropped.
    expect(inSpy).toHaveBeenCalledWith('lws_id', ['LWS-1', 'LWS-2'])
  })

  it('does not hit the database when there is nothing to check', async () => {
    const { client, fromSpy } = mockClient({ rows: [] })
    expect(await loadBlockedLwsIds(client, [])).toEqual(new Set())
    expect(await loadBlockedLwsIds(client, [null, ''])).toEqual(new Set())
    expect(fromSpy).not.toHaveBeenCalled()
  })

  // THE important one. Failing open here would make the guard vanish at exactly
  // the moment it is needed — which is the live defect in send-whatsapp.js:92,
  // where the error is destructured away and never inspected.
  it('THROWS on a read error rather than passing everyone', async () => {
    const { client } = mockClient({ error: { message: 'permission denied for table students' } })
    await expect(loadBlockedLwsIds(client, ['LWS-1']))
      .rejects.toBeInstanceOf(BlockGateReadError)
    await expect(loadBlockedLwsIds(client, ['LWS-1']))
      .rejects.toThrow(/permission denied/)
  })

  it('THROWS when the query resolves with neither data nor error', async () => {
    const { client } = mockClient({ rows: null })
    await expect(loadBlockedLwsIds(client, ['LWS-1'])).rejects.toBeInstanceOf(BlockGateReadError)
  })
})
