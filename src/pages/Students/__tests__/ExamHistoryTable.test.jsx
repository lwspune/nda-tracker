import { describe, it, expect } from 'vitest'
import { fmtMarks } from '../ExamHistoryTable'

describe('fmtMarks — bracketed marks suffix', () => {
  it('prefixes positive totals with +', () => {
    expect(fmtMarks(72)).toBe('+72')   // 18 correct × +4
    expect(fmtMarks(4)).toBe('+4')
  })

  it('keeps the sign on negative totals', () => {
    expect(fmtMarks(-2)).toBe('-2')    // 2 wrong × -1
    expect(fmtMarks(-53)).toBe('-53')
  })

  it('renders zero as "0" (no sign, no -0)', () => {
    expect(fmtMarks(0)).toBe('0')      // unattempted, or no-negative-marking wrong
    expect(fmtMarks(-0)).toBe('0')
  })

  it('strips float noise from non-integer marking schemes', () => {
    expect(fmtMarks(18 * 2.5)).toBe('+45')
    expect(fmtMarks(3 * -0.33)).toBe('-0.99')
  })
})
