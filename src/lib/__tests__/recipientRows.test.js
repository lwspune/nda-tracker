import { describe, it, expect } from 'vitest'
import { buildRecipientRows, indexProfilesByLwsId } from '../recipientRows'

// The recipient list every parent-facing send preview builds, and the client
// half of the blocked-contact gate.
//
// It was copy-pasted into three preview modals until 2026-09-12 — same index,
// same skip, same row shape — which meant the rule "never message a Block /
// Quit / Inactive contact" existed in three places a fourth flow could forget.
// The server now enforces the same floor (api/_blockGate.js); this keeps the
// preview honest about what will actually go out.
//
// NOT used by ExamAbsencePreviewModal, deliberately: that flow requires
// `=== 'Active'` and drops profile-less rows, which is a stricter policy
// documented in the component.

const PROFILES = {
  // studentProfiles is keyed by name AND by every name variant, so the same
  // person appears more than once — the index must collapse them.
  'Asha Patil':  { lwsId: 'LWS-1', name: 'Asha Patil', mobile: '9876543210', parentMobiles: ['9811111111', '9822222222'], accountStatus: 'Active' },
  'A Patil':     { lwsId: 'LWS-1', name: 'Asha Patil', mobile: '9876543210', parentMobiles: ['9811111111', '9822222222'], accountStatus: 'Active' },
  'Rahul Desh':  { lwsId: 'LWS-2', name: 'Rahul Desh', mobile: '9876543211', parentMobiles: [], accountStatus: 'Block' },
  'Sana Shaikh': { lwsId: 'LWS-3', name: 'Sana Shaikh', mobile: '', parentMobiles: ['9833333333'], accountStatus: '' },
  'Omkar J':     { lwsId: 'LWS-4', name: 'Omkar J', mobile: '9876543213', parentMobiles: [], accountStatus: 'Quit' },
  'Priya K':     { lwsId: 'LWS-5', name: 'Priya K', mobile: '9876543214', parentMobiles: [], accountStatus: 'Inactive' },
}

describe('indexProfilesByLwsId', () => {
  it('collapses name variants onto one entry per student', () => {
    const idx = indexProfilesByLwsId(PROFILES)
    expect(idx['LWS-1'].name).toBe('Asha Patil')
    expect(Object.keys(idx).sort()).toEqual(['LWS-1', 'LWS-2', 'LWS-3', 'LWS-4', 'LWS-5'])
  })

  it('tolerates a null/empty profile map', () => {
    expect(indexProfilesByLwsId(null)).toEqual({})
    expect(indexProfilesByLwsId({})).toEqual({})
  })
})

describe('buildRecipientRows', () => {
  it('builds the row shape the send endpoints expect', () => {
    expect(buildRecipientRows(['LWS-1'], PROFILES)).toEqual([{
      lwsId: 'LWS-1',
      name: 'Asha Patil',
      mobile: '9876543210',
      parentMobiles: '9811111111, 9822222222',
    }])
  })

  // The guardrail. Block / Quit / Inactive are all excluded.
  it('drops every blocked status', () => {
    const rows = buildRecipientRows(['LWS-1', 'LWS-2', 'LWS-4', 'LWS-5'], PROFILES)
    expect(rows.map(r => r.lwsId)).toEqual(['LWS-1'])
  })

  // Fail open, mirroring the login gate — a student never stamped 'Active' must
  // not be silently dropped from notifications.
  it('KEEPS a student whose status is blank', () => {
    expect(buildRecipientRows(['LWS-3'], PROFILES).map(r => r.lwsId)).toEqual(['LWS-3'])
  })

  // Also fail open: the id still reaches the server, which does its own check.
  it('KEEPS an id with no profile, falling back to the id as the name', () => {
    const rows = buildRecipientRows(['LWS-GHOST'], PROFILES)
    expect(rows).toEqual([{ lwsId: 'LWS-GHOST', name: 'LWS-GHOST', mobile: '', parentMobiles: '' }])
  })

  it('merges per-flow extra fields from the callback', () => {
    const items = { 'LWS-1': [{ subject: 'Maths' }] }
    const rows = buildRecipientRows(Object.keys(items), PROFILES, id => ({ items: items[id] }))
    expect(rows[0].items).toEqual([{ subject: 'Maths' }])
    expect(rows[0].name).toBe('Asha Patil')
  })

  it('does not let an extra field overwrite the contact fields', () => {
    const rows = buildRecipientRows(['LWS-1'], PROFILES, () => ({ mobile: 'tampered', lwsId: 'nope' }))
    expect(rows[0].mobile).toBe('9876543210')
    expect(rows[0].lwsId).toBe('LWS-1')
  })

  it('preserves the order of the ids it was given', () => {
    expect(buildRecipientRows(['LWS-3', 'LWS-1'], PROFILES).map(r => r.lwsId))
      .toEqual(['LWS-3', 'LWS-1'])
  })

  it('returns [] for empty or non-array input', () => {
    expect(buildRecipientRows([], PROFILES)).toEqual([])
    expect(buildRecipientRows(null, PROFILES)).toEqual([])
    expect(buildRecipientRows(undefined, PROFILES)).toEqual([])
  })

  it('joins parent mobiles as a comma-space string for the editable field', () => {
    expect(buildRecipientRows(['LWS-1'], PROFILES)[0].parentMobiles)
      .toBe('9811111111, 9822222222')
    expect(buildRecipientRows(['LWS-2'], { ...PROFILES, 'Rahul Desh': { ...PROFILES['Rahul Desh'], accountStatus: 'Active' } })[0].parentMobiles)
      .toBe('')
  })
})
