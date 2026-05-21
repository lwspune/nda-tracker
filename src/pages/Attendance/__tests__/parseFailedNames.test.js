import { describe, it, expect } from 'vitest'
import { parseFailedNames } from '../index'

describe('parseFailedNames', () => {
  it('returns [] for non-array input', () => {
    expect(parseFailedNames(undefined)).toEqual([])
    expect(parseFailedNames(null)).toEqual([])
    expect(parseFailedNames('not array')).toEqual([])
  })

  it('returns [] for an empty array', () => {
    expect(parseFailedNames([])).toEqual([])
  })

  it('extracts the name from FAIL (student → ...) lines', () => {
    const lines = [
      '  FAIL → Arjun Sharma (student → 919876543210): Wabridge rejected',
    ]
    expect(parseFailedNames(lines)).toEqual(['Arjun Sharma'])
  })

  it('extracts the name from FAIL (parent → ...) lines', () => {
    const lines = [
      '  FAIL → Ravi Kumar (parent → 919876543211): Wabridge rejected',
    ]
    expect(parseFailedNames(lines)).toEqual(['Ravi Kumar'])
  })

  it('extracts the name from "SKIP Name — no mobile" lines', () => {
    expect(parseFailedNames(['  SKIP Arjun Sharma — no mobile'])).toEqual(['Arjun Sharma'])
  })

  it('extracts the name from "SKIP Name parent ... — unrecognised format" lines', () => {
    expect(parseFailedNames(['  SKIP Ravi Kumar parent 12345 — unrecognised format'])).toEqual(['Ravi Kumar'])
  })

  it('dedupes when the same name fails on student AND parent sends', () => {
    const lines = [
      '  FAIL → Arjun Sharma (student → 919876543210): boom',
      '  FAIL → Arjun Sharma (parent → 919876543211): boom',
    ]
    expect(parseFailedNames(lines)).toEqual(['Arjun Sharma'])
  })

  it('ignores SENT lines and the final "Done." summary', () => {
    const lines = [
      '  SENT → Karan Mehta (student → 919876543212)',
      '  FAIL → Arjun Sharma (student → 919876543210): boom',
      '  SENT → Karan Mehta (parent → 919876543213)',
      'Done. Sent: 2  Skipped: 1',
    ]
    expect(parseFailedNames(lines)).toEqual(['Arjun Sharma'])
  })

  it('returns names in first-seen order', () => {
    const lines = [
      '  FAIL → Z Latecomer (student → 919876543210): x',
      '  FAIL → A Latecomer (parent → 919876543211): x',
    ]
    expect(parseFailedNames(lines)).toEqual(['Z Latecomer', 'A Latecomer'])
  })
})
