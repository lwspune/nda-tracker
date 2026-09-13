import { describe, it, expect } from 'vitest'
import { buildScanRoster } from '../scanRoster'
import { resolveRoll } from '../resolveRoll'

const list = [
  { lws_id: 'LWS-001', canonical_name: 'A One', evalbee_roll_nos: ['00007'], batches: ['NDA_A'],
    name_variants: ['A One', 'A 1'] },
  { lws_id: 'LWS-002', canonical_name: 'B Two', evalbee_roll_nos: ['00007'], batches: ['NDA_B'] },
  { lws_id: 'LWS-003', canonical_name: 'C Three', evalbee_roll_nos: ['00009'], batches: ['NDA_A', 'NDA_B'] },
  { lws_id: 'LWS-004', canonical_name: 'D Four', evalbee_roll_nos: [], batches: [] },
]

describe('buildScanRoster', () => {
  it('keeps only the exam’s batch', () => {
    const r = buildScanRoster(list, ['NDA_A'])
    expect(r.map(s => s.lwsId)).toEqual(['LWS-001', 'LWS-003'])
  })

  it('handles an exam sat by more than one batch', () => {
    const r = buildScanRoster(list, ['NDA_A', 'NDA_B'])
    expect(r.map(s => s.lwsId)).toEqual(['LWS-001', 'LWS-002', 'LWS-003'])
  })

  it('returns nobody for an untagged exam rather than the whole school', () => {
    // An exam with no batch is exactly when a wide roster would be most
    // dangerous, so it yields an empty closed set and every sheet goes to
    // review for a human to attach.
    expect(buildScanRoster(list, [])).toEqual([])
    expect(buildScanRoster(list, [null, ''])).toEqual([])
  })

  it('carries the Evalbee roll numbers through', () => {
    expect(buildScanRoster(list, ['NDA_A'])[0].evalbeeRollNos).toEqual(['00007'])
  })

  // Not for identifying a sheet — a sheet carries a roll, not a name — but for
  // recognising a result this exam already holds under a sheet's own spelling.
  it('carries the name variants through', () => {
    expect(buildScanRoster(list, ['NDA_A'])[0].nameVariants).toEqual(['A One', 'A 1'])
    expect(buildScanRoster(list, ['NDA_A'])[1].nameVariants).toEqual([])
  })

  // The point of the whole thing: a roll that is ambiguous school-wide is
  // unambiguous inside one batch, which is what makes it usable as identity.
  it('turns a school-wide collision into a clean match within a batch', () => {
    expect(resolveRoll('00007', buildScanRoster(list, ['NDA_A', 'NDA_B'])).review).toBe(true)
    expect(resolveRoll('00007', buildScanRoster(list, ['NDA_A'])).lwsId).toBe('LWS-001')
    expect(resolveRoll('00007', buildScanRoster(list, ['NDA_B'])).lwsId).toBe('LWS-002')
  })
})
